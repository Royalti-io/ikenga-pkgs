---
name: studio-block-author
description: Scaffold a new Studio block — a schema-valid block.json plus its template (index.html for HyperFrames, .excalidraw for sketch) — and register it via block.create_custom.
---

# studio-block-author

Scaffold a new reusable block atom.

## What it does

1. Asks for the block's `kind` (hook / beat / transition / narration_pattern / anchor_pack / sfx / music_preset / cta / sketch), `id`, name, and parameters.
2. Writes a **schema-valid `block.json`** (validated against `BlockSchema` from `@ikenga/studio-schema`) with:
   - `id`, `kind`, `name`, `description`, `template_path`, `parameters[]`, `default_renderer`, `tags[]`, `metadata{}`.
3. Writes the template:
   - **HyperFrames blocks** → **`index.html`** (the HF CLI hard-requires `index.html` as the composition entry; G-39). Minimal but real: a titled scene with a `data-duration` attribute and the block's parameters referenced as `{{name}}` placeholders / CSS vars.
   - **Sketch blocks** (`kind: 'sketch'`) → a minimal valid **`.excalidraw`** JSON scene. `BlockSchema.default_renderer` accepts `excalidraw` directly since WP-32/G-68; targeting older schemas, set `default_renderer: 'auto'` and carry `metadata.renderer_hint: 'excalidraw'` instead (both forms remain valid).
4. Registers via MCP `block.create_custom`, which writes into `<project>/blocks/custom/<id>/`.

## Template rules (G-39)

- HF entry file is **`index.html`** — never `content.html` or `template.html`.
- `data-duration` (ms) on the scene element drives timing.
- Keep it minimal but renderable — a real HF input, not a polished design.

## Usage

```
/studio-block-author
# → kind? id? params? → block.json + index.html (or .excalidraw) → block.create_custom
```
