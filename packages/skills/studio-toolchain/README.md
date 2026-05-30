# @ikenga/studio-toolchain

Studio toolchain suite — the interview/instantiate/render/author loop (init, oneshot, watch, archetype-build, block-author, generate-narration, freeform-video) that drives the Studio MCP surface (archetype.* / block.* / render.*).

## Bundled skills

- `studio-init`
- `studio-oneshot`
- `studio-watch`
- `studio-archetype-build`
- `studio-block-author`
- `generate-narration`
- `freeform-video`

## Install

```bash
npx skills add royalti-io/studio-toolchain   # coming in the publish session
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
