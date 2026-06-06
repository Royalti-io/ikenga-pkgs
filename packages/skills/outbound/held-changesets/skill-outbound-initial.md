---
"@ikenga/skill-outbound": minor
---

Initial release of `@ikenga/skill-outbound` (WP-19a — outbound dispatch + send owner).

Introduces the outbound dispatch skill: campaign drafting, sequence drafting,
social queue candidates, and outbound-channel send dispatch. **Dispatch-only per R4**
— outbound CRUD belongs to the outbound pkg (`com.ikenga.outbound`), not here.

**R22 founder decision:** `skill-outbound send` absorbs the four outbound channels'
dispatch from `skill-pa send`. `skill-pa send` is narrowed to non-outbound
approved-drafts (mail replies) only. Both READMEs carry cross-notes.

Five actions ship with full, validated `ActionFrontmatter` frontmatter:

- `setup` (`ux_mode: streaming`, `domain: skill-core`) — `interview` lifecycle
  action; walks operator through channel identity configuration (royalti.io =
  Listmonk/SMTP, getroyalti.com = Resend cold-outreach only, social OAuth creds
  presence check); writes `${CLAUDE_PROJECT_DIR}/.atelier/skill-outbound/manifest.json`;
  dispatches `skill.setup.complete` on completion; setup-in-chat (D-02).
- `draft-campaign` (`ux_mode: approve`, `domain: outbound`) — reads
  `newsletter_sends` history + `contacts` segment data via `host.dbQuery`; drafts
  newsletter/email campaign copy with quality-score (86/100 scorecard) and
  cooling-period check; pauses for operator approval; zero writes.
- `draft-sequence` (`ux_mode: approve`, `domain: outbound`) — reads
  `email_sequences` + `outbound_sequences` context via `host.dbQuery`; drafts
  drip/cold-outreach step content following `06` §Pipeline-stages conventions;
  pauses for operator approval; zero writes.
- `draft-social` (`ux_mode: confirm`, `domain: outbound`) — reads `social_queue`
  + `contacts` context via `host.dbQuery`; produces social post candidates; operator
  confirms before the outbound pkg inserts the `social_queue` row; zero writes.
- `send` (`ux_mode: approve`, `domain: outbound`) — **outbound-channel send owner
  (R22)**; reads approved outbound drafts across all four channels via `host.dbQuery`;
  surfaces the send-list for operator approval with 10-second undo window; on
  approval, commits delivery status transition via `host.dbExec` (parameterized,
  one row at a time); never calls transport directly — the host dispatch path
  (approve-gate) executes the actual delivery.

All actions declare `depends_on: ["skill-core"]`, carry zero CRUD verbs on the
draft-production side, and keep state on the local `ikenga.db` via
`host.dbQuery` (SELECT-only on read actions) — no Supabase, no `supabase_tables`.
Each validates against the locked `ActionFrontmatter` Zod (WP-06) and
round-trips through the WP-08 portability adapter to both a Claude tool and a
Mastra `createTool` stub.

`skill-pa send` cross-note added to `packages/skills/pa/skills/pa/actions/send.md`
and `packages/skills/pa/README.md` per R22 boundary.

3-copy publish sync deferred (supervised, WP-14 pattern).
