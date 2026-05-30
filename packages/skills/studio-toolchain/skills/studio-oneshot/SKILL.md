---
name: studio-oneshot
description: Turn a single prompt straight into a rendered MP4 with no persistent project folder — pick an archetype implicitly, instantiate in a temp workspace, render hi-fi, and hand back the file path.
---

# studio-oneshot

Single-prompt → MP4. The fast path for "just make me the video."

## What it does

1. Takes one freeform prompt.
2. Infers an archetype (defaults to `explainer` for concept prompts, `product` for feature prompts, `ai-short` for short/vertical prompts).
3. Instantiates the archetype chain into a **throwaway temp project** (not a persistent folder).
4. Renders every cell at the hi-fi rung via the configured renderer (HyperFrames in P1).
5. Stitches via the exporter and returns the final MP4 path.

## When to use vs studio-init

- `studio-oneshot` — no iteration expected; you want the file now.
- `studio-init` — you want a saved project you'll keep editing across sessions.

## Usage

```
/studio-oneshot "30s explainer on instant royalty splits, upbeat"
# → /tmp/studio-oneshot-<ts>/exports/final.mp4
```

No approval gates are surfaced (personal mode); the single-bit `approved` defaults true for the oneshot.
