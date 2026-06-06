# @ikenga/pkg-outbound

**Outbound** — the domain surface for outgoing communications in the Ikenga shell. Aggregates email, newsletter campaigns, drip sequences, and social posts into a single operator view.

## Overview

`com.ikenga.outbound` is a **no-build srcdoc iframe pkg** built on the `@ikenga/tokens` app-kit (the P3 recipe from `plans/atelier-design-system/08-pkg-retrofit-recipe.md`). It follows the exact same build pattern as `com.ikenga.tasks` (the reference exemplar) and `com.ikenga.mail`.

### Channels

| Channel | Queue | Schedule | Sent |
|---------|-------|----------|------|
| Email | approval queue (transactional + cold) | calendar grid | sent table/charts |
| Newsletter | approval queue (quality score + cooling chip) | calendar grid | sent table/charts |
| Sequences | active sequences list | active list (per-recipient, G-11) | — |
| Social | approval queue | calendar grid | sent table/charts |

### Side-menu navigation

- **Channels group** (`data-kind="view"`) — Email / Newsletter / Sequences / Social with live queue counts.
- **By agent group** (`data-kind="filter"`) — PA / CMO / CBO facet filters (dims on Schedule + Sent views).
- **Sidebar head** — "Outbox · N awaiting · M sequences active".

### Views per channel

1. **Approval queue** — `.nl-split` master/detail; `ux_mode: approve` items; Approve fires the shell approve-gate pattern (downstream); Reject + Reschedule; A/B variant select for Newsletter.
2. **Schedule** — `.nl-cal-wrap` calendar grid for Email/Newsletter/Social; `.ob-seq-list` Active list for Sequences (G-11 rule: sequences run per-recipient, not per-campaign).
3. **Sent** — `.nl-sent-toolbar` + table/charts toggle.

### Key design rules

- Channel selection lives **only** in the sidebar. No outer tab strip (G-03 rule).
- By-agent filter group dims when active view is Schedule or Sent.
- Newsletter cooling period blocks the send CTA.
- Overdue items render `--danger`.
- Cold sender rows carry `.ob-chip.sender.cold` (`--achievement` text).
- `data-workspace="outbox"` — resolves `--tint-outbox-*` workspace tint.

## Database tables

Reads via `host.dbQuery` against `ikenga.db`:

| Table | Channel |
|---|---|
| `email_sequences` | Sequences — definitions |
| `outbound_sequences` | Sequences — per-recipient tracking |
| `fundraising_outreach` | Email — cold/fundraising approvals |
| `newsletter_sends` | Newsletter — sent history |
| `social_queue` | Social — schedule + approval |
| `outbound_email_approvals` | Email — transactional + drip approval queue (WP-19b schema) |
| `outbound_sent_log` | All channels — generic sent log (WP-19b schema) |
| `outbound_newsletter_drafts` | Newsletter — draft queue + approval state (WP-19b schema) |
| `outbound_sequence_steps` | Sequences — step definitions (WP-19b schema) |

Migration: `0044_outbound_domain.sql` (registered in shell `db.rs` at index 44).

## Build

```bash
# From ikenga-pkgs root
pnpm install
cd packages/apps/outbound && node scripts/build.mjs
```

The build script vendors `tokens-css.js` + `app-kit-css.js` from the installed `@ikenga/tokens` and codegens `outbound-css.js` from `dist/outbound.css`. CSS rides the script path (not `<link>`) because WebKitGTK cannot load subresources from the `about:srcdoc` the shell mounts.

## Design reference

- `plans/atelier/designs/atelier-outbound.html` (D-01, locked R10)
- `plans/atelier/designs/atelier-outbound-{email,newsletter,social,sequences}.html` (locked R12/R13)
- Screen part doc: `plans/atelier-design-system/parts/screens/outbound.md`

## License

Apache-2.0
