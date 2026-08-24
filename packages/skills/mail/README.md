# @ikenga/skill-mail

Mail dispatch skill for Ikenga — inbox triage and reply drafting.
**Dispatch-only** (R4): email CRUD belongs to the mail pkg (`com.ikenga.mail`),
not here.

## Install

> **Not separately installable.** This skill reads workspace data through
> `host.dbQuery` against `ikenga.db`, so it needs a running Ikenga shell — it
> ships with the shell rather than through the skill marketplace.

## What it does

| Action | Mode | Description |
|---|---|---|
| `setup` | streaming | Configure skill-mail for the current project (inbox source, send identity). Writes `.atelier/skill-mail/manifest.json`. |
| `triage-inbox` | approve | Triage untriaged `email_messages` into buckets; draft reply decisions and linked-task suggestions for operator approval. **Zero writes from the skill.** |
| `draft-reply` | confirm | Draft a reply for the selected thread into the quick-reply surface; the `email_replies` write happens via the mail pkg on operator send. |

All state reads go through `host.dbQuery` (SELECT-only) against the local
`ikenga.db`. `triage-inbox` and `draft-reply` produce artifacts for operator
review; neither writes anything. The mail pkg owns all email CRUD.

## Absorbed commands / crons

`skill-mail` absorbs the following legacy PA surface items:

| Legacy id | Absorbed as |
|---|---|
| `/pa-triage` (email-only mode) | `triage-inbox` action |
| `pa:email-triage` cron (3× daily) | `triage-inbox` schedule trigger `0 8,12,17 * * 1-5` |

## P5-dedup note — `skill-pa triage(mode=inbox)` overlap

`skill-pa`'s `triage` action includes an `inbox` mode
(`inputs_schema.mode: enum [inbox, tasks, all]`) that reads `email_messages`
to produce cross-queue triage decisions alongside task items.

`skill-mail`'s `triage-inbox` action is **the canonical email-triage owner**:
it is email-focused, uses the richer mail domain context (inbox source,
send identity, thread contacts), and maps directly onto the mail pane's Triage
view. The `skill-pa triage(mode=inbox)` path handles the cross-queue case
(email + tasks together in the PA briefing context).

**Resolution deferred to P5** (cross-skill dedup pass). In-wave the two actions
are complementary, not conflicting:
- `skill-mail triage-inbox` — called from the **mail pane**, email-only focus.
- `skill-pa triage(mode=inbox)` — called from the **PA surface**, cross-queue context.

The P5 dedup should consolidate, route via delegation, or clarify the
operator-visible distinction between the two.

## License

Apache-2.0 — see [LICENSE](../../LICENSE) (monorepo root).

## Phase

WP-17a skeleton. Action bodies land in WP-17a. Publish sync deferred (supervised).
