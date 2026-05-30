---
name: studio-tutorial-archetype
description: Step-by-step how-to — question hook → clarify → demo → feature-list → CTA. Longest default runtime.
---

# Tutorial archetype

Built-in archetype `tutorial` for `com.ikenga.studio`. Its definition lives in `archetype.json` (validated against `ArchetypeSchema` from `@ikenga/studio-schema`); the MCP `archetype.*` namespace discovers it via the catalog loader.

## What it builds

Step-by-step how-to — question hook → clarify → demo → feature-list → CTA. Longest default runtime.

## Owned blocks

This skill ships: **none owned** under `blocks/`. The block catalog aggregates these with every other installed archetype skill + `studio-core-blocks`, so `block.list` sees them all regardless of which skill owns them.

## Chain

The default block chain is in `archetype.json` → `chain[]`. `archetype.instantiate_into_project` walks the chain, instantiates each `block_id` with its `bindings`, and writes the resulting cells into the project's `storyboard.json`.

## Notes

FAB narration arc. Longer runtime (120s default); chapters map to clarify/demo beats.

## Usage

```
studio-init            # pick this archetype at bootstrap
archetype.instantiate_into_project --archetype tutorial --project <slug>
```

