# Vendored golden signature vector v1 (READ-ONLY MIRROR)

These four files are a **byte-identical mirror** of the FROZEN WP-02 ↔ WP-06
contract that lives in the shell repo at:

    ikenga/shell/src-tauri/src/pkg/testdata/signature_golden_v1/

They are vendored here so `scripts/sign-manifest.test.mjs` — the cross-language
canonicalization gate — runs in this repo's CI without needing the sibling shell
checkout on disk.

## Do NOT edit these

The shell copy is WP-02's authoritative, frozen contract. If the canonicalizer
in `sign-manifest.mjs` ever disagrees with `canonical.json`, the canonicalizer
is wrong — not the vector. `sign-manifest.test.mjs` additionally asserts this
mirror stays byte-identical to the shell copy whenever the shell repo is present
(`IKENGA_SIGNATURE_GOLDEN_DIR` / the default workspace-relative path), so a drift
between the two copies fails the test loudly.

| File | What it is |
|---|---|
| `manifest.json` | Fully-populated fixture manifest with a throwaway `"signature"` placeholder (stripped before canonicalization). |
| `canonical.json` | The CANONICAL MANIFEST JSON v1 bytes of `manifest.json` — recursively key-sorted, compact separators, `signature` removed, no trailing newline (347 bytes). |
| `publisher.pub` | minisign public key (2-line `.pub`). Its base64 payload line is the `publisherKey`. |
| `manifest.minisig` | minisign signature blob over `canonical.json`. The whole blob is the manifest's top-level `signature` string. |
