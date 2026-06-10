// Linear, depth-first dependency resolver for the Ikenga registry.
//
// Input: the `PkgDetail` for the root pkg the user is installing + a way to
// resolve detail files for any `@ikenga/pkg-*` deps. Output: an ordered list
// of install steps, deps first, root last. Each step carries everything the
// installer needs (tarball URL, sha512 integrity, manifest, version) so the
// installer doesn't have to round-trip back to the registry.
//
// Why depth-first / leaves-first?
//   The kernel's `install_from_path` invokes each `Registry::register` in
//   order; if a pkg depends on another being already-registered (e.g. a UI
//   pkg expecting its engine's adapter), depth-first install order makes
//   sure the deps are live before the dependent's registries run.

import type {
  PkgDetail,
  PkgVersion,
  RegistryEntry,
} from '@ikenga/contract/registry';

/** One step in an install plan. */
export interface InstallStep {
  /** Full npm name, e.g. `@ikenga/pkg-engine-noop`. */
  name: string;
  /** Resolved semver, e.g. `0.1.1`. */
  version: string;
  /** Direct npm tarball URL. */
  tarball: string;
  /** SRI digest, `sha512-<base64>`, as returned by npm. */
  integrity: string;
  /** Tarball size in bytes, when known. */
  size?: number;
  /** Pkg id from the manifest — used as install-dir name. */
  pkgId: string;
  /** Full manifest (so the UI can show capabilities/permissions before install). */
  manifest: PkgVersion['manifest'];
  /** True if the pkg is a dependency of the root request (not the root itself). */
  isDep: boolean;
  /**
   * ADR-017 / WP-06: the publisher key the signed registry bound to this signed
   * pkg version. The installer threads this into
   * `InstallSource::Registry.publisher_key`, and the shell re-derives the
   * canonical manifest bytes and minisign-verifies the manifest's `signature`
   * against it — the gate for trusted-for-elevated capabilities (host.fetch /
   * named secrets / scoped invoke). `undefined` for unsigned/community pkgs:
   * they install + run, just without elevated caps.
   */
  publisherKey?: string;
}

export interface ResolveOptions {
  /** Root pkg detail. The first version in `detail.versions` is `latest`. */
  root: PkgDetail;
  /** Specific version to install. Defaults to `latest` (root.versions[0]). */
  version?: string;
  /**
   * Resolver for transitive @ikenga/pkg-* deps. Called once per unique
   * dep name. The resolver should hit the cache that the UI already
   * maintains for detail files.
   */
  fetchDetail: (npmName: string) => Promise<PkgDetail>;
}

/**
 * Build the install plan for `root` at `version` (or latest). Resolves
 * `@ikenga/pkg-*` deps depth-first, dedupes by name (first-seen wins —
 * which, because the walk is depth-first, picks the deepest declarer
 * first). Cycles throw.
 *
 * External (non-`@ikenga/pkg-*`) deps are intentionally NOT walked: they
 * ride inside the published tarball, so the installer doesn't need to
 * resolve them separately.
 */
export async function resolveInstallPlan(
  opts: ResolveOptions,
): Promise<InstallStep[]> {
  const plan: InstallStep[] = [];
  const seen = new Map<string, string>(); // name → resolved version (dedup)
  const inFlight = new Set<string>(); // cycle guard

  const walk = async (
    detail: PkgDetail,
    version: string | undefined,
    isDep: boolean,
  ): Promise<void> => {
    const pv = pickVersion(detail, version);
    const existing = seen.get(detail.name);
    if (existing) {
      if (existing !== pv.version) {
        // Conflicting requested versions. For now we keep the first-seen
        // (deeper) one and surface a warning via thrown error — better
        // loud than silently install the wrong thing.
        throw new Error(
          `registry-client: conflicting versions requested for ${detail.name}: ${existing} vs ${pv.version}`,
        );
      }
      return;
    }
    if (inFlight.has(detail.name)) {
      throw new Error(
        `registry-client: dependency cycle detected at ${detail.name}`,
      );
    }
    inFlight.add(detail.name);

    for (const dep of pv.deps) {
      if (!dep.name.startsWith('@ikenga/pkg-')) continue; // bundled, skip
      const depDetail = await opts.fetchDetail(dep.name);
      // We don't do semver-range resolution here yet. The registry currently
      // only stores the latest version's deps; once the index grows version
      // history, swap this for a proper semver picker. Until then: latest.
      await walk(depDetail, undefined, /* isDep */ true);
    }

    seen.set(detail.name, pv.version);
    inFlight.delete(detail.name);
    plan.push({
      name: detail.name,
      version: pv.version,
      tarball: pv.tarball,
      integrity: pv.integrity,
      size: pv.size,
      pkgId: pv.manifest.id,
      manifest: pv.manifest,
      isDep,
      // ADR-017 / WP-06: carry the publisher-key binding from the (signed,
      // index-rooted) detail version into the install step. Read defensively —
      // the field is only present on the registry `PkgVersion` once the
      // contract schema admits it (lockstep with @ikenga/contract); until then
      // it's undefined and the pkg installs untrusted-for-elevated.
      publisherKey: (pv as { publisherKey?: string }).publisherKey,
    });
  };

  await walk(opts.root, opts.version, /* isDep */ false);
  return plan;
}

function pickVersion(detail: PkgDetail, requested?: string): PkgVersion {
  if (!requested) {
    const latest = detail.versions[0];
    if (!latest) {
      throw new Error(`registry-client: ${detail.name} has no versions`);
    }
    return latest;
  }
  const match = detail.versions.find((v) => v.version === requested);
  if (!match) {
    throw new Error(
      `registry-client: ${detail.name} has no version ${requested} (latest: ${detail.versions[0]?.version})`,
    );
  }
  return match;
}

/** Convenience: classify an installed pkg against the index. */
export function compareInstalled(
  entry: RegistryEntry,
  installedVersion: string | null,
): 'not-installed' | 'current' | 'outdated' {
  if (!installedVersion) return 'not-installed';
  if (installedVersion === entry.latest) return 'current';
  // Treat "installed but newer than latest" (dev / sideload) as current
  // for UI purposes — we don't want to suggest "update" downward.
  return semverCompare(installedVersion, entry.latest) < 0
    ? 'outdated'
    : 'current';
}

/**
 * Minimal semver compare — sufficient for the `0.1.0` / `0.1.1` shape we
 * publish today. Doesn't handle pre-release tags (`-rc.1`) precisely; if we
 * start publishing those, replace with a real semver lib.
 */
export function semverCompare(a: string, b: string): number {
  const [aMain = '', aPre = ''] = a.split('-', 2);
  const [bMain = '', bPre = ''] = b.split('-', 2);
  const ap = aMain.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const bp = bMain.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const av = ap[i] ?? 0;
    const bv = bp[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  // No prerelease > prerelease, otherwise lexicographic.
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  return aPre < bPre ? -1 : aPre > bPre ? 1 : 0;
}
