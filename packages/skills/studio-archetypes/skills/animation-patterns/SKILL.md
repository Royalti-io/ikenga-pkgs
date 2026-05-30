<!-- LIFTED-FROM: royalti-co/.claude/skills/animation-patterns (SOURCE NOT FOUND 2026-05-22 — scaffolded placeholder) -->
---
name: animation-patterns
description: Reusable animation patterns for Studio cells — entrance/exit, reveals, beat-synced motion — expressed as in-template CSS/HF animation or Excalidraw animate hints. Placeholder scaffold — original source skill not found at lift time.
---

# animation-patterns (scaffolded placeholder)

> **Status:** placeholder. The source skill `royalti-co/.claude/skills/animation-patterns` was **not found** at lift time (2026-05-22). This file is a minimal scaffold so the catalog/skill set is complete; flesh out from the real source when it surfaces.

## Intended behaviour

A library of motion patterns applied to Studio cells:

- **HyperFrames cells** — animation lives in-template (CSS keyframes / transitions inside `index.html`). No `metadata.animation` field.
- **Excalidraw cells** — animation hints live in `Cell.metadata.animation`:
  - `order[]` — excalidraw-animate's primary primitive (P1 draw order).
  - `keyframes[]` — Excalimate-compatible per-element timing (P2).
- **Beat-synced motion** — when `Project.audio_analysis` is present (music-video), entrance timings snap to `beats[]` / `downbeats[]`.

## Catalog

Common patterns: fade-in, slide-in, scale-pop, draw-on (Excalidraw), number-count-up, beat-pulse.
