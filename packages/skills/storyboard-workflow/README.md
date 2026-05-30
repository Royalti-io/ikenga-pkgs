# @ikenga/storyboard-workflow

Engine-agnostic 3-pass storyboard workflow. The only Studio-coupled fragment is an optional --mode personal block that stays inert elsewhere.

## Bundled skills

- `storyboard-workflow`

## Install

```bash
npx skills add royalti-io/storyboard-workflow   # coming in the publish session
```

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
