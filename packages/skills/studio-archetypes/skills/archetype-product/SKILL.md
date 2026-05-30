---
name: studio-product-archetype
description: Product walkthrough — hook → problem → solution → demo → features → proof → CTA. Owns the beat.* blocks.
---

# Product demo archetype

Built-in archetype `product` for `com.ikenga.studio`. Its definition lives in `archetype.json` (validated against `ArchetypeSchema` from `@ikenga/studio-schema`); the MCP `archetype.*` namespace discovers it via the catalog loader.

## What it builds

Product walkthrough — hook → problem → solution → demo → features → proof → CTA. Owns the beat.* blocks.

## Owned blocks

This skill ships: **beats (8)** under `blocks/`. The block catalog aggregates these with every other installed archetype skill + `studio-core-blocks`, so `block.list` sees them all regardless of which skill owns them.

## Chain

The default block chain is in `archetype.json` → `chain[]`. `archetype.instantiate_into_project` walks the chain, instantiates each `block_id` with its `bindings`, and writes the resulting cells into the project's `storyboard.json`.

## Notes

PAS narration arc by default. `beat.demo` typically renders a screen capture or a HF mock.

## Usage

```
studio-init            # pick this archetype at bootstrap
archetype.instantiate_into_project --archetype product --project <slug>
```

