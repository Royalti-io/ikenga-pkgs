<!-- LIFTED-FROM: royalti-co/.claude/skills/generate-narration (SOURCE NOT FOUND 2026-05-22 — scaffolded placeholder) -->
---
name: generate-narration
description: Generate voiceover narration audio from beat-level VO text and align it to word-level timings (NarrationBlock) for a Studio project. Placeholder scaffold — original source skill not found at lift time.
---

# generate-narration (scaffolded placeholder)

> **Status:** placeholder. The source skill `royalti-co/.claude/skills/generate-narration` was **not found** at lift time (2026-05-22). This file is a minimal scaffold so the catalog/skill set is complete; flesh out from the real source when it surfaces.

## Intended behaviour

1. Read each beat's VO text from the project `Script` (`ScriptBeat.vo`).
2. Synthesize narration audio (TTS — ElevenLabs convert-with-timestamps is the lifted reference format).
3. Populate the project's `NarrationBlock`:
   - `audio` (AssetRef → `narration.mp3`)
   - `words[]` (composition-absolute word timings, ms)
   - `voice_id`, `duration_ms`, `generated_at` (ISO-8601, for staleness detection).
4. Mark the block stale when any beat's narration text changes after `generated_at`.

## Notes

- Pairs with the explainer/tutorial/narrative archetypes, which are narration-led.
- Word-level timings drive subtitle rendering and beat-snap in the timeline.
