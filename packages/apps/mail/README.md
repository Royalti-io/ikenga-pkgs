# @ikenga/pkg-mail

Mail domain pkg for the Ikenga desktop workspace. Surfaces Inbox / Triage / All / Drafts
views over the local `ikenga.db` mail schema.

## Architecture

No-build `srcdoc` iframe pkg following the [08-pkg-retrofit-recipe](../../../../plans/atelier-design-system/08-pkg-retrofit-recipe.md).

- CSS vendored deterministically via `scripts/build.mjs` (tokens → app-kit → mail residue)
- Appearance mirrored from shell `<html>` attrs (setupTheme verbatim from tasks)
- Data via `host.dbQuery` / `host.dbExec` on `email_messages`, `email_replies`, `email_drafts`, `contacts`, `mail_thread_state`
- Side-menu published via `setMenu` (Inbox with `is-hot` on unread > 0)

## Thread-state table

Migration `0042_mail_domain.sql` creates `mail_thread_state` (STRICT, soft TEXT links to
`email_messages.id`). Fields: `message_id`, `is_read`, `snoozed_until`, `tags`, `preview`.

## Build

```bash
pnpm install
node scripts/build.mjs
```

## Design reference

`plans/atelier-design-system/parts/screens/mail.md` and fixture threads M-01..M-09.
