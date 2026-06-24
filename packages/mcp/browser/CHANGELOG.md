# @ikenga/mcp-browser

## 0.3.0

### Minor Changes

- [#26](https://github.com/Royalti-io/ikenga-pkgs/pull/26) [`eac5cf9`](https://github.com/Royalti-io/ikenga-pkgs/commit/eac5cf9103c5f9162daae9286c04028b24d75430) Thanks [@nedjamez](https://github.com/nedjamez)! - Add an `engine` discriminant to the browser MCP so agents can target Managed-mode Chrome. `browser_open` gains an optional `engine: "webkit" | "chrome"` (default `"webkit"`) that is forwarded in the open body and reported in the result; `browser_list` now surfaces each pane's `engine`. The wire shape stays engine-agnostic — the shell fixes the engine at open and later verbs inherit it via the pane id. Requires `@ikenga/contract@^0.11.0` (the `BROWSER_ENGINES` discriminant). chrome-pkg WP-08.

## 0.2.1

### Patch Changes

- Republish with `manifest.json` version synced to the npm version. Previous
  tarballs shipped a stale manifest version, so the shell recorded the old
  version after every update and re-offered the same update forever.
  (`@ikenga/pkg-tasks` also catches its npm version up to the manifest's 0.8.x
  line — npm history jumps 0.4.1 → 0.8.1.)

## 0.2.0

### Minor Changes

- [`02fafe2`](https://github.com/Royalti-io/ikenga-pkgs/commit/02fafe2e7302ec7b1b4167bdbb13ead17110f173) Thanks [@nedjamez](https://github.com/nedjamez)! - Add `@ikenga/mcp-browser` — MCP server that lets agents drive native
  child webviews in the running Ikenga desktop app. 16 tools: open / close /
  list / focus / goto / back / forward / reload / snapshot / read_text /
  screenshot (stub) / click / fill / select / press_key / wait_for / eval.
  Wraps the shell's `/iyke/browser/*` bridge (Phase 3a) and uses the
  in-page a11y-snapshot helper for stable `e0..eN` refs. Trust boundary is
  the same `control.json` the Iyke MCP and CLI use; per-request oneshot
  tokens isolate reply traffic from the global bearer so partner-site JS
  can't impersonate snapshots.

- [`02fafe2`](https://github.com/Royalti-io/ikenga-pkgs/commit/02fafe2e7302ec7b1b4167bdbb13ead17110f173) Thanks [@nedjamez](https://github.com/nedjamez)! - Phase 4 — named sessions. Add `browser_session_create / list / delete`
  tools so agents can keep multiple workflows isolated under human-friendly
  names instead of raw partition slugs. `browser_open` now accepts a
  `session` field as an alternative to `partition` — the MCP resolves the
  name to a partition on the shell side and bumps `last_used_at` for the
  list-by-recent ordering. Deleting a session preserves the on-disk
  cookie partition data; re-creating with the same partition slug picks
  the cookies back up.

  Backed by a new SQLite table `browser_sessions` in the shell (migration
  `0014_browser_sessions.sql`).

- [`02fafe2`](https://github.com/Royalti-io/ikenga-pkgs/commit/02fafe2e7302ec7b1b4167bdbb13ead17110f173) Thanks [@nedjamez](https://github.com/nedjamez)! - Phase 5 — pause/resume + richer `wait_for`.

  - New tools `browser_pause` and `browser_resume`. When paused, the
    snapshot / interaction tools (`browser_snapshot`, `browser_click`,
    `browser_fill`, `browser_select`, `browser_press_key`,
    `browser_read_text`, `browser_wait_for`, `browser_eval`) refuse with
    HTTP 409. Navigation (`goto / back / forward / reload`), lifecycle
    (`close`), and `browser_list` still work — the pane stays interactive
    for the human user. Intended for "agent hit a captcha / MFA / dialog,
    hand off to the user, resume when they're done."
  - `browser_wait_for.kind` gains `selector`, `gone-selector`, `gone-text`
    in addition to the existing `url / text / ref / idle`. Backed by a
    small in-page DOM check on each tick (existing 100ms cadence).
  - `browser_list` results include `paused: boolean` so callers can detect
    state without a separate call.

  Shell-side: new `set_paused / is_paused` methods on
  `WebviewPanesRegistry`, two new HTTP routes (`/iyke/browser/pause` and
  `/iyke/browser/resume`), and a `check_not_paused` guard wired into all
  action handlers.
