---
name: studio-montage-archetype
description: Rhythm-cut montage — cold-open then rapid demo/proof beats over a music bed.
---

# Montage archetype

Built-in archetype `montage` for `com.ikenga.studio`. Its definition lives in `archetype.json` (validated against `ArchetypeSchema` from `@ikenga/studio-schema`); the MCP `archetype.*` namespace discovers it via the catalog loader.

## What it builds

Rhythm-cut montage — cold-open then rapid demo/proof beats over a music bed.

## Owned blocks

This skill ships: **none owned** under `blocks/`. The block catalog aggregates these with every other installed archetype skill + `studio-core-blocks`, so `block.list` sees them all regardless of which skill owns them.

## Chain

The default block chain is in `archetype.json` → `chain[]`. `archetype.instantiate_into_project` walks the chain, instantiates each `block_id` with its `bindings`, and writes the resulting cells into the project's `storyboard.json`.

## Notes

Leans on `music.upbeat-tech` and `transition.smash-cut`. Pairs well with `studio-beat-detect` for beat-synced cuts.

## Usage

```
studio-init            # pick this archetype at bootstrap
archetype.instantiate_into_project --archetype montage --project <slug>
```

