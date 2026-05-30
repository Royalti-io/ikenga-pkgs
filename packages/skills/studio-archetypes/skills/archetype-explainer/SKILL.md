---
name: studio-explainer-archetype
description: Concept-first short — narration-led hook → problem → clarify → solution → CTA. Owns the hook.* and narration.* blocks.
---

# Explainer archetype

Built-in archetype `explainer` for `com.ikenga.studio`. Its definition lives in `archetype.json` (validated against `ArchetypeSchema` from `@ikenga/studio-schema`); the MCP `archetype.*` namespace discovers it via the catalog loader.

## What it builds

Concept-first short — narration-led hook → problem → clarify → solution → CTA. Owns the hook.* and narration.* blocks.

## Owned blocks

This skill ships: **hooks (5) + narration patterns (4)** under `blocks/`. The block catalog aggregates these with every other installed archetype skill + `studio-core-blocks`, so `block.list` sees them all regardless of which skill owns them.

## Chain

The default block chain is in `archetype.json` → `chain[]`. `archetype.instantiate_into_project` walks the chain, instantiates each `block_id` with its `bindings`, and writes the resulting cells into the project's `storyboard.json`.

## Notes

Narration-led; pair with `generate-narration` for VO. Default narration arc: AIDA.

## Usage

```
studio-init            # pick this archetype at bootstrap
archetype.instantiate_into_project --archetype explainer --project <slug>
```

