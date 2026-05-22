---
name: studio-music-video-archetype
description: Audio-led cut — cells snap to a detected beat-grid. Run studio-beat-detect first to populate audio_analysis.
---

# Music video archetype

Built-in archetype `music_video` for `com.ikenga.studio`. Its definition lives in `archetype.json` (validated against `ArchetypeSchema` from `@ikenga/studio-schema`); the MCP `archetype.*` namespace discovers it via the catalog loader.

## What it builds

Audio-led cut — cells snap to a detected beat-grid. Run studio-beat-detect first to populate audio_analysis.

## Owned blocks

This skill ships: **none owned** under `blocks/`. The block catalog aggregates these with every other installed archetype skill + `studio-core-blocks`, so `block.list` sees them all regardless of which skill owns them.

## Chain

The default block chain is in `archetype.json` → `chain[]`. `archetype.instantiate_into_project` walks the chain, instantiates each `block_id` with its `bindings`, and writes the resulting cells into the project's `storyboard.json`.

## Notes

**Requires `Project.audio_analysis`** — run the `studio-beat-detect` skill on the track before building. The only archetype with `requires_audio_analysis: true`. Uses J/L-cuts for musical phrasing.

## Usage

```
studio-init            # pick this archetype at bootstrap
archetype.instantiate_into_project --archetype music_video --project <slug>
```

