# @ikenga/pkg-mail

## 0.2.1

### Patch Changes

- [`e50666b`](https://github.com/Royalti-io/ikenga-pkgs/commit/e50666b4507b08641d3763ec807960bf82c1889c) Thanks [@nedjamez](https://github.com/nedjamez)! - Fix the mail list not scrolling. `.mail-list` is a grid item in `.pane-split` (a `display:grid; height:100%` container); grid items default to `min-height:auto`, so `.mail-list` couldn't shrink below its content and the inner `.mail-list-scroll` (`flex:1; overflow-y:auto; min-height:0`) never received a bounded height. Adds `min-height:0` to `.mail-list` and regenerates the injected `dist/lib/mail-css.js` string.

## 0.2.0

### Minor Changes

- [`18559db`](https://github.com/Royalti-io/ikenga-pkgs/commit/18559dba776e2f086af0d171495ece9d710112c7) Thanks [@nedjamez](https://github.com/nedjamez)! - Add `com.ikenga.mail` domain pkg (WP-17b) — Inbox / Triage / All / Drafts views over the local `ikenga.db` mail schema, deterministic CSS vendoring, thread-state read/write (mark-read, snooze 4h, tag), and AppBridge `host.dbQuery` / `host.dbExec` data path.
