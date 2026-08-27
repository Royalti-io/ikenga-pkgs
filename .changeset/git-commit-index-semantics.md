---
'@ikenga/pkg-git': minor
---

WP-10 fix — commit the INDEX, and make "explicit paths" an assertion.

`argv.commit` emitted `git commit -F - --only -- <paths>`, reading 01-plan.md's
"commits only the explicit path list" as a pathspec. A pathspec does not mean
that: `git commit -- <paths>` (and `--only`, its explicit spelling) commits the
**working tree** content of those paths and ignores the index for them. So a
porcelain `MM` file — staged at one revision, then edited again in the editor —
committed the later, unstaged, unreviewed content, while the pkg's own
staged-diff pane showed the earlier one. It affected the sidecar and the MCP
`git_commit` tool alike, and was reproduced end to end against a real repo
through the real sidecar process.

`commit` is now `git commit -F -` with no pathspec, and the caller's path list
is enforced before anything is written: `assertStagedSetMatches`
(`core/src/staged.ts`) reads `git diff --cached --name-only -z` and refuses with
the new `staged-set-mismatch` error reason — nothing committed — unless the
staged set equals the requested set. Containment is unchanged in strength;
a surprise is now a refusal rather than a silently different commit. `paths: []`
keeps its UI-only "commit whatever is staged" meaning; the MCP tool still
requires a non-empty list, so `git_commit` always asserts.

This is a minimal G-RPC reopen: one added member of `GitErrorReason`. No method
name, arg shape, result shape or notification changed.

Also in this fix:

- The commit box's Commit button now enables and disables as the message is
  typed. `disabled` was computed once at build time while the message was still
  empty, and the `input` listener updated the message without touching the
  button — so the button was permanently disabled and Enter was the only way to
  commit.
- "Send to your Chi" copies its prompt to the clipboard and says so.
  `host.sendToActiveSession` does not exist in the shell's pkg-iframe dispatcher
  (the cited studio precedent calls the same missing verb), and the button
  previously reported a delivery that never happened. The label is unchanged.
  `permissions.engine` goes back to `[]` — it bought nothing.
