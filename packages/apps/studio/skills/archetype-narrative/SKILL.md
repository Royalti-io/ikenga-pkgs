---
name: studio-narrative-archetype
description: Story-driven piece. Fountain-aware: reads <project>/script.fountain natively into the Script shape.
---

# Narrative (Fountain) archetype

Built-in archetype `narrative` for `com.ikenga.studio`. Its definition lives in `archetype.json` (validated against `ArchetypeSchema` from `@ikenga/studio-schema`); the MCP `archetype.*` namespace discovers it via the catalog loader.

## What it builds

Story-driven piece. Fountain-aware: reads <project>/script.fountain natively into the Script shape.

## Owned blocks

This skill ships: **none owned** under `blocks/`. The block catalog aggregates these with every other installed archetype skill + `studio-core-blocks`, so `block.list` sees them all regardless of which skill owns them.

## Chain

The default block chain is in `archetype.json` → `chain[]`. `archetype.instantiate_into_project` walks the chain, instantiates each `block_id` with its `bindings`, and writes the resulting cells into the project's `storyboard.json`.

## Notes

The one archetype that reads `script.fountain` instead of `script.json`. Parser emits the same Zod `Script` shape in memory. Save-the-Cat 15-beat arc by default.

## Usage

```
studio-init            # pick this archetype at bootstrap
archetype.instantiate_into_project --archetype narrative --project <slug>
```

