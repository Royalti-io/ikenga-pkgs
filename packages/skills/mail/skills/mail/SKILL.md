---
name: mail
description: |
  Mail dispatch — inbox triage, reply drafting, and setup for the mail domain.
  Reads `ikenga.db` via `host.dbQuery` (SELECT-only); produces draft decisions
  and reply artifacts for operator approval. DISPATCH-ONLY: email CRUD belongs
  to the mail pkg (`com.ikenga.mail`), not here.

  TRIGGER when the user asks to triage their inbox, draft a reply to a thread,
  or configure the mail skill. Runs as a Chi conversation in the dock.

  DO NOT TRIGGER for email CRUD (create/edit/delete messages, mark read/unread,
  snooze, tag). Route those to the mail pkg. Do NOT use this skill to send email
  — send routes through the approved-drafts queue owned by skill-pa `send`.
depends_on:
  - skill-core
allowed-tools: Read, Bash, Skill
---

# mail — dispatch-only mail surface

**This file is a router.** Each action lives in its own file under `actions/`;
load on demand. The state contract (which `ikenga.db` tables are touched,
read-vs-write boundary, dispatch-only scope) is in `lib/state.md` — read it
before building any action.

> **skill-core note:** `depends_on: ['skill-core']` is declared above.
> `skill-core` is on `ikenga-pkgs` main (WP-15 done). skill-mail declares the
> dependency edge here (per the G-04 contract and the lint spec in
> `06-skill-action-contract.md` §5) so the graph is correct from day one.
> The shell resolver installs the `skill-core` closure at enable time.

---

## Purpose (one line)

Triage the inbox, draft replies for operator approval, and configure the mail
skill per project — reading `ikenga.db` state, never owning CRUD.

---

## Dispatch actions

| Action | File | Mode | One-liner |
|---|---|---|---|
| `setup` | [`actions/setup.md`](actions/setup.md) | `streaming` | Configure inbox source + send identity. Writes `.atelier/skill-mail/manifest.json`. |
| `triage-inbox` | [`actions/triage-inbox.md`](actions/triage-inbox.md) | `approve` | Triage untriaged `email_messages` into buckets; draft decisions for operator approval. Zero writes. |
| `draft-reply` | [`actions/draft-reply.md`](actions/draft-reply.md) | `confirm` | Draft a reply for the selected thread into the quick-reply surface. The `email_replies` write happens via the mail pkg on send. |

All three actions conform to the locked `ActionFrontmatter` Zod schema in
`plans/atelier/drafts/action-frontmatter.ts`.

---

## Routing

| If the user says… | Load | Then |
|---|---|---|
| "triage my inbox", "what emails need attention", "triage email" | [`actions/triage-inbox.md`](actions/triage-inbox.md) | Read `email_messages` where `triage_category` IS NULL; bucket + draft decisions; pause for operator approval |
| "draft a reply to this thread", "reply to [sender]", "draft reply" | [`actions/draft-reply.md`](actions/draft-reply.md) | Read thread context from `email_messages` + `contacts`; draft reply; insert into quick-reply surface; pause for operator confirm |
| "setup mail", "configure skill-mail", "set up my email" | [`actions/setup.md`](actions/setup.md) | `ai_infer` or `interview` mode; writes `.atelier/skill-mail/manifest.json` |

---

## What skill-mail does NOT do

- **No email CRUD** — create/edit/delete `email_messages` belongs to the mail pkg.
- **No send** — skill-pa `send` owns the approved-drafts queue dispatch. skill-mail
  only drafts; the mail pkg / host path executes the actual send.
- **No newsletter/sequence content** — outbound marketing is the outbound domain
  (wave-2, not this skill).
- **No query actions** — R-03 deferred; dispatch-only in wave-1.
- **No Supabase** — state is local `ikenga.db` via `host.dbQuery`/`host.dbExec` only.

---

## Critical files

```
mail/
├── SKILL.md                     ← you are here (router only)
├── lib/state.md                 ← table-scope contract + read/write boundary
└── actions/
    ├── setup.md                 ← WP-17a body
    ├── triage-inbox.md          ← WP-17a body (WP-06 worked example, packaged)
    └── draft-reply.md           ← WP-17a body
```
