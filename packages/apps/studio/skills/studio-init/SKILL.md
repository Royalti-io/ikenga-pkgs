---
name: studio-init
description: Bootstrap a new com.ikenga.studio project — interview for archetype, create the project folder, and instantiate the chosen archetype's block chain into a fresh storyboard.json.
---

# studio-init

Bootstraps a new Studio project end to end.

## What it does

1. Asks the user which **archetype** to use (explainer / product / ai-short / narrative / montage / tutorial / music-video) and a project **title/slug**.
2. Creates the project folder layout: `<project>/{storyboard.json, cells/, anchors/, renders/, exports/}` (and `script.fountain` for the narrative archetype, `script.json` otherwise).
3. Calls the MCP `archetype.instantiate_into_project --archetype <id>` so the chosen archetype's `chain[]` is expanded into cells in `storyboard.json`.
4. Writes `aspect_ratio` (defaults: 9:16 for ai-short, 16:9 otherwise) and `mode: 'studio'`.

## Preconditions

Run `studio-doctor` first if you have never set up the toolchain. The music-video archetype additionally needs `studio-beat-detect` run against the track before the timeline can snap to beats.

## Usage

```
/studio-init
# → "Which archetype?"  → "What's the title?"  → folder + storyboard.json created
```

The archetype list is read live from the catalog (`archetype.list`), so any installed archetype skill is selectable.
