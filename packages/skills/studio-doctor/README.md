# @ikenga/studio-doctor

Studio toolchain preflight — pure-shell check.sh that verifies the local render stack. Zero coupling; independently useful as a doctor/preflight skill.

## Bundled skills

- `studio-doctor`

## Install

```
/plugin marketplace add ikenga-hq/marketplace
/plugin install studio-doctor@ikenga
```

## check.sh

`skills/studio-doctor/check.sh` ships with the executable bit set (`100755`).
The SKILL.md invokes it as `bash skills/studio-doctor/check.sh`, so it runs
regardless of whether the npm tarball preserves the bit.

## Provenance

Extracted from `com.ikenga.studio` (`packages/apps/studio`) per **Ọba registry
WP-17 Phase A** (ADR-015 decision 4 — hard-retire pkg asset-bundling). During
Phase A, Studio keeps its own `skills/` folder intact (interim duplication);
the cutover that switches Studio to `requires` and deletes the bundled copy is
Phase B, gated on the forward-dependency resolver (WP-11 + WP-13/14).

> **`requires` edges pending WP-11.** The cross-primitive `requires` field
> (e.g. the two suites → `studio-beat-detect`) is **not** declared yet: the
> manifest `requires` field does not exist in `@ikenga/contract` /
> `manifest.rs` until WP-11, and the Rust loader's `deny_unknown_fields` would
> reject it. Phase B adds the field + the edges once the schema accepts them.

## License

Apache-2.0 — see [LICENSE](../../LICENSE) (monorepo root).
