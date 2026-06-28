# @ikenga/skill-thunderbird

## 0.2.0

### Minor Changes

- [`2fb5f74`](https://github.com/Royalti-io/ikenga-pkgs/commit/2fb5f74259d1a0746288d30aeddc71e2b5d10a81) Thanks [@nedjamez](https://github.com/nedjamez)! - Initial release of `@ikenga/skill-thunderbird` — the Thunderbird mail skill.

  Operates on the user's local Thunderbird mail store (not `ikenga.db`), so it
  ships as a standalone skill pkg rather than folding into the dispatch-only
  `@ikenga/skill-mail`.

  Two capabilities:

  - **Read (mbox)** — search/extract emails from the local offline-store mbox
    files: by sender / date / subject, large-mailbox tail handling, an inline
    zero-dep mbox parser, and MIME encoded-word (Q/B) header decoding. Never
    modifies the store or syncs IMAP.
  - **Write drafts (IMAP APPEND)** — place a drafted reply into the user's Drafts
    folder by appending it to the IMAP server with the `\Draft` flag, correctly
    threaded via `In-Reply-To` / `References`. Documents why local-mbox writes
    silently fail (server-authoritative `.msf` index → local-only drafts never
    display and are compacted away) and how to resolve the mailbox password from
    the host secret store at run time. The skill never sends mail.

  Portable / project-agnostic: profile via `TBIRD_PROFILE` or per-OS defaults; no
  hardcoded paths or account-specific credential names. Declares the permission
  set the capabilities require — `shell.execute`, `fs.read` (profile mbox globs),
  `net` (IMAP/IMAPS), and `vault.keys` (`*IMAP*`).

  Publish sync deferred (supervised) — held changeset + `"private": true`.
