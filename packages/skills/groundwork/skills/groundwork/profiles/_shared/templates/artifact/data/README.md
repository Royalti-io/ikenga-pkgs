<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# `artifact/data/` — external data sources for the artifact

Optional. Files here are JSON / Markdown / CSV / etc. referenced by the artifact (`artifact/index.html` or `artifact/board.html`) via the Ikenga artifact manifest's `dataSources` field.

## Pattern

In `artifact/manifest.json`:

```jsonc
{
  "dataSources": {
    "board":     { "type": "file", "path": "./data/board.json",     "refresh": { "mode": "manual" } },
    "decisions": { "type": "file", "path": "./data/decisions.json", "refresh": { "mode": "manual" } }
  },
  "fallback": {
    "mode": "mock",
    "dataTag": "board-mock-data"
  }
}
```

The artifact's bridge polyfill (or the real Ikenga AppBridge `sources` API) loads these at runtime. **When unreachable** — running standalone in a browser, or when a file is missing — the artifact falls through to the `board-mock-data` JSON block inlined in the HTML.

## When to use this folder

- **You want diff-able data** — the JSON file changes more often than the HTML; reviewers see only data-shape diffs in PRs.
- **The artifact reads large data** — keeping it out of the HTML keeps load fast.
- **Multiple artifacts share data** — both `index.html` and `board.html` can read the same `data/board.json`.

## When NOT to use this folder

- **Tiny mock data** — inline it in a `<script type="application/json" id="…-mock-data">` block in the HTML itself (the tracking board ships its fallback this way).
- **Live data** — that's an AppBridge `sources.subscribe()` call against a sidecar / MCP server, not a static file.

## Refresh modes

- `manual` — the artifact loads once at mount; user clicks "refresh" in the chrome to reload.
- `interval` — polls at a cadence (the manifest declares the interval).
- `event` — subscribes to a pkg event; refreshes on emit.

## Layout

```
artifact/data/
├── board.json          # mirrors what `board-mock-data` would carry inline
├── decisions.json      # extracted decision log for re-use
└── …
```

The `groundwork refresh-board` action **does not** write into this folder. It only writes into the `board-data` fence inside `artifact/board.html`. Files here are hand-curated by the plan author.
