# @ikenga/studio-beat-detect

Portable beat-detection skill — self-contained beat_detect.py (stdlib + optional librosa/madmom). Zero Ikenga runtime calls; usable by any agent via npx skills add.

## Bundled skills

- `studio-beat-detect`

## Install

```bash
npx skills add ikenga-hq/studio-beat-detect   # coming in the publish session
```

## beat_detect.py

`skills/studio-beat-detect/beat_detect.py` is self-contained (stdlib + optional
`librosa`/`madmom`). It travels verbatim and runs with `python3`.

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
