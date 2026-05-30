# @ikenga/studio-archetypes

Studio archetype suite — the 7 video archetypes (ai-short, explainer, montage, music-video, narrative, product, tutorial) + the shared core block catalog + animation patterns. One publish unit: archetype block-ID resolution stays intra-package.

## Bundled skills

- `archetype-ai-short`
- `archetype-explainer`
- `archetype-montage`
- `archetype-music-video`
- `archetype-narrative`
- `archetype-product`
- `archetype-tutorial`
- `studio-core-blocks`
- `animation-patterns`

## Install

```bash
npx skills add royalti-io/studio-archetypes   # coming in the publish session
```

## Peer dependency

This suite's `archetype.json` / `block.json` assets validate against
`ArchetypeSchema` / `BlockSchema` from **@ikenga/studio-schema** (declared as a
peer dependency). Install it alongside, or rely on the Studio app providing it.

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
