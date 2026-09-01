---
"@ikenga/pkg-studio": minor
---

- Migrate project sidecar and MCP server to Bun runtime with built-in `bun:sqlite`, eliminating external native C++ module dependencies for Tier 1 1-click in-app installation (ADR-017).
- Phase 4 Blender 3D headless adapter conformance (G-74): FFmpeg frame assembly, 30fps progress envelopes, cancellation, and resolution scaling.
- Phase 4 DaVinci Resolve NLE exporter (G-75): FCPXML DTD validity, boundary-based G-53 frame quantization without drift, async process spawning, and Purple beat marker support.
- Phase 5 Node Canvas conformance (G-76): atomic `.studio/canvas.json` persistence and drop-commit reordering.
- Recents registry (G-47), atomic cell content write-back (G-48), and session state persistence (G-50).
- Additive renderer enum extension: `blender` and `fal` on `Cell.renderer`, `excalidraw` on `Block.default_renderer` (G-68).
