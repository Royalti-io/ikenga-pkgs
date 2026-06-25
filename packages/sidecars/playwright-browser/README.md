# @ikenga/sidecar-playwright-browser

The browser engine behind Ikenga's `/iyke/browser/*` contract — a Playwright verb engine the shell (and its agents) use to drive Chrome. Replaces the Rust chromiumoxide engine ([ADR-018](https://github.com/Royalti-io/ikenga/blob/main/docs/adr/018-chrome-automation-adopt-playwright.md)).

## What it gives you

Two ways to drive Chrome, picked per-pane:

- **Managed** — launches the installed Chrome on a **persistent, headful** profile the agent fully controls (separate from your everyday browser). Logs in once, reuses the session; you can watch / take over / review. Best for **agent-driven build/test tasks**.
- **Attach** — connects over CDP to a Chrome you started with `--remote-debugging-port`, and drives a chosen tab (`attach_target: new | active | <id>`) without disturbing the rest. (For driving your *everyday* logged-in Chrome with no relaunch, the official `@playwright/mcp --extension` is the smoother path — see ADR/plan 12.)

## Prerequisites

- **Node** on `PATH` (the sidecar runs on Node — Bun can't do `connectOverCDP`). Managed-only use works on the shell's bundled Bun, but Node is the supported runtime.
- **Google Chrome** installed (the engine drives your installed Chrome via Playwright's `chrome` channel; it does **not** download a browser).

## Install + use (works today)

The shell resolves the sidecar in this order: **`IKENGA_PW_SIDECAR` env → installed pkg (`pkg_installed`) → in-workspace dev build**. The simplest user path is npm + the env override:

```bash
# 1) install the engine (bundles Playwright — ~3.7 MB)
npm install -g @ikenga/sidecar-playwright-browser

# 2) point the shell at it (add to ~/.bashrc to persist)
export IKENGA_PW_SIDECAR="$(npm root -g)/@ikenga/sidecar-playwright-browser/dist/sidecar.js"

# 3) (re)start the Ikenga shell — chrome panes now resolve to this engine
```

Then drive it:

- **Interactive** — ⌘K → **"Attach Chrome profile / tab…"** (the picker).
- **CLI** — `iyke browser open <pane> <url> --engine chrome --mode managed` (or `--mode attach --attach-target new`).
- **Agents / MCP** — the `/iyke/browser/*` verbs (`open` with `engine:"chrome"`, then `snapshot` / `click` / `fill` / `eval` / `screenshot`). Managed defaults headful; pass `headless: true` per-pane for autonomous runs.

**Standalone** (no shell — a script or your own MCP host): the pkg is a self-contained HTTP server.
```bash
IKENGA_PW_PORT=9333 node "$(npm root -g)/@ikenga/sidecar-playwright-browser/dist/sidecar.js"
# → prints `IKENGA_PW_READY 9333`; POST the /iyke/browser/* verbs to it.
```

## Coming: one-command install via the Ọba registry

`ikenga add @ikenga/sidecar-playwright-browser` (and the in-shell store) need this pkg in the **signed Ọba registry**. That's pending two things: it diverges from the registry's `@ikenga/pkg-*` naming convention (a rename-republish or a manual index entry), and the index must be re-signed with the registry's minisign key. Until then, use the npm + `IKENGA_PW_SIDECAR` path above.

## Verbs

| Verb | Playwright | Notes |
|---|---|---|
| `open` | `launchPersistentContext({channel:"chrome"})` (managed, persistent profile) / `connectOverCDP` (attach) | per-pane session registry; `headless?` + `attach_target?` |
| `profiles` / `targets` | reads OS Chrome `Local State` / CDP `/json` | feeds the profile+tab picker |
| `launch_profile` | spawns Chrome `--profile-directory --remote-debugging-port` | singleton-gated |
| `snapshot` | re-tag interactive els → `e<N>` refs | refs invalidate on next snapshot |
| `click` / `fill` / `select` / `press_key` / `focus` | `locator(...)` | auto-wait + actionability |
| `eval` | `page.evaluate("(() => { …script… })()")` | IIFE-`return` contract |
| `screenshot` | `page.screenshot()` | base64 PNG |
| `read_text` / `wait_for` / `pause` / `resume` / `close` / `list` | — | — |

Managed profiles persist under `IKENGA_PW_PROFILES_DIR` (or `~/.ikenga/managed-profiles/<partition>`).
