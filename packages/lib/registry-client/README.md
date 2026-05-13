# `@ikenga/registry-client`

Read-side client for the [Ikenga registry](https://github.com/Royalti-io/ikenga-registry).
Used by the Ikenga shell and the `ikenga` CLI to:

1. **Fetch the signed root index** (`index.json`) and verify its minisign
   signature against an embedded public key.
2. **Lazily fetch per-pkg detail files** (`pkgs/<short>.json`).
3. **Resolve install plans** — depth-first walk of `@ikenga/pkg-*` deps,
   producing an ordered list of `{ tarball, integrity, manifest }` steps
   that the platform-specific installer (Rust in the shell, Bun in the CLI)
   consumes one at a time.

The client never touches disk. The actual download / integrity-verify /
untar step is the platform installer's job; this lib just produces the
plan.

## Usage

```ts
import { fetchIndex, fetchPkgDetail, resolveInstallPlan } from '@ikenga/registry-client';

const REGISTRY_URL = 'https://royalti-io.github.io/ikenga-registry/index.json';
const REGISTRY_PUBKEY = 'RWRTqugAYXnZRgZPMyuqRNB3G41wg+AhSU2yT8nmDNNQlWQPeCfRXAvI';

const { index, indexUrl } = await fetchIndex({
  indexUrl: REGISTRY_URL,
  publicKey: REGISTRY_PUBKEY,
});

const detail = await fetchPkgDetail({
  indexUrl,
  entry: index.pkgs.find((p) => p.name === '@ikenga/pkg-engine-noop')!,
});

const plan = await resolveInstallPlan({
  root: detail,
  fetchDetail: (name) => fetchPkgDetail({ indexUrl, entry: { name } }),
});

for (const step of plan) {
  // hand `step` to your platform installer:
  //   shell: invoke('pkg_install_from_registry', step)
  //   cli:   await downloadAndUntarAndRegister(step)
}
```

## Signature trust model

- **Only `index.json` is individually signed.** Detail files are trusted by
  reference: the signed index names exactly which pkgs exist + what their
  latest version is, so a substituted detail file would either fail Zod
  validation or list a version the index doesn't bless.
- **The tarball URL inside a detail file is trusted because it came through
  the verified index.** Once downloaded, the installer must re-verify the
  tarball's SHA-512 against `PkgVersion.integrity` before unpacking.
- We sign with `minisign -H` (prehashed mode: Ed25519 over
  BLAKE2b-512(content)).

## License

Apache-2.0.
