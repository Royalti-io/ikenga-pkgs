// HTTP-level registry client: fetch + verify the root index, then lazily fetch
// per-pkg detail files. Pure read; no install/disk-touch logic lives here.

import {
  RegistryIndexSchema,
  PkgDetailSchema,
  pkgDetailPath,
  type RegistryIndex,
  type PkgDetail,
  type RegistryEntry,
} from '@ikenga/contract/registry';
import { verify } from './minisign.js';

export interface FetchIndexOptions {
  /** Absolute URL of `index.json`. */
  indexUrl: string;
  /**
   * Minisign public key (base64 payload line, with or without the
   * `untrusted comment:` header). Required — index URLs cannot be trusted
   * until the signature verifies against this key.
   */
  publicKey: string;
  /**
   * `.minisig` URL. Defaults to `${indexUrl}.minisig`, which matches the
   * publisher convention (`update-registry-index.mjs`).
   */
  sigUrl?: string;
  /**
   * Custom fetch implementation. Defaults to global `fetch`. Useful for tests
   * and for the CLI where we may want to swap in `undici`.
   */
  fetchImpl?: typeof fetch;
  /** Abort signal threaded through both the index + sig requests. */
  signal?: AbortSignal;
}

export interface FetchedIndex {
  index: RegistryIndex;
  /** Raw `index.json` bytes — kept so callers can re-verify or cache. */
  raw: Uint8Array;
  /** The signature file contents that were used to verify the index. */
  signature: string;
  /** Resolved `index.json` URL (after redirects). */
  indexUrl: string;
}

/**
 * Fetch the registry index, verify its minisign signature, and parse the
 * payload with the canonical Zod schema. Throws on:
 *   - Network failure on either request.
 *   - HTTP non-2xx.
 *   - Signature mismatch (tampered or wrong key).
 *   - Zod schema mismatch.
 *
 * The caller MUST treat any throw as "do not use this index" and surface
 * the error to the user — never silently fall back to an older cached
 * version without re-verifying that older version.
 */
export async function fetchIndex(
  opts: FetchIndexOptions,
): Promise<FetchedIndex> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error(
      'registry-client: no global `fetch` available; pass fetchImpl',
    );
  }
  const sigUrl = opts.sigUrl ?? `${opts.indexUrl}.minisig`;

  const [indexRes, sigRes] = await Promise.all([
    fetchImpl(opts.indexUrl, { signal: opts.signal }),
    fetchImpl(sigUrl, { signal: opts.signal }),
  ]);
  if (!indexRes.ok) {
    throw new Error(
      `registry-client: index fetch failed: ${indexRes.status} ${indexRes.statusText}`,
    );
  }
  if (!sigRes.ok) {
    throw new Error(
      `registry-client: signature fetch failed: ${sigRes.status} ${sigRes.statusText}`,
    );
  }
  const raw = new Uint8Array(await indexRes.arrayBuffer());
  const signature = await sigRes.text();

  const ok = await verify(raw, signature, opts.publicKey);
  if (!ok) {
    throw new Error(
      'registry-client: index.json signature did not verify against the configured public key',
    );
  }

  // Only parse JSON *after* sig verification. Parsing untrusted JSON is
  // safe, but this ordering makes the "verify-before-use" intent explicit.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder().decode(raw));
  } catch (err) {
    throw new Error(
      `registry-client: index.json is not valid JSON: ${(err as Error).message}`,
    );
  }
  const index = RegistryIndexSchema.parse(parsedJson);
  return { index, raw, signature, indexUrl: indexRes.url || opts.indexUrl };
}

export interface FetchPkgDetailOptions {
  /** Resolved `index.json` URL — detail paths are relative to this. */
  indexUrl: string;
  /** Either a `RegistryEntry` (preferred) or a bare npm name. */
  entry: RegistryEntry | { name: string };
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Lazily fetch a per-pkg detail file (`pkgs/<short>.json`). The detail file
 * is NOT individually signed — its integrity is rooted in the signed index:
 * the index lists exactly which pkgs exist + their latest version, and the
 * detail file's contents are validated by the same publisher pipeline.
 *
 * Returns a parsed `PkgDetail`. Throws on network / HTTP / schema failure.
 */
export async function fetchPkgDetail(
  opts: FetchPkgDetailOptions,
): Promise<PkgDetail> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error(
      'registry-client: no global `fetch` available; pass fetchImpl',
    );
  }
  const relPath =
    'detail' in opts.entry && opts.entry.detail
      ? opts.entry.detail
      : pkgDetailPath(opts.entry.name);
  const url = new URL(relPath, opts.indexUrl).toString();
  const res = await fetchImpl(url, { signal: opts.signal });
  if (!res.ok) {
    throw new Error(
      `registry-client: pkg detail fetch failed: ${res.status} ${res.statusText} (${url})`,
    );
  }
  const json = await res.json();
  return PkgDetailSchema.parse(json);
}
