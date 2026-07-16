# @ikenga/pkg-studio · com.ikenga.studio

The Studio video app for [Ikenga](https://ikenga.dev) — a composable, AI-augmented
desktop workspace for music labels. Studio is the orchestration spine for short-form
video: script → breakdown → references/characters/locations → storyboard → generation
→ stitch & edit.

## What's in the box (0.2.0)

- **Project sidecar** (`sidecars/project/`) — a JSON-RPC over stdio server backed by
  SQLite + a `storyboard.json` document. Owns the render queue, the adapter registry,
  archetype instantiation, anchors, assets, and FFmpeg export.
- **Renderer adapters** — `hyperframes` (HTML→video), `excalidraw`, and `fal`
  (network AI stills/video via `@fal-ai/client`, Track A). Remotion remains a P2 slot.
- **MCP server** (`mcp/`) — a ~40-tool Model Context Protocol server that exposes the
  sidecar to an AI agent (or the shell's Chi). Every meaningful operation is an MCP
  verb, so the board is drivable 100% over MCP.
- **Track-B handoff** — for generators with no API (Higgsfield, Google Flow, …),
  `export.prompt_package` emits a platform-shaped prompt bundle; the returned clip
  comes back via `render.ingest_external`.
- **iframe UI** (`src/studio/`) — the M-A "production desk": Launcher, Canvas, Cell,
  Composition, Archetype builder, Cast & World, Breakdown, Ledger, Handoff. Built with
  React 19 + Vite, themed via `@ikenga/tokens`.

## The fal.ai adapter

`fal` is the first network AI-generation engine. It drives a fal model from a cell's
`prompt` (+ optional character/location/image anchor for image-to-video), streams
queue updates as `render.progress`, and downloads the produced MP4. The credential is
read from the vault key **`studio.fal`** (declared in `manifest.json`), with a
`FAL_KEY` env fallback for headless / stdio-driven runs. No key is ever hardcoded.

Model ids are config (`FAL_VIDEO_MODEL` / `FAL_IMAGE_MODEL`, or per-cell
`metadata.fal_model`), with documented defaults — verify them against
https://fal.ai/models, they drift.

## Install / develop

Studio ships as the `com.ikenga.studio` pkg. In an Ikenga dev checkout:

```bash
pnpm install                      # links @ikenga/studio-schema, @ikenga/tokens, …
bun run dev                       # vite dev (the iframe UI)
bun run build:sidecar             # build the JSON-RPC sidecar
bun run build:mcp                 # bundle the MCP server → mcp/dist/index.js
bun run typecheck                 # the real type gate (tsc, both configs)
```

Hot-mount into a running shell without a restart:

```bash
cd cli && bun run ./src/index.ts dev /path/to/this/pkg
```

### Registry install caveat

`ikenga add @ikenga/pkg-studio` from the registry is **not yet runnable as-is**: the
installer does not yet materialize the npm deps the sidecar needs at runtime
(`better-sqlite3`, `esbuild`, …). Use the **dev-mount** path above for a working
runtime today; the installer dep-materialization feature is the top CLI follow-up.

## Cross-refs

- Plan + history: `plans/studio/` (workspace meta-repo)
- Schema: `@ikenga/studio-schema` (the `shared/` Zod schema, published as a workspace package)
- Adapter contract: `sidecars/project/src/renderers/types.ts`
