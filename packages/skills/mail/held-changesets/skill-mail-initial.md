---
"@ikenga/skill-mail": minor
---

Initial release of `@ikenga/skill-mail` (WP-17a — dispatch-only mail skill).

Introduces the mail dispatch skill: inbox triage and reply drafting for the mail
domain. **Dispatch-only per R4** — email CRUD belongs to the mail pkg
(`com.ikenga.mail`), not here.

Three actions ship with full, validated `ActionFrontmatter` frontmatter:

- `setup` (`ux_mode: streaming`, `domain: skill-core`) — `ai_infer` lifecycle
  action; infers inbox source + send identity (royalti.io=SMTP, getroyalti.com=Resend
  cold-outreach only); writes `${CLAUDE_PROJECT_DIR}/.atelier/skill-mail/manifest.json`;
  dispatches `skill.setup.complete` on completion; setup-in-chat (D-02).
- `triage-inbox` (`ux_mode: approve`) — **the WP-06 worked example, packaged**:
  reads untriaged `email_messages` (triage_category IS NULL/empty) via
  `host.dbQuery`; buckets (reply-now/delegate/archive) + drafts decisions
  (incl. linked-task suggestions); pauses for operator approval; manual +
  weekday 3× daily schedule (`0 8,12,17 * * 1-5`); zero writes.
- `draft-reply` (`ux_mode: confirm`) — reads thread from `email_messages` +
  `contacts` + `email_replies`; produces a drafted reply for the quick-reply
  surface; operator confirms before the mail pkg inserts the `email_replies`
  row; manual trigger only.

All actions declare `depends_on: ["skill-core"]`, carry zero CRUD verbs, and
keep state on the local `ikenga.db` via `host.dbQuery` (SELECT-only) — no
Supabase, no `supabase_tables`. Each validates against the locked
`ActionFrontmatter` Zod (WP-06) and round-trips through the WP-08 portability
adapter to both a Claude tool and a Mastra `createTool` stub.

Absorbs `/pa-triage` (email mode) + `pa:email-triage` cron (3× daily) into the
`triage-inbox` action. `skill-pa triage(mode=inbox)` overlap recorded as a
P5-dedup note in the package README.

3-copy publish sync deferred (supervised, WP-14 pattern).
