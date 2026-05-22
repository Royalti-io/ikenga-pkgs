---
name: studio-watch
description: Agent-driven build loop — kick off cell renders and return immediately while the canvas auto-pans to the active cell; poll render.list for completion instead of blocking.
---

# studio-watch

Agent-driven, non-blocking build mode. You drive; the canvas follows.

## What it does

1. Reads the project's `storyboard.json` and the set of cells needing renders.
2. Enqueues renders through the MCP `render.*` namespace and **returns immediately** (does not block on render completion).
3. Signals the iframe canvas to auto-pan to the cell currently being worked, so the human watching sees progress live.
4. Polls `render.list` on an interval; as each `RenderRecord` flips to `done`, the canvas updates the cell's hi-fi still.

## Why non-blocking

Renders (especially AI adapters in P3) can take minutes. `studio-watch` keeps the agent responsive: it can answer questions, accept edits, or queue more work while renders run in the background supervisor.

## Usage

```
/studio-watch <project-slug>
# canvas auto-pans; agent stays free; poll render.list until all cells are `done`
```

Pairs with `studio-init` (which seeds the project) and the chokidar file-watcher (which fires `cells/changed` within ~60ms of a save).
