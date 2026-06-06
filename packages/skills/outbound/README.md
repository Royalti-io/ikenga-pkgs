# @ikenga/skill-outbound

Outbound dispatch skill for Ikenga — campaign drafting, drip-sequence drafting,
social queue management, and **outbound send dispatch** (the canonical owner of
the outbound-channel approved-drafts commit, per the **R22 founder decision**).
**Dispatch-only** (R4): outbound CRUD belongs to the outbound pkg
(`com.ikenga.outbound`), not here.

## Install

```bash
npx skills add royalti-io/skill-outbound   # publish deferred (supervised)
```

Or via the Ikenga CLI once the 3-copy publish sync is wired (WP-14 pattern).

## What it does

| Action | Mode | Description |
|---|---|---|
| `setup` | streaming | Configure outbound channel identities (royalti.io = Listmonk/SMTP; getroyalti.com = Resend cold-outreach only; social creds). Writes `.atelier/skill-outbound/manifest.json`. |
| `draft-campaign` | approve | Draft newsletter / email campaigns honouring the quality-score (86/100-style scorecard) + cooling-period rules; pause for operator approval. Zero writes. |
| `draft-sequence` | approve | Draft drip / cold-outreach step content following `06` §Pipeline-stages; pause for operator approval. Zero writes. |
| `draft-social` | confirm | Draft `social_queue` post candidates; operator confirms before the outbound pkg inserts the row. Zero writes. |
| `send` | approve | **Outbound-channel send owner (R22).** Surfaces approved outbound drafts (email/newsletter/sequences/social) for operator approval; on approval, commits the delivery status transition via `host.dbExec`; 10-second undo window; transport executes via the host dispatch path (approve-gate), never the skill. |

All state reads go through `host.dbQuery` (SELECT-only) against the local
`ikenga.db`. The one write path — committing approved draft delivery status — goes
through `host.dbExec`, gated behind the `approve` ux_mode pause.

## R22 — outbound-send ownership transfer

**Founder decision (Round 22):** `skill-outbound send` absorbs the four
outbound channels' dispatch from `skill-pa send`. The boundary is:

- `skill-pa send` — **non-outbound approved-drafts only** (mail replies queued
  in `email_drafts` from the mail flow). See `packages/skills/pa/skills/pa/actions/send.md`.
- `skill-outbound send` — **all outbound channels** (newsletter campaigns, email
  sequences / cold-outreach, social posts, campaign email). Reads
  `email_sequences`, `outbound_sequences`, `fundraising_outreach`,
  `newsletter_sends`, `social_queue`, `email_drafts` (outbound-flagged rows).

Neither skill calls the actual transport layer. The skill writes the delivery
status transition; the shell host dispatch path executes the send.

See `packages/skills/pa/README.md` for the matching cross-note.

## Absorbed commands / crons

| Legacy id | Absorbed as |
|---|---|
| `/pa-outbound-send` command | `send` action |
| `pa:outbound-dispatch` cron (daily 9am + 5pm) | `send` schedule triggers (`0 9,17 * * *`) |
| newsletter draft / campaign draft workflows | `draft-campaign` action |
| sequence step authoring workflows | `draft-sequence` action |
| social post scheduling workflows | `draft-social` action |

## Cooling-period and quality-gate rules

These are surfaced by `draft-campaign` and enforced at the `send` gate:

- **Cooling period:** a newsletter draft cannot be advanced to `send` until its
  cooling timer has elapsed (shown as "cooling 47m" in the outbound pane fixture).
  The skill reads the `newsletter_sends.sent_at` of the last send for the same
  list and enforces the configured gap.
- **Quality gate:** newsletters carry a quality score (86/100-style scorecard).
  `draft-campaign` produces the score as part of the draft artifact; the operator
  reviews it at the `approve` pause. A draft scoring below the configured minimum
  quality threshold is flagged at `send` time but not blocked — the operator can
  override.

## Channel identity model

Configured by `setup`:

| Domain | Delivery system | Use |
|--------|----------------|-----|
| `royalti.io` | Listmonk / SMTP | Newsletter broadcasts, transactional sequences |
| `getroyalti.com` | Resend | **Cold-outreach only** — never reply path |
| Social | Buffer (per-platform OAuth) | LinkedIn / X posts |

## License

Apache-2.0 — see [LICENSE](../../LICENSE) (monorepo root).

## Phase

WP-19a skeleton. Action bodies land in WP-19a. Publish sync deferred (supervised).
