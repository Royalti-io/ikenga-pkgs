---
name: outbound
description: |
  Outbound dispatch — campaign drafting, drip-sequence drafting, social queue
  management, and outbound-channel send dispatch. Reads `ikenga.db` via
  `host.dbQuery` (SELECT-only on read actions); commits delivery status
  transitions via `host.dbExec` on the approved `send` action only.
  DISPATCH-ONLY: outbound CRUD belongs to the outbound pkg
  (`com.ikenga.outbound`), not here.

  TRIGGER when the user asks to draft a newsletter/campaign, author a sequence
  step, schedule a social post, or dispatch the outbound send queue. Runs as a
  Chi conversation in the dock.

  DO NOT TRIGGER for outbound CRUD (create/edit/delete sequences, contacts,
  campaigns). Route those to the outbound pkg. Do NOT use this skill for
  mail-reply dispatch — that belongs to `skill-pa send` (non-outbound queue).
depends_on:
  - skill-core
allowed-tools: Read, Bash, Skill
---

# outbound — dispatch-only outbound surface

**This file is a router.** Each action lives in its own file under `actions/`;
load on demand. The state contract (which `ikenga.db` tables are touched,
read-vs-write boundary, dispatch-only scope) is in `lib/state.md` — read it
before building any action.

> **skill-core note:** `depends_on: ['skill-core']` is declared above.
> `skill-core` is on `ikenga-pkgs` main (WP-15 done). skill-outbound declares
> the dependency edge here (per the G-04 contract and the lint spec in
> `06-skill-action-contract.md` §5) so the graph is correct from day one.
> The shell resolver installs the `skill-core` closure at enable time.

> **R22 send boundary:** `skill-outbound send` is the **outbound-channel send
> owner**. `skill-pa send` handles only non-outbound approved-drafts (mail
> replies). See `packages/skills/pa/skills/pa/actions/send.md` and
> `packages/skills/pa/README.md` for the matching cross-notes.

---

## Purpose (one line)

Draft outbound campaigns, sequence steps, and social posts for operator
approval — and own the outbound-channel approved-drafts commit — reading
`ikenga.db` state, never owning CRUD.

---

## Dispatch actions

| Action | File | Mode | One-liner |
|---|---|---|---|
| `setup` | [`actions/setup.md`](actions/setup.md) | `streaming` | Configure channel identities (royalti.io=Listmonk/SMTP, getroyalti.com=Resend cold-outreach, social creds). Writes `.atelier/skill-outbound/manifest.json`. |
| `draft-campaign` | [`actions/draft-campaign.md`](actions/draft-campaign.md) | `approve` | Draft newsletter / email campaigns with quality scorecard + cooling-period check; pause for operator approval. Zero writes. |
| `draft-sequence` | [`actions/draft-sequence.md`](actions/draft-sequence.md) | `approve` | Draft drip / cold-outreach step content following `06` §Pipeline-stages; pause for operator approval. Zero writes. |
| `draft-social` | [`actions/draft-social.md`](actions/draft-social.md) | `confirm` | Draft `social_queue` post candidates; operator confirms before the outbound pkg inserts the row. Zero writes. |
| `send` | [`actions/send.md`](actions/send.md) | `approve` | **R22 outbound-send owner.** Surface approved outbound drafts across all channels; commit delivery status on approval via `host.dbExec`; 10s undo; transport runs via host dispatch path. |

All five actions conform to the locked `ActionFrontmatter` Zod schema in
`plans/atelier/drafts/action-frontmatter.ts`.

---

## Routing

| If the user says… | Load | Then |
|---|---|---|
| "draft a newsletter", "write a campaign email", "new campaign" | [`actions/draft-campaign.md`](actions/draft-campaign.md) | Read `newsletter_sends` history + `contacts` segments; draft copy + quality scorecard; pause for approval |
| "draft a sequence step", "write a drip email", "author cold outreach" | [`actions/draft-sequence.md`](actions/draft-sequence.md) | Read `email_sequences` + `outbound_sequences`; draft step content; pause for approval |
| "draft a social post", "schedule a tweet", "LinkedIn post" | [`actions/draft-social.md`](actions/draft-social.md) | Read `social_queue` context; draft post candidates; confirm before outbound pkg inserts |
| "send outbound queue", "dispatch outbound drafts", "approve sends" | [`actions/send.md`](actions/send.md) | Read approved outbound drafts across all channels; surface send-list; pause for approval; commit on confirm |
| "setup outbound", "configure skill-outbound", "set up channels" | [`actions/setup.md`](actions/setup.md) | `interview` mode; walks channel identity config; writes `.atelier/skill-outbound/manifest.json` |

---

## What skill-outbound does NOT do

- **No outbound CRUD** — create/edit/delete sequences, campaigns, contacts belongs
  to the outbound pkg (`com.ikenga.outbound`).
- **No mail-reply dispatch** — `skill-pa send` owns the non-outbound approved-drafts
  queue (mail replies queued in `email_drafts` from the mail flow).
- **No direct transport** — the skill commits a DB delivery-status transition;
  the shell host dispatch path (approve-gate, 10s undo) executes the actual send.
- **No query actions** — R-03 deferred; dispatch-only in wave-2.
- **No Supabase** — state is local `ikenga.db` via `host.dbQuery`/`host.dbExec` only.
- **No editorial / long-form content authoring** — content creation belongs to the
  content domain (wave-3). `draft-campaign` and `draft-sequence` produce draft
  artifacts for operator review, not polished editorial output.

---

## Critical files

```
outbound/
├── SKILL.md                          ← you are here (router only)
├── lib/state.md                      ← table-scope contract + read/write boundary
└── actions/
    ├── setup.md                      ← WP-19a body
    ├── draft-campaign.md             ← WP-19a body
    ├── draft-sequence.md             ← WP-19a body
    ├── draft-social.md               ← WP-19a body
    └── send.md                       ← WP-19a body (R22 outbound-send owner)
```
