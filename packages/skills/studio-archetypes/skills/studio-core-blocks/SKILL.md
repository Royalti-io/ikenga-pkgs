---
name: studio-core-blocks
description: Ships the universal Studio blocks shared across every archetype — transitions, SFX, music presets, CTAs, anchor packs, and sketch scenes — under blocks/, discovered by the catalog loader alongside archetype-owned blocks.
---

# studio-core-blocks

The home for **archetype-agnostic** blocks. Anything that isn't specific to one archetype's narrative shape lives here.

## What it ships

Under `blocks/`:

| Dir | Kind | Blocks |
|-----|------|--------|
| `transition/` | `transition` (5) | cut, fade, smash-cut, J-cut, L-cut |
| `sfx/` | `sfx` (3) | icon-pop, data-reveal, outro-resolve |
| `music/` | `music_preset` (2) | upbeat-tech, calm-narrative |
| `cta/` | `cta` (3) | link, subscribe, talk-to-us |
| `anchor/` | `anchor_pack` (3) | brand-pack, host-pack, location-pack |
| `sketch/` | `sketch` (3) | flowchart, timeline, wireframe |

That's **19** of the 36 library blocks. The remaining 17 are owned by archetype skills (hooks + narration in `archetype-explainer`, beats in `archetype-product`).

## Templates

- All non-sketch core blocks ship **`index.html`** (HyperFrames entry; G-39) with a `data-duration` scene and `{{param}}` placeholders.
- Sketch blocks ship a minimal valid **`.excalidraw`** scene (a few rectangles + text). `BlockSchema.default_renderer` now accepts `excalidraw` directly (WP-32/G-68); the shipped sketch blocks keep the older `default_renderer: 'auto'` + `metadata.renderer_hint: 'excalidraw'` form, which stays valid against pre-G-68 schemas.

## Discovery

The MCP catalog loader walks `skills/*/blocks/**/block.json`, so these blocks appear in `block.list` regardless of which archetypes are installed. Uninstalling an archetype never removes core blocks.

## Block placement map (whole library)

- `studio-core-blocks/blocks/` → transitions, sfx, music, cta, anchor, sketch (19)
- `archetype-explainer/blocks/` → hooks (5) + narration patterns (4) (9)
- `archetype-product/blocks/` → beats (8)

Total = **36**.
