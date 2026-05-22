---
name: studio-ai-short-archetype
description: AI-generated vertical short — pattern-break hook → fast beats → cliffhanger close. 9:16 first.
---

# AI short archetype

Built-in archetype `ai_short` for `com.ikenga.studio`. Its definition lives in `archetype.json` (validated against `ArchetypeSchema` from `@ikenga/studio-schema`); the MCP `archetype.*` namespace discovers it via the catalog loader.

## What it builds

AI-generated vertical short — pattern-break hook → fast beats → cliffhanger close. 9:16 first.

## Owned blocks

This skill ships: **none owned (chains core + explainer/product blocks)** under `blocks/`. The block catalog aggregates these with every other installed archetype skill + `studio-core-blocks`, so `block.list` sees them all regardless of which skill owns them.

## Chain

The default block chain is in `archetype.json` → `chain[]`. `archetype.instantiate_into_project` walks the chain, instantiates each `block_id` with its `bindings`, and writes the resulting cells into the project's `storyboard.json`.

## Notes

Defaults to `aspect_ratio: 9:16`. Cells default to an AI renderer in P3; HF/Excalidraw in P1.

## Usage

```
studio-init            # pick this archetype at bootstrap
archetype.instantiate_into_project --archetype ai_short --project <slug>
```

