// Outbound main view — Email / Newsletter / Sequences / Social.
//
// Composition follows plans/atelier-design-system/parts/screens/outbound.md §§1–4:
//   - .frame / .frame-head / .frame-body-flush (kit part 30 pkg-pane-frame)
//   - .ob-header — channel name h1 + subtitle (domain-local)
//   - .nl-inner-tabs — Approval queue / Schedule / Sent inner tab strip
//   - .nl-split master/detail (Approval queue views)
//   - .nl-cal-wrap calendar grid (Schedule view for Email/Newsletter/Social)
//   - .ob-seq-list Active sequence list (Schedule view for Sequences — G-11 rule)
//   - .nl-sent-toolbar + table/charts toggle (Sent view)
//   - .nav-group[data-kind] / .nav-item / .nav-item.is-on via setMenu
//   - .atelier-state.is-{loading,empty,error,streaming} (kit part 26)
//   - .ob-chip.* (domain-local channel identity + status chips)
//
// Design reference: plans/atelier/designs/atelier-outbound*.html (locked R10/R12/R13)
// Data: ikenga.db via host.dbQuery (real tables) + 0044_outbound_domain.sql tables

import {
  html,
  cn,
  Icon,
  useState,
  useEffect,
  useMemo,
  useRef,
  useQuery,
  useMutation,
  useQueryClient,
} from '../../lib/ui.js';
import {
  hostDbQuery,
  hostDbExec,
  setMenu,
  isStandalone,
  publishIykeState,
  hostNavigate,
  hostSendToActiveSession,
} from '../../lib/bridge.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

const CHANNELS = ['email', 'newsletter', 'sequences', 'social'];

const CHANNEL_META = {
  email: {
    label: 'Email',
    icon: 'mail',
    subtitle: 'Transactional · Cold · Drip',
    views: ['queue', 'schedule', 'sent'],
    viewLabels: { queue: 'Approval queue', schedule: 'Schedule', sent: 'Sent' },
  },
  newsletter: {
    label: 'Newsletter',
    icon: 'book-open',
    subtitle: 'Campaigns · Investor updates',
    views: ['queue', 'schedule', 'sent'],
    viewLabels: { queue: 'Approval queue', schedule: 'Schedule', sent: 'Sent' },
  },
  sequences: {
    label: 'Sequences',
    icon: 'git-branch',
    subtitle: 'Per-recipient drip chains',
    views: ['queue', 'schedule', 'sent'],
    // G-11 rule: Sequences "Schedule" tab = "Active" (sequences run per-recipient)
    viewLabels: { queue: 'Approval queue', schedule: 'Active', sent: 'Sent' },
  },
  social: {
    label: 'Social',
    icon: 'share2',
    subtitle: 'Buffer · LinkedIn · X',
    views: ['queue', 'schedule', 'sent'],
    viewLabels: { queue: 'Approval queue', schedule: 'Schedule', sent: 'Sent' },
  },
};

// Agent filter items (By agent group — filter semantics)
const AGENT_ITEMS = [
  { id: 'f:pa',  label: 'PA',  section: 'By agent' },
  { id: 'f:cmo', label: 'CMO', section: 'By agent' },
  { id: 'f:cbo', label: 'CBO', section: 'By agent' },
];

// ─── Menu builder ───────────────────────────────────────────────────────────────

/**
 * Build the flat menu item list for setMenu.
 * @param {string} channel  current channel (email/newsletter/sequences/social)
 * @param {string} view     current view (queue/schedule/sent)
 * @param {Object} counts   { email, newsletter, sequences, social } queue counts
 * @param {Object} agents   { pa, cmo, cbo } agent counts
 */
function buildOutboundMenu(channel, view, counts = {}, agents = {}) {
  // Channels group (view kind = mutually exclusive radio)
  const channelItems = CHANNELS.map((ch) => {
    const meta = CHANNEL_META[ch];
    const count = counts[ch] ?? 0;
    return {
      id: `ch:${ch}`,
      label: meta.label,
      icon: meta.icon,
      section: 'Channels',
      active: ch === channel,
      hot: count > 0,
      badge: count > 0 ? count : undefined,
    };
  });

  // By-agent group (filter kind = non-exclusive facets)
  // Dims when view !== 'queue' (toolbar-facet-sidebar pattern)
  const isQueueView = view === 'queue';
  const agentItems = AGENT_ITEMS.map((it) => {
    const key = it.id.replace('f:', '');
    const count = agents[key] ?? 0;
    return {
      ...it,
      active: false,
      disabled: !isQueueView,
      badge: count > 0 ? count : undefined,
    };
  });

  return [...channelItems, ...agentItems];
}

// ─── Queries ───────────────────────────────────────────────────────────────────

async function fetchChannelCounts() {
  // Returns queue counts from the new + existing tables.
  // Real tables: outbound_email_approvals, fundraising_outreach (email),
  //              outbound_newsletter_drafts (newsletter),
  //              outbound_sequences (sequences — active status),
  //              social_queue (social — pending/in_review).
  // Falls back to 0 on error so the pane renders even before the migration.
  const results = { email: 0, newsletter: 0, sequences: 0, social: 0 };

  try {
    // Email: outbound_email_approvals pending + fundraising_outreach pending
    const emailRows = await hostDbQuery(
      `SELECT (SELECT COUNT(*) FROM outbound_email_approvals WHERE status = 'pending') +
              (SELECT COUNT(*) FROM fundraising_outreach WHERE status = 'pending') AS cnt`
    );
    results.email = emailRows?.[0]?.cnt ?? 0;
  } catch { /* table may not exist yet — use 0 */ }

  try {
    // Newsletter: outbound_newsletter_drafts pending
    const nlRows = await hostDbQuery(
      `SELECT COUNT(*) AS cnt FROM outbound_newsletter_drafts WHERE status = 'pending'`
    );
    results.newsletter = nlRows?.[0]?.cnt ?? 0;
  } catch { /* table may not exist yet — use 0 */ }

  try {
    // Sequences: outbound_sequences active (per-recipient chains in flight)
    const seqRows = await hostDbQuery(
      `SELECT COUNT(*) AS cnt FROM outbound_sequences WHERE status = 'active'`
    );
    results.sequences = seqRows?.[0]?.cnt ?? 0;
  } catch { /* table may not exist yet — use 0 */ }

  try {
    // Social: social_queue items pending review / in-review
    const socRows = await hostDbQuery(
      `SELECT COUNT(*) AS cnt FROM social_queue WHERE status IN ('pending','in_review')`
    );
    results.social = socRows?.[0]?.cnt ?? 0;
  } catch { /* social_queue may be empty */ }

  return results;
}

async function fetchAgentCounts(channel) {
  // Returns by-agent queue counts for the current channel.
  // drafted_by values: 'pa', 'cmo', 'cbo' (or agent id strings).
  const results = { pa: 0, cmo: 0, cbo: 0 };
  try {
    let sql;
    if (channel === 'email') {
      sql = `SELECT COALESCE(LOWER(drafted_by),'pa') AS agent, COUNT(*) AS cnt
             FROM outbound_email_approvals WHERE status = 'pending'
             GROUP BY drafted_by`;
    } else if (channel === 'newsletter') {
      sql = `SELECT COALESCE(LOWER(drafted_by),'cmo') AS agent, COUNT(*) AS cnt
             FROM outbound_newsletter_drafts WHERE status = 'pending'
             GROUP BY drafted_by`;
    } else {
      return results;
    }
    const rows = await hostDbQuery(sql);
    for (const row of rows ?? []) {
      const key = String(row.agent ?? '').toLowerCase();
      if (key in results) results[key] = row.cnt ?? 0;
    }
  } catch { /* table not yet migrated — use fixture defaults */ }
  return results;
}

// ─── Email channel queries ───────────────────────────────────────────────────────

async function fetchEmailQueue() {
  // Approval queue: outbound_email_approvals + fundraising_outreach (cold)
  const rows = [];

  try {
    const approval = await hostDbQuery(
      `SELECT id, subject, body, recipient_email, recipient_name, channel,
              status, ux_mode, drafted_by, sequence_id, scheduled_for, is_overdue,
              'approval' AS src
       FROM outbound_email_approvals
       WHERE status = 'pending'
       ORDER BY is_overdue DESC, scheduled_for ASC
       LIMIT 50`
    );
    rows.push(...(approval ?? []));
  } catch { /* not yet migrated */ }

  try {
    const cold = await hostDbQuery(
      `SELECT id, subject, '' AS recipient_email, '' AS recipient_name,
              channel, status, 'approve' AS ux_mode, drafted_by,
              NULL AS scheduled_for, 0 AS is_overdue, 'cold' AS src,
              deal_id
       FROM fundraising_outreach
       WHERE status = 'pending'
       ORDER BY id DESC
       LIMIT 20`
    );
    rows.push(...(cold ?? []));
  } catch { /* table may be empty */ }

  // Fallback fixture if no real data
  if (rows.length === 0) {
    return FIXTURE_EMAIL_QUEUE;
  }
  return rows;
}

async function fetchEmailSchedule() {
  try {
    const rows = await hostDbQuery(
      `SELECT id, subject, recipient_email, recipient_name, channel,
              status, scheduled_for, ux_mode
       FROM outbound_email_approvals
       WHERE status IN ('scheduled','approved') AND ux_mode = 'silent'
       ORDER BY scheduled_for ASC
       LIMIT 30`
    );
    return rows?.length ? rows : FIXTURE_EMAIL_SCHEDULE;
  } catch {
    return FIXTURE_EMAIL_SCHEDULE;
  }
}

async function fetchEmailSent() {
  try {
    const rows = await hostDbQuery(
      `SELECT id, subject, recipient_email, channel,
              delivery_system, sent_at, open_rate, click_rate
       FROM outbound_sent_log
       WHERE channel = 'email'
       ORDER BY sent_at DESC
       LIMIT 50`
    );
    return rows?.length ? rows : FIXTURE_EMAIL_SENT;
  } catch {
    return FIXTURE_EMAIL_SENT;
  }
}

// ─── Newsletter queries ─────────────────────────────────────────────────────────

async function fetchNewsletterQueue() {
  try {
    const rows = await hostDbQuery(
      `SELECT id, subject, subject_b, draft_slug, edition, status,
              cooling_until, quality_score, recipient_count,
              delivery_system, drafted_by, has_ab, body
       FROM outbound_newsletter_drafts
       WHERE status IN ('pending','cooling','approved')
       ORDER BY CASE status WHEN 'cooling' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                quality_score DESC
       LIMIT 20`
    );
    return rows?.length ? rows : FIXTURE_NL_QUEUE;
  } catch {
    return FIXTURE_NL_QUEUE;
  }
}

async function fetchNewsletterSent() {
  try {
    const rows = await hostDbQuery(
      `SELECT id, draft_slug, edition, subject, delivery_system,
              sent_at, recipient_count, open_rate, click_rate
       FROM newsletter_sends
       ORDER BY sent_at DESC
       LIMIT 30`
    );
    return rows?.length ? rows : FIXTURE_NL_SENT;
  } catch {
    return FIXTURE_NL_SENT;
  }
}

// ─── Sequences queries ──────────────────────────────────────────────────────────

async function fetchSequenceDefs() {
  try {
    const rows = await hostDbQuery(
      `SELECT id, name, slug, segment, total_steps,
              delivery_system, status
       FROM email_sequences
       ORDER BY name ASC`
    );
    return rows?.length ? rows : FIXTURE_SEQ_DEFS;
  } catch {
    return FIXTURE_SEQ_DEFS;
  }
}

async function fetchActiveSequences() {
  try {
    const rows = await hostDbQuery(
      `SELECT os.id, os.sequence_id, os.contact_email, os.segment,
              os.current_step, os.total_steps, os.next_send_date,
              os.status, os.sent_count,
              es.name AS sequence_name, es.slug AS sequence_slug,
              es.delivery_system
       FROM outbound_sequences os
       LEFT JOIN email_sequences es ON es.id = os.sequence_id
       WHERE os.status = 'active'
       ORDER BY os.next_send_date ASC
       LIMIT 50`
    );
    return rows?.length ? rows : FIXTURE_ACTIVE_SEQS;
  } catch {
    return FIXTURE_ACTIVE_SEQS;
  }
}

// Sequences awaiting approval — defs whose status is 'pending'/'draft'/'in_review'.
// The step-rail master/detail reads these. Falls back to active defs as a stand-in
// when no review queue exists yet (so the rail renders rather than empty-stating).
async function fetchSequenceQueue() {
  try {
    const rows = await hostDbQuery(
      `SELECT id, name, slug, description, segment, total_steps,
              delivery_system, status, created_by, created_at
       FROM email_sequences
       WHERE status IN ('pending','draft','in_review','review')
       ORDER BY created_at DESC
       LIMIT 30`
    );
    return rows?.length ? rows : FIXTURE_SEQ_QUEUE;
  } catch {
    return FIXTURE_SEQ_QUEUE;
  }
}

// Step definitions for one sequence (the vertical step-rail in the detail pane).
// outbound_sequence_steps may be empty (0 rows live) → caller falls back to a
// graceful empty state rather than fabricating steps.
async function fetchSequenceSteps(sequenceId) {
  if (!sequenceId) return [];
  try {
    const rows = await hostDbQuery(
      `SELECT id, sequence_id, step_number, subject, body,
              delay_value, delay_unit, channel, status
       FROM outbound_sequence_steps
       WHERE sequence_id = ?
       ORDER BY step_number ASC`,
      [sequenceId]
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

// Per-recipient rows for one running sequence (the cohort grid in the Active view).
// Derives tile state from status + current_step + last_reply_at.
async function fetchSequenceRecipients(sequenceId) {
  if (!sequenceId) return [];
  try {
    const rows = await hostDbQuery(
      `SELECT id, contact_email, segment, current_step, total_steps,
              status, sent_count, last_reply_at, pause_reason, next_send_date
       FROM outbound_sequences
       WHERE sequence_id = ?
       ORDER BY current_step DESC, id ASC
       LIMIT 200`,
      [sequenceId]
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

// Completed/closed sequence cohorts for the Sent funnel view.
async function fetchSentSequences() {
  try {
    const rows = await hostDbQuery(
      `SELECT os.sequence_id,
              es.name AS sequence_name, es.slug AS sequence_slug,
              es.total_steps,
              COUNT(*) AS enrolled,
              SUM(CASE WHEN os.status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN os.last_reply_at IS NOT NULL THEN 1 ELSE 0 END) AS replied,
              SUM(CASE WHEN os.status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
              SUM(os.sent_count) AS sent_total,
              MAX(os.updated_at) AS closed_at
       FROM outbound_sequences os
       LEFT JOIN email_sequences es ON es.id = os.sequence_id
       WHERE os.status IN ('completed','bounced','stopped')
       GROUP BY os.sequence_id
       ORDER BY closed_at DESC
       LIMIT 30`
    );
    return rows?.length ? rows : FIXTURE_SENT_SEQS;
  } catch {
    return FIXTURE_SENT_SEQS;
  }
}

// Relative-age label for the reply-intelligence "last touch" cell.
function relDays(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = Math.round((Date.now() - t) / 86_400_000);
  if (d <= 0) return 'today';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.round(d / 7)}w ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

// Reply-intelligence: CRM context for an email recipient (B.5). There is no
// dedicated `tenants`/Twenty mirror in ikenga.db, but the local `contacts` table
// IS the CRM mirror — joined here by email, with a real open balance pulled from
// `receivables` by customer_email. Returns null (→ "unknown sender" empty state)
// when no contact matches, so nothing is fabricated for unknown recipients.
async function fetchReplyIntelligence(email) {
  if (!email) return null;
  try {
    const rows = await hostDbQuery(
      `SELECT email, name, organization, contact_type, last_seen_at, interaction_count, notes
       FROM contacts WHERE LOWER(email) = LOWER(?) LIMIT 1`,
      [email]
    );
    const c = rows?.[0];
    if (!c) return null;

    // Real open balance + overdue flag from receivables for this email.
    let bal = null;
    let overdue = 0;
    try {
      const br = await hostDbQuery(
        `SELECT SUM(CAST(balance_left AS REAL)) AS bal,
                SUM(CASE WHEN invoice_status = 'overdue' THEN 1 ELSE 0 END) AS od
         FROM receivables WHERE LOWER(customer_email) = LOWER(?)`,
        [email]
      );
      bal = br?.[0]?.bal ?? null;
      overdue = Number(br?.[0]?.od ?? 0);
    } catch {
      /* receivables lookup is best-effort */
    }

    // Health derived from contact recency (no stored health column).
    const lastMs = c.last_seen_at ? Date.parse(c.last_seen_at) : NaN;
    const ageDays = Number.isFinite(lastMs) ? (Date.now() - lastMs) / 86_400_000 : null;
    const health = ageDays == null ? '—' : ageDays < 30 ? 'Active' : ageDays < 90 ? 'Cooling' : 'Dormant';
    const ic = c.interaction_count == null ? null : Number(c.interaction_count);

    return {
      tenant_name: c.organization || c.name || email,
      tenant_sub: c.contact_type || null,
      last_touch: c.last_seen_at ? relDays(c.last_seen_at) : '—',
      last_touch_sub: ic == null ? null : `${ic} interaction${ic === 1 ? '' : 's'}`,
      health,
      health_sub: ageDays == null ? null : `${Math.round(ageDays)}d since contact`,
      catalog: '—',
      catalog_sub: 'no catalog link',
      open_balance: bal == null ? '—' : `$${Math.round(bal).toLocaleString()}`,
      balance_sub: overdue > 0 ? `${overdue} overdue` : bal != null ? 'current' : null,
      owner: '—',
      owner_sub: null,
      risk_flag: overdue > 0 ? 'Overdue invoice' : 'None',
      risk_color: overdue > 0 ? 'var(--danger)' : 'var(--live)',
    };
  } catch {
    return null;
  }
}

// ─── Social queries ─────────────────────────────────────────────────────────────

async function fetchSocialQueue() {
  try {
    const rows = await hostDbQuery(
      `SELECT id, platform, account, content, status,
              scheduled_for, approved_at, approved_by, source, slug, title
       FROM social_queue
       WHERE status IN ('pending','in_review')
       ORDER BY scheduled_for ASC
       LIMIT 30`
    );
    return rows?.length ? rows : FIXTURE_SOCIAL_QUEUE;
  } catch {
    return FIXTURE_SOCIAL_QUEUE;
  }
}

async function fetchSocialSchedule() {
  try {
    const rows = await hostDbQuery(
      `SELECT id, platform, account, content, status,
              scheduled_for, approved_at, source
       FROM social_queue
       WHERE status IN ('scheduled','approved')
       ORDER BY scheduled_for ASC
       LIMIT 30`
    );
    return rows?.length ? rows : FIXTURE_SOCIAL_SCHEDULE;
  } catch {
    return FIXTURE_SOCIAL_SCHEDULE;
  }
}

async function fetchSocialSent() {
  try {
    const rows = await hostDbQuery(
      `SELECT id, platform, account, content, status,
              scheduled_for, posted_at, source
       FROM social_queue
       WHERE status = 'posted'
       ORDER BY posted_at DESC
       LIMIT 30`
    );
    return rows?.length ? rows : FIXTURE_SOCIAL_SENT;
  } catch {
    return FIXTURE_SOCIAL_SENT;
  }
}

// ─── Approval mutations ────────────────────────────────────────────────────────

async function approveEmailDraft(id, src) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (src === 'cold') {
    await hostDbExec(
      `UPDATE fundraising_outreach SET status='approved', approved_by='operator', approved_at=? WHERE id=?`,
      [now, id]
    );
  } else {
    await hostDbExec(
      `UPDATE outbound_email_approvals SET status='approved', approved_by='operator', approved_at=? WHERE id=?`,
      [now, id]
    );
  }
}

async function rejectEmailDraft(id, src, reason = null) {
  if (src === 'cold') {
    await hostDbExec(`UPDATE fundraising_outreach SET status='rejected' WHERE id=?`, [id]);
  } else {
    await hostDbExec(
      `UPDATE outbound_email_approvals SET status='rejected', rejected_reason=? WHERE id=?`,
      [reason, id]
    );
  }
}

async function approveNewsletterDraft(id) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await hostDbExec(
    `UPDATE outbound_newsletter_drafts SET status='approved', approved_by='operator', approved_at=? WHERE id=?`,
    [now, id]
  );
}

async function rejectNewsletterDraft(id, reason = null) {
  await hostDbExec(
    `UPDATE outbound_newsletter_drafts SET status='rejected', rejected_reason=? WHERE id=?`,
    [reason, id]
  );
}

async function approveSocialPost(id) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await hostDbExec(
    `UPDATE social_queue SET status='approved', approved_at=?, approved_by='operator' WHERE id=?`,
    [now, id]
  );
}

async function rejectSocialPost(id, reason = null) {
  // social_queue has no rejected_reason column — record the reason in `error`
  // (the row's free-text status field) so the writer-agent dataset still captures it.
  await hostDbExec(
    `UPDATE social_queue SET status='rejected', error=? WHERE id=?`,
    [reason, id]
  );
}

async function rejectSequence(id, reason = null) {
  // email_sequences may lack a rejected_reason column; try it, fall back to
  // status-only so a missing column never throws the reject path.
  try {
    await hostDbExec(
      `UPDATE email_sequences SET status='rejected', rejected_reason=? WHERE id=?`,
      [reason, id]
    );
  } catch {
    await hostDbExec(`UPDATE email_sequences SET status='rejected' WHERE id=?`, [id]);
  }
}

// Fan-out siblings: rows sharing the selected post's `slug` (one approved post
// fans out to N platform rows). social_queue has no group_id, so slug is the
// natural grouping key. Returns [] when slug is null (one-off post).
async function fetchSocialFanout(slug) {
  if (!slug) return [];
  try {
    const rows = await hostDbQuery(
      `SELECT id, platform, content, status, scheduled_for, error
       FROM social_queue
       WHERE slug = ?
       ORDER BY platform ASC`,
      [slug]
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

// ─── Fixture data (fallback until real rows exist) ──────────────────────────────

const FIXTURE_EMAIL_QUEUE = [
  { id: 'eq-1', subject: 'Re: Royalti onboarding · file processing', recipient_name: 'Valentim de Carvalho', recipient_email: 'valentim@example.com', channel: 'smtp', status: 'pending', ux_mode: 'approve', is_overdue: 1, src: 'approval', scheduled_for: null, drafted_by: 'cmo' },
  { id: 'eq-2', subject: 'Welcome — your Royalti tenant is ready', recipient_name: '{{first_name}}', recipient_email: '', channel: 'resend', status: 'pending', ux_mode: 'approve', is_overdue: 0, src: 'approval', scheduled_for: 'Today 14:30', drafted_by: 'pa' },
  { id: 'eq-3', subject: 'Q2 product roundup · for label admins', recipient_name: 'label admins segment', recipient_email: '', channel: 'listmonk', status: 'pending', ux_mode: 'approve', is_overdue: 0, src: 'approval', scheduled_for: 'Today 16:00', drafted_by: 'cmo' },
  { id: 'eq-4', subject: 'Quick check-in · still using Royalti?', recipient_name: 'no-catalog signups', recipient_email: '', channel: 'listmonk', status: 'pending', ux_mode: 'approve', is_overdue: 0, src: 'approval', scheduled_for: 'Mon 09:00', drafted_by: 'pa' },
];

const FIXTURE_EMAIL_SCHEDULE = [
  { id: 'es-1', subject: 'Q2 product roundup · for label admins', channel: 'listmonk', status: 'scheduled', scheduled_for: 'Today 16:00', ux_mode: 'silent' },
  { id: 'es-2', subject: 'Quick check-in · still using Royalti?', channel: 'listmonk', status: 'scheduled', scheduled_for: 'Mon 09:00', ux_mode: 'silent' },
];

const FIXTURE_EMAIL_SENT = [
  { id: 'sent-1', subject: 'Royalti tenant welcome', recipient_email: 'batch', channel: 'resend', delivery_system: 'resend', sent_at: '2026-05-15 10:00', open_rate: 0.68, click_rate: 0.21 },
  { id: 'sent-2', subject: 'Q1 product update', recipient_email: 'label admins', channel: 'listmonk', delivery_system: 'listmonk', sent_at: '2026-04-30 14:00', open_rate: 0.55, click_rate: 0.18 },
];

const FIXTURE_NL_QUEUE = [
  { id: 'nl-1', subject: 'You can deliver from Royalti now', subject_b: null, draft_slug: 'royalti-deliver', status: 'cooling', cooling_until: '47m', quality_score: 92, recipient_count: 2104, delivery_system: 'listmonk', drafted_by: 'cmo', has_ab: 0,
    body: "## Delivery is live\n\nYou can now send releases to 150+ stores straight from Royalti — no third-party aggregator in the loop.\n\nWe spent the last quarter wiring DDEX delivery into the catalog you already manage. Your splits, your assets, one button.\n\n## What changed\n\nAcross 2,104 labels in the beta, median time-to-store dropped from 9 days to under 48 hours.\n\nDelivery status now streams back into the release timeline, so you see takedowns and edits without leaving the app.\n\nRead the full walkthrough in the docs, then deliver your next release and tell us how it went." },
  { id: 'nl-2', subject: 'Schema patches that unblocked tenant 590', subject_b: 'The shape disparity that was eating royalty data', draft_slug: 'schema-patches-590', status: 'pending', cooling_until: null, quality_score: 86, recipient_count: 2104, delivery_system: 'listmonk', drafted_by: 'cmo', has_ab: 1,
    body: "## The bug behind the numbers\n\nTenant 590 reported royalty totals that drifted 3% from their DSP statements. The cause wasn't the math — it was the shape of the data.\n\n## What we found\n\nTwo report formats encoded the same sale type under different keys, so a JOIN silently dropped rows.\n\nWe added a normalization pass and backfilled 11 months of history. Totals now reconcile to the cent.\n\nIf you import from more than one source, run the new reconcile check and let us know what it surfaces." },
];

const FIXTURE_NL_SENT = [
  { id: 'ns-1', draft_slug: 'schema-patches-590', edition: 'May 2026', subject: 'Schema patches that unblocked tenant 590', delivery_system: 'listmonk', sent_at: '2026-05-06 10:00', recipient_count: 2104, open_rate: 0.61, click_rate: 0.14 },
  { id: 'ns-2', draft_slug: 'investor-may', edition: 'Investor May 2026', subject: 'Investor Update — May', delivery_system: 'listmonk', sent_at: '2026-05-08 14:00', recipient_count: null, open_rate: null, click_rate: null },
];

const FIXTURE_SEQ_DEFS = [
  { id: 'seq-1', name: 'Cold A&R outreach', slug: 'seq3-universal-pt', segment: 'ar@universalmusic.pt', total_steps: 4, delivery_system: 'smtp', status: 'active' },
  { id: 'seq-2', name: 'Onboarding welcome', slug: 'onboard-welcome', segment: 'new tenants', total_steps: 3, delivery_system: 'resend', status: 'active' },
  { id: 'seq-3', name: 'L5 winback', slug: 'l5-winback', segment: '388 churned', total_steps: 5, delivery_system: 'listmonk', status: 'active' },
  { id: 'seq-4', name: 'Q2 product roundup', slug: 'q2-product-roundup', segment: 'label admins', total_steps: 2, delivery_system: 'listmonk', status: 'active' },
];

const FIXTURE_ACTIVE_SEQS = [
  { id: 'os-1', sequence_id: 'seq-1', contact_email: 'ar@universalmusic.pt', segment: 'A&R', current_step: 1, total_steps: 4, next_send_date: '2026-06-07', status: 'active', sent_count: 1, sequence_name: 'Cold A&R outreach', sequence_slug: 'seq3-universal-pt', delivery_system: 'smtp' },
  { id: 'os-2', sequence_id: 'seq-2', contact_email: 'batch', segment: 'new tenants', current_step: 1, total_steps: 3, next_send_date: '2026-06-08', status: 'active', sent_count: 388, sequence_name: 'Onboarding welcome', sequence_slug: 'onboard-welcome', delivery_system: 'resend' },
  { id: 'os-3', sequence_id: 'seq-3', contact_email: 'batch', segment: '388 churned', current_step: 7, total_steps: 5, next_send_date: '2026-06-09', status: 'active', sent_count: 388, sequence_name: 'L5 winback', sequence_slug: 'l5-winback', delivery_system: 'listmonk' },
  { id: 'os-4', sequence_id: 'seq-4', contact_email: 'batch', segment: 'label admins', current_step: 1, total_steps: 2, next_send_date: '2026-06-10', status: 'active', sent_count: 0, sequence_name: 'Q2 product roundup', sequence_slug: 'q2-product-roundup', delivery_system: 'listmonk' },
];

const FIXTURE_SEQ_QUEUE = [
  { id: 'seq-q1', name: 'distributor-q3', slug: 'distributor-q3', description: 'Cold outbound to 14 distributor leads sourced from Q1 trade-show contacts. 4 steps over 21 days.', segment: 'distributor-leads-q1', total_steps: 4, delivery_system: 'resend', status: 'in_review', created_by: 'vp-sales-agent', created_at: '2026-04-28' },
  { id: 'seq-q2', name: 'label-onboarding-v3', slug: 'label-onboarding-v3', description: 'Replaces v2. New labels get 5 emails over 14 days walking them from signup → first statement ingested.', segment: 'new-labels', total_steps: 5, delivery_system: 'listmonk', status: 'in_review', created_by: 'pa', created_at: '2026-04-27' },
];

const FIXTURE_SEQ_STEPS = [
  { id: 'st-1', step_number: 1, subject: 'Royalti deck for distributor onboarding', body: '"Hi [first name] — saw we connected at [event]. Royalti is the royalty + rights ops layer label/distributor teams use to get statements ingested in seconds, not days…"', delay_value: 0, delay_unit: 'days', channel: 'resend', status: 'active' },
  { id: 'st-2', step_number: 2, subject: 'Following up on the Royalti deck', body: '"Wanted to circle back on the deck I sent — happy to walk you through it on a 15-min call, or send a Loom if async is easier…"', delay_value: 3, delay_unit: 'days', channel: 'resend', status: 'active' },
  { id: 'st-3', step_number: 3, subject: 'A short Royalti customer story', body: '"Quick story from a Lagos label that ingested 880 contracts in a week — the part that surprised them was [insert]…"', delay_value: 7, delay_unit: 'days', channel: 'resend', status: 'active' },
  { id: 'st-4', step_number: 4, subject: 'Closing the loop · last note', body: '"I\'ll stop here so I\'m not crowding the inbox. If you want to pick this up later, the deck and a 15-min slot are at [link]…"', delay_value: 11, delay_unit: 'days', channel: 'resend', status: 'active' },
];

const FIXTURE_SENT_SEQS = [
  { sequence_id: 'seq-s1', sequence_name: 'distributor-q2', sequence_slug: 'distributor-q2', total_steps: 4, enrolled: 18, completed: 6, replied: 4, bounced: 1, sent_total: 52, closed_at: '2026-03-30' },
  { sequence_id: 'seq-s2', sequence_name: 'winback-l4', sequence_slug: 'winback-l4', total_steps: 3, enrolled: 240, completed: 88, replied: 31, bounced: 12, sent_total: 612, closed_at: '2026-03-12' },
];

const FIXTURE_SEQ_RECIPIENTS = [
  { id: 'r1', contact_email: 'a@dist.pt', current_step: 4, total_steps: 4, status: 'completed', last_reply_at: null },
  { id: 'r2', contact_email: 'b@dist.pt', current_step: 2, total_steps: 4, status: 'active', last_reply_at: '2026-04-28' },
  { id: 'r3', contact_email: 'c@dist.pt', current_step: 3, total_steps: 4, status: 'active', last_reply_at: null },
  { id: 'r4', contact_email: 'd@dist.pt', current_step: 3, total_steps: 4, status: 'active', last_reply_at: null },
  { id: 'r5', contact_email: 'e@dist.pt', current_step: 2, total_steps: 4, status: 'active', last_reply_at: null },
  { id: 'r6', contact_email: 'f@dist.pt', current_step: 2, total_steps: 4, status: 'active', last_reply_at: null },
  { id: 'r7', contact_email: 'g@dist.pt', current_step: 2, total_steps: 4, status: 'active', last_reply_at: null },
  { id: 'r8', contact_email: 'h@dist.pt', current_step: 2, total_steps: 4, status: 'active', last_reply_at: null },
  { id: 'r9', contact_email: 'i@dist.pt', current_step: 1, total_steps: 4, status: 'active', last_reply_at: null },
  { id: 'r10', contact_email: 'j@dist.pt', current_step: 1, total_steps: 4, status: 'active', last_reply_at: null },
  { id: 'r11', contact_email: 'k@dist.pt', current_step: 1, total_steps: 4, status: 'active', last_reply_at: null },
  { id: 'r12', contact_email: 'l@dist.pt', current_step: 1, total_steps: 4, status: 'bounced', last_reply_at: null },
  { id: 'r13', contact_email: 'm@dist.pt', current_step: 1, total_steps: 4, status: 'bounced', last_reply_at: null },
  { id: 'r14', contact_email: 'n@dist.pt', current_step: 1, total_steps: 4, status: 'active', last_reply_at: null },
];

const FIXTURE_SOCIAL_QUEUE = [
  { id: 'sq-1', platform: 'linkedin', account: 'Royalti', content: 'Royalti.io is now live for music labels — handle your full royalty pipeline from one workspace.', status: 'in_review', scheduled_for: '2026-06-07 09:00', source: 'C-07' },
  { id: 'sq-2', platform: 'twitter', account: 'royalti_io', content: 'Thread 1/7: The royalty data problem nobody talks about. \n\nMusic labels spend 40+ hours per month reconciling statements from distributors. Here\'s how we fixed it.', status: 'pending', scheduled_for: '2026-06-10 09:00', source: 'C-08' },
];

const FIXTURE_SOCIAL_SCHEDULE = [
  { id: 'sq-2', platform: 'twitter', account: 'royalti_io', content: 'Thread 1/7: The royalty data problem nobody talks about.', status: 'scheduled', scheduled_for: '2026-06-10 09:00', source: 'C-08' },
];

const FIXTURE_SOCIAL_SENT = [
  { id: 'sq-0', platform: 'linkedin', account: 'Royalti', content: 'We\'ve built a workspace that puts royalty data, outreach, and reporting in one place.', status: 'posted', scheduled_for: '2026-06-01 09:00', posted_at: '2026-06-01 09:01', source: 'C-06' },
];

// ─── Small helpers ─────────────────────────────────────────────────────────────

function ChannelChip({ channel }) {
  const cls = {
    resend: 'channel-resend',
    listmonk: 'channel-listmonk',
    smtp: 'channel-smtp',
    buffer: 'channel-buffer',
  }[channel?.toLowerCase()] ?? '';
  const label = channel ?? '—';
  return html`<span class=${cn('ob-chip', cls)}>${label}</span>`;
}

function PlatformBadge({ platform }) {
  const label = platform ?? '—';
  return html`<span class=${cn('ob-platform-badge', platform)}>${label}</span>`;
}

function QualityChip({ score }) {
  if (!score) return null;
  const cls = score >= 80 ? 'quality high' : 'quality';
  return html`<span class=${cn('ob-chip', cls)}>${score}/100</span>`;
}

function CoolingChip({ until }) {
  if (!until) return null;
  return html`<span class="ob-chip cooling">cooling ${until}</span>`;
}

function OverdueChip() {
  return html`<span class="ob-chip overdue">overdue</span>`;
}

function formatPct(v) {
  if (v == null) return '—';
  return (Number(v) * 100).toFixed(0) + '%';
}

function formatDate(v) {
  if (!v) return '—';
  return String(v);
}

function wordCount(text) {
  if (!text) return 0;
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

// ─── Newsletter body text metrics (B.6) ──────────────────────────────────────
// These are computed directly from the draft body — real signals, no external
// pipeline. The remaining cells (Claims verified, Freshness, Previously
// featured) need a claims-verifier / sent-history join and stay honest
// placeholders until those land.

const ANTI_PATTERN_TERMS = [
  'revolutionary', 'game-changer', 'game changer', 'synergy', 'disrupt', 'disruptive',
  'cutting-edge', 'best-in-class', 'world-class', 'seamless', 'leverage', 'unlock',
  'supercharge', 'unprecedented', 'paradigm', 'next-level', 'must-have', 'no-brainer',
  'skyrocket', 'effortless', 'turnkey', 'bleeding-edge',
];

function countAntiPatterns(text) {
  if (!text) return 0;
  const t = String(text).toLowerCase();
  let n = 0;
  for (const term of ANTI_PATTERN_TERMS) {
    const esc = term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const m = t.match(new RegExp(`\\b${esc}\\b`, 'g'));
    if (m) n += m.length;
  }
  return n;
}

// Distinct sections — markdown/HTML headings if present, else paragraph blocks.
function countSections(text) {
  if (!text) return 0;
  const headings = (text.match(/^#{1,6}\s/gim) || []).length + (text.match(/<h[1-6][\s>]/gi) || []).length;
  if (headings) return headings;
  return String(text).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).length;
}

function countCtas(text) {
  if (!text) return { ctas: 0, bangs: 0 };
  const bangs = (text.match(/!/g) || []).length;
  const links = (text.match(/https?:\/\/|\]\([^)]+\)|<a[\s>]/gi) || []).length;
  const phrases = (text.match(/\b(read more|learn more|sign up|get started|try it|book a|claim your|subscribe|download|join now|see how|get the)\b/gi) || []).length;
  return { ctas: links + phrases, bangs };
}

// Verifiable factual claims present in the body (percentages, $amounts, counts).
// This counts claims to be checked — it does NOT assert verification.
function countClaims(text) {
  if (!text) return 0;
  return (text.match(/\d+(\.\d+)?\s?%|\$\s?\d|\b\d+x\b|\b\d{2,}\b/gi) || []).length;
}

// Per-platform hard character caps (design social §B).
const PLATFORM_CAPS = { linkedin: 3000, twitter: 280, x: 280, bluesky: 300, instagram: 2200 };

// Platforms the editor fans out to, with display handles + cap (design social §B).
const SOCIAL_PLATFORMS = [
  { key: 'linkedin', plat: 'plat-li', mark: 'LI', handle: 'Royalti.io', sub: 'LinkedIn', cap: 3000 },
  { key: 'x', plat: 'plat-x', mark: 'X', handle: '@royalti', sub: 'X', cap: 280 },
  { key: 'bluesky', plat: 'plat-bs', mark: 'BS', handle: '@royalti.io', sub: 'Bluesky', cap: 300 },
];

function charBarClass(len, cap) {
  if (len > cap) return 'is-bad';
  if (len > cap * 0.9) return 'is-warn';
  return '';
}

// Inline reject reason panel — 5 canned chips + freetext. Shared by all queues.
// onConfirm receives the assembled reason string (canned + freetext, joined).
function RejectPanel({ canned, onConfirm, onCancel, pending, placeholder }) {
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState('');

  const toggle = (c) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  const assemble = () => {
    const parts = [...picked];
    if (note.trim()) parts.push(note.trim());
    return parts.join(' · ') || null;
  };

  return html`
    <div class="ob-reject">
      <span class="ob-reject-label">Reject · why? (feeds the writer-agent training set)</span>
      <div class="ob-reject-canned">
        ${canned.map((c) => html`
          <button
            key=${c}
            class=${cn({ 'is-on': picked.includes(c) })}
            onClick=${() => toggle(c)}
          >${c}</button>
        `)}
      </div>
      <input
        type="text"
        value=${note}
        placeholder=${placeholder ?? 'Optional · add a note'}
        onInput=${(e) => setNote(e.target.value)}
      />
      <div class="ob-reject-row">
        <button class="ob-btn-sm" onClick=${onCancel}>Cancel</button>
        <button
          class="ob-btn-sm is-danger"
          onClick=${() => onConfirm(assemble())}
          disabled=${pending}
        >${pending ? 'Rejecting…' : 'Reject draft'}</button>
      </div>
    </div>
  `;
}

const EMAIL_REJECT_REASONS = ['Wrong recipient', 'Tone is off', 'Misses context', 'Already replied elsewhere', "Don't send · close out"];
const NL_REJECT_REASONS = ['Claim unverified', 'Hype / anti-pattern', 'Off-theme', 'Schedule conflict', 'Weak CTA'];
const SOCIAL_REJECT_REASONS = ['Tone is off', 'Off-message', 'Wrong angle', "Image doesn't match", 'Missing context'];
const SEQ_REJECT_REASONS = ['Cadence too aggressive', 'Wrong segment', 'Copy needs work', 'Timing is off', "Don't enrol · close out"];

// Build the 8 newsletter quality cells from the draft row (B.6). quality_score
// is a stored column; word count, anti-patterns, section variety and CTAs are
// computed directly from the body text (real signals). Claims, Freshness and
// Previously-featured need a claims-verifier / sent-history join that doesn't
// exist yet — they stay honest placeholders rather than fabricated numbers. Each
// cell: { label, value, sub, pct, tone } (tone = 'ok' | 'warn' | 'fail').
function newsletterQualityCells(row) {
  const score = row.quality_score;
  const body = row.body;
  const wc = wordCount(body);
  const wcOk = wc === 0 ? null : wc >= 350 && wc <= 500;
  const hasBody = !!body;

  const anti = countAntiPatterns(body);
  const sections = countSections(body);
  const { ctas, bangs } = countCtas(body);
  const claims = countClaims(body);

  return [
    {
      label: 'Quality score',
      value: score != null ? `${score}` : '—',
      sub: '/ 100',
      pct: score != null ? Math.min(100, score) : 0,
      tone: score == null ? 'warn' : score >= 80 ? 'ok' : score >= 70 ? 'warn' : 'fail',
    },
    {
      label: 'Word count',
      value: wc ? `${wc}` : '—',
      sub: 'target 350-500',
      pct: wc ? Math.min(100, Math.round((wc / 500) * 100)) : 0,
      tone: wcOk == null ? 'warn' : wcOk ? 'ok' : 'warn',
    },
    {
      label: 'Claims',
      value: hasBody ? `${claims}` : '—',
      sub: hasBody ? 'detected · unverified' : 'no body',
      pct: hasBody ? Math.min(100, claims * 12) : 0,
      // Honest: we can detect claims in the text but not verify them — a
      // verifier pipeline would flip this to ok/fail.
      tone: 'warn',
    },
    {
      label: 'Anti-patterns',
      value: hasBody ? `${anti}` : '—',
      sub: hasBody ? (anti === 0 ? 'none detected' : 'hype terms') : 'no body',
      pct: hasBody ? Math.max(0, 100 - anti * 25) : 0,
      tone: !hasBody ? 'warn' : anti === 0 ? 'ok' : anti <= 2 ? 'warn' : 'fail',
    },
    {
      label: 'Section variety',
      value: hasBody ? `${sections}` : '—',
      sub: 'distinct sections',
      pct: hasBody ? Math.min(100, sections * 25) : 0,
      tone: !hasBody ? 'warn' : sections >= 3 ? 'ok' : sections >= 2 ? 'warn' : 'fail',
    },
    // History-dependent — needs a sent-newsletter join (newsletter_sends /
    // outbound_sent_log) to be real. Honest placeholder until then.
    { label: 'Freshness', value: '—', sub: 'needs sent-history join', pct: 0, tone: 'warn' },
    { label: 'Previously featured', value: '—', sub: 'needs sent-history join', pct: 0, tone: 'warn' },
    {
      label: 'CTAs · exclamations',
      value: hasBody ? `${ctas} · ${bangs}!` : '—',
      sub: hasBody ? (bangs > 3 ? 'too many !' : 'CTAs · !') : 'no body',
      pct: hasBody ? Math.min(100, ctas * 25) : 0,
      tone: !hasBody ? 'warn' : bangs <= 3 && ctas >= 1 ? 'ok' : 'warn',
    },
  ];
}

// ─── State display ─────────────────────────────────────────────────────────────

function StateDisplay({ state, message, onRetry }) {
  return html`
    <div class=${cn('atelier-state', {
      'is-loading': state === 'loading',
      'is-empty': state === 'empty',
      'is-error': state === 'error',
      'is-streaming': state === 'streaming',
    })}>
      ${state === 'loading' && html`<div class="atelier-spin"></div>`}
      ${state === 'error' && html`<${Icon} name="alert-circle" size=${24} />`}
      ${state === 'empty' && html`<${Icon} name="inbox" size=${24} />`}
      ${state === 'streaming' && html`<div class="atelier-prog"></div>`}
      <p style=${{ color: 'var(--fg-muted)', fontSize: '0.825rem', margin: 0 }}>${message}</p>
      ${state === 'error' && onRetry && html`
        <button class="btn btn-sm" onClick=${onRetry}>Retry</button>
      `}
    </div>
  `;
}

// ─── Shared two-week schedule strip (design newsletter/email/social §E) ──────────
// Label column + 7 weekday columns × 2 week rows, with date numbers, a today
// marker, and a Lagos-timezone annotation. Pills are placed by parsing each
// item's scheduled_for into a real date and bucketing into the matching cell.

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfWeekMon(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return x;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseScheduled(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function TwoWeekCalendar({ items, renderPill }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const week0 = startOfWeekMon(today);

  // Build 14 day-cells (two weeks starting this Monday).
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(week0);
    d.setDate(week0.getDate() + i);
    days.push(d);
  }

  // Bucket items by day index; un-dated / out-of-range fall into week 0 day 0.
  const buckets = days.map(() => []);
  for (const it of items ?? []) {
    const d = parseScheduled(it.scheduled_for ?? it.sent_at ?? it.posted_at);
    let idx = 0;
    if (d) {
      const dd = new Date(d); dd.setHours(0, 0, 0, 0);
      const found = days.findIndex((x) => sameDay(x, dd));
      idx = found >= 0 ? found : 0;
    }
    buckets[idx].push(it);
  }

  const weekRow = (weekOffset) => {
    const base = days[weekOffset * 7];
    const labelText = `${String(base.getDate()).padStart(2, '0')} ${MONTH_ABBR[base.getMonth()]} · ${weekOffset === 0 ? 'this week' : 'next week'}`;
    return html`
      <div class="nl-cal-grid">
        <div class="gcell label">${labelText}</div>
        ${WEEKDAY_LABELS.map((_, di) => {
          const dayIdx = weekOffset * 7 + di;
          const d = days[dayIdx];
          const isToday = sameDay(d, today);
          return html`
            <div key=${dayIdx} class=${cn('gcell', { 'is-today': isToday })}>
              <div class="g-day-num">${String(d.getDate()).padStart(2, '0')}${isToday ? ' · today' : ''}</div>
              ${buckets[dayIdx].map((it, k) => renderPill(it, k))}
            </div>
          `;
        })}
      </div>
    `;
  };

  return html`
    <div class="nl-cal-wrap">
      <div class="nl-cal-2wk">
        <div class="nl-cal-tz">
          <${Icon} name="clock" size=${12} />
          <span>2 weeks · Lagos (UTC+1) default send window</span>
        </div>
        <div class="nl-cal-grid head">
          <div class="gcell label">Week</div>
          ${WEEKDAY_LABELS.map((d, i) => {
            const isToday = (today.getDay() + 6) % 7 === i;
            return html`<div key=${d} class=${cn('gcell', { 'is-today': isToday })}>${d}</div>`;
          })}
        </div>
        ${weekRow(0)}
        ${weekRow(1)}
      </div>
    </div>
  `;
}

// ─── Email views ────────────────────────────────────────────────────────────────

// Reply-intelligence panel — CRM context for an email recipient (design §B/C).
// Collapses to "unknown sender" when the tenants table has no record (the live
// case today: no CRM mirror in ikenga.db).
function ReplyIntelligence({ email, sequenceId, standalone }) {
  const { data: crm } = useQuery({
    queryKey: ['email', 'ri', email],
    queryFn: () => fetchReplyIntelligence(email),
    enabled: !standalone && !!email,
    placeholderData: null,
  });

  if (!crm) {
    return html`
      <div class="ri-panel">
        <div class="ri-panel-head"><span>Reply intelligence</span></div>
        <div class="ri-empty">
          <${Icon} name="user" size=${16} />
          <span><b>Unknown sender</b> — no CRM record${email ? html` for ${email}` : ''}. Create contact?</span>
        </div>
      </div>
    `;
  }

  const cell = (label, value, sub, color) => html`
    <div class="ri-cell">
      <div class="ri-cell-label">${label}</div>
      <div class="ri-cell-value" style=${color ? { color } : null}>${value ?? '—'}</div>
      ${sub ? html`<div class="ri-cell-sub">${sub}</div>` : null}
    </div>
  `;

  return html`
    <div class="ri-panel">
      <div class="ri-panel-head">
        <span>Reply intelligence</span>
        <span class="ob-chip seq" style=${{ marginLeft: 'auto' }}>CRM · contacts</span>
      </div>
      <div class="ri-grid">
        ${cell('Tenant', crm.tenant_name ?? crm.name, crm.tenant_sub)}
        ${cell('Last touch', crm.last_touch, crm.last_touch_sub)}
        ${cell('Health', crm.health, crm.health_sub)}
        ${cell('Sequence', sequenceId ? (crm.sequence ?? sequenceId) : '— none —', crm.sequence_sub ?? 'manual reply · not part of a run')}
        ${cell('Catalog', crm.catalog, crm.catalog_sub)}
        ${cell('Open balance', crm.open_balance, crm.balance_sub)}
        ${cell('Owner', crm.owner, crm.owner_sub)}
        ${cell('Risk flag', crm.risk_flag ?? 'None', crm.risk_sub, crm.risk_color ?? 'var(--live)')}
      </div>
    </div>
  `;
}

function EmailQueueView({ standalone }) {
  const [selected, setSelected] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['email', 'queue'],
    queryFn: fetchEmailQueue,
    enabled: !standalone,
    placeholderData: FIXTURE_EMAIL_QUEUE,
  });

  const qc = useQueryClient();
  const approveMut = useMutation({
    mutationFn: ({ id, src }) => approveEmailDraft(id, src),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['email'] }); qc.invalidateQueries({ queryKey: ['counts'] }); },
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, src, reason }) => rejectEmailDraft(id, src, reason),
    onSuccess: () => { setRejectOpen(false); qc.invalidateQueries({ queryKey: ['email'] }); qc.invalidateQueries({ queryKey: ['counts'] }); },
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading email queue…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load email queue" onRetry=${refetch} />`;
  if (!data?.length) return html`<${StateDisplay} state="empty" message="No email items awaiting approval" />`;

  const rows = data ?? [];
  const sel = selected ?? rows[0];

  const pick = (row) => { setSelected(row); setRejectOpen(false); };

  const sendToChat = () => {
    if (!sel) return;
    hostSendToActiveSession(
      `Help me edit this outbound email reply before I approve it.\n\nSubject: ${sel.subject}\nTo: ${sel.recipient_name || sel.recipient_email || 'segment'}\nDrafted by: ${sel.drafted_by ?? 'agent'}`,
    ).catch(() => {});
  };

  return html`
    <div class="nl-split">
      <div class="nl-master">
        ${rows.map(row => html`
          <div
            key=${row.id}
            class=${cn('nl-row', { 'is-on': sel?.id === row.id })}
            onClick=${() => pick(row)}
          >
            <div class="nl-row-head">
              <${ChannelChip} channel=${row.channel} />
              ${row.is_overdue ? html`<${OverdueChip} />` : null}
            </div>
            <div class="nl-row-subj">${row.subject}</div>
            <div class="nl-row-pre">${row.recipient_name || row.recipient_email || '—'}</div>
          </div>
        `)}
      </div>
      <div class="nl-detail">
        ${sel ? html`
          <div class="ob-detail-wrap">
            <div class="ip-head">
              <div class="ip-meta-row">
                <${ChannelChip} channel=${sel.channel} />
                ${sel.is_overdue ? html`<${OverdueChip} />` : null}
                <span style=${{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
                  ${sel.recipient_name || sel.recipient_email || '—'}
                </span>
              </div>
              <h2 style=${{ fontSize: '0.9rem', fontWeight: 600, margin: '0.5rem 0 0', color: 'var(--fg)' }}>
                ${sel.subject}
              </h2>
            </div>

            <${ReplyIntelligence} email=${sel.recipient_email} sequenceId=${sel.sequence_id} standalone=${standalone} />

            <div class="ip-body" style=${{ flex: 1, padding: '1rem', color: 'var(--fg-muted)', fontSize: '0.8125rem' }}>
              <p style=${{ margin: 0 }}>
                To: <strong style=${{ color: 'var(--fg)' }}>${sel.recipient_name || sel.recipient_email || 'segment'}</strong>
                ${sel.scheduled_for ? html` · Scheduled: <strong style=${{ color: 'var(--fg)' }}>${sel.scheduled_for}</strong>` : ''}
              </p>
              ${sel.body ? html`
                <p style=${{ marginTop: '0.75rem', color: 'var(--fg)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>${sel.body}</p>
              ` : null}
              <p style=${{ marginTop: '1rem', color: 'var(--fg-muted)' }}>
                Drafted by <strong style=${{ color: 'var(--fg)' }}>${sel.drafted_by ?? 'agent'}</strong>
              </p>
              ${sel.is_overdue ? html`
                <div class="ob-chip overdue" style=${{ display: 'inline-flex', marginTop: '0.5rem' }}>
                  Past scheduled time — approve to send now
                </div>
              ` : null}
            </div>

            ${rejectOpen ? html`
              <${RejectPanel}
                canned=${EMAIL_REJECT_REASONS}
                pending=${rejectMut.isPending}
                placeholder="Optional · why? (feeds the writer-agent training set)"
                onCancel=${() => setRejectOpen(false)}
                onConfirm=${(reason) => rejectMut.mutate({ id: sel.id, src: sel.src, reason })}
              />
            ` : null}

            <div class="ob-actions">
              <div class="ob-actions-primary">
                <button
                  class="btn"
                  style=${{ background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
                  onClick=${() => approveMut.mutate({ id: sel.id, src: sel.src })}
                  disabled=${approveMut.isPending}
                >
                  ${approveMut.isPending ? 'Approving…' : 'Approve & Send'}
                </button>
                <button class="btn btn-ghost" onClick=${() => setRejectOpen((o) => !o)}>
                  Reject
                </button>
              </div>
            </div>
            <div class="ob-actions-secondary">
              <button class="ob-btn-sm" onClick=${sendToChat}>⌘ Send to chat</button>
              <span class="ob-act-spacer"></span>
              <span class="ob-act-meta">${sel.scheduled_for ? `scheduled · ${sel.scheduled_for}` : 'no scheduled time'}</span>
            </div>
          </div>
        ` : html`<${StateDisplay} state="empty" message="Select an item to review" />`}
      </div>
    </div>
  `;
}

function EmailScheduleView({ standalone }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['email', 'schedule'],
    queryFn: fetchEmailSchedule,
    enabled: !standalone,
    placeholderData: FIXTURE_EMAIL_SCHEDULE,
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading schedule…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load schedule" onRetry=${refetch} />`;
  if (!data?.length) return html`<${StateDisplay} state="empty" message="No scheduled email" />`;

  return html`
    <${TwoWeekCalendar}
      items=${data ?? []}
      renderPill=${(item, k) => html`
        <span key=${item.id ?? k} class="nl-cal-pill" title=${item.subject}>${item.subject}</span>
      `}
    />
  `;
}

function EmailSentView({ standalone }) {
  const [sentView, setSentView] = useState('table');
  const [typeFilter, setTypeFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['email', 'sent'],
    queryFn: fetchEmailSent,
    enabled: !standalone,
    placeholderData: FIXTURE_EMAIL_SENT,
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading sent…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load sent log" onRetry=${refetch} />`;

  const rows = (data ?? []).filter(r => {
    if (channelFilter !== 'all' && r.delivery_system !== channelFilter) return false;
    return true;
  });

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div class="nl-sent-toolbar">
        <button class=${cn('ob-filter-chip', { 'is-on': typeFilter === 'all' })} onClick=${() => setTypeFilter('all')}>All types</button>
        <button class=${cn('ob-filter-chip', { 'is-on': typeFilter === 'transactional' })} onClick=${() => setTypeFilter('transactional')}>Transactional</button>
        <span style=${{ flex: 1 }}></span>
        <button class=${cn('ob-filter-chip', { 'is-on': channelFilter === 'all' })} onClick=${() => setChannelFilter('all')}>All channels</button>
        <button class=${cn('ob-filter-chip', { 'is-on': channelFilter === 'listmonk' })} onClick=${() => setChannelFilter('listmonk')}>listmonk</button>
        <button class=${cn('ob-filter-chip', { 'is-on': channelFilter === 'resend' })} onClick=${() => setChannelFilter('resend')}>resend</button>
        <div class="nl-view-toggle">
          <button class=${cn({ 'is-on': sentView === 'table' })} onClick=${() => setSentView('table')}>Table</button>
          <button class=${cn({ 'is-on': sentView === 'charts' })} onClick=${() => setSentView('charts')}>Charts</button>
        </div>
      </div>
      <div class="nl-sent-body">
        ${sentView === 'table' ? html`
          <table class="nl-sent-table">
            <thead><tr>
              <th>Subject</th><th>Channel</th><th>Sent</th>
              <th>Open</th><th>Click</th>
            </tr></thead>
            <tbody>
              ${rows.map(r => html`
                <tr key=${r.id}>
                  <td>${r.subject}</td>
                  <td><${ChannelChip} channel=${r.delivery_system} /></td>
                  <td class="meta">${formatDate(r.sent_at)}</td>
                  <td class="pct">${formatPct(r.open_rate)}</td>
                  <td class="pct">${formatPct(r.click_rate)}</td>
                </tr>
              `)}
            </tbody>
          </table>
        ` : html`
          <${StateDisplay} state="empty" message="Charts view coming soon" />
        `}
      </div>
    </div>
  `;
}

// ─── Newsletter views ───────────────────────────────────────────────────────────

function NewsletterQueueView({ standalone }) {
  const [selected, setSelected] = useState(null);
  const [abChoice, setAbChoice] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['newsletter', 'queue'],
    queryFn: fetchNewsletterQueue,
    enabled: !standalone,
    placeholderData: FIXTURE_NL_QUEUE,
  });

  const qc = useQueryClient();
  const approveMut = useMutation({
    mutationFn: ({ id }) => approveNewsletterDraft(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['newsletter'] }); qc.invalidateQueries({ queryKey: ['counts'] }); },
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }) => rejectNewsletterDraft(id, reason),
    onSuccess: () => { setRejectOpen(false); qc.invalidateQueries({ queryKey: ['newsletter'] }); qc.invalidateQueries({ queryKey: ['counts'] }); },
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading newsletter queue…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load newsletter queue" onRetry=${refetch} />`;
  if (!data?.length) return html`<${StateDisplay} state="empty" message="No newsletter items awaiting review" />`;

  const rows = data ?? [];
  const cooling = rows.filter(r => r.status === 'cooling');
  const pending = rows.filter(r => r.status === 'pending');
  const approved = rows.filter(r => r.status === 'approved');
  const sel = selected ?? pending[0] ?? cooling[0] ?? approved[0] ?? null;

  const isCooling = sel?.status === 'cooling';
  const pick = (row) => { setSelected(row); setAbChoice(null); setRejectOpen(false); };
  const qualityCells = sel ? newsletterQualityCells(sel) : [];

  const sendToChat = () => {
    if (!sel) return;
    hostSendToActiveSession(
      `Help me edit this newsletter draft before I approve it.\n\nSubject: ${sel.subject}\nEdition: ${sel.edition ?? '—'}\nQuality score: ${sel.quality_score ?? '—'}/100`,
    ).catch(() => {});
  };

  const subjLen = (sel?.subject ?? '').length;
  const altLen = (sel?.subject_b ?? '').length;

  return html`
    <div class="nl-split">
      <div class="nl-master">
        ${cooling.length ? html`
          <div class="nl-master-group-head">Cooling · ${cooling.length}</div>
          ${cooling.map(row => html`
            <div key=${row.id} class=${cn('nl-row', { 'is-on': sel?.id === row.id })} onClick=${() => pick(row)}>
              <div class="nl-row-head">
                <${CoolingChip} until=${row.cooling_until} />
                <${QualityChip} score=${row.quality_score} />
              </div>
              <div class="nl-row-subj">${row.subject}</div>
              <div class="nl-row-pre">${row.recipient_count ? `${row.recipient_count.toLocaleString()} recipients` : ''}</div>
            </div>
          `)}
        ` : null}
        ${html`<div class="nl-master-group-head">Ready to review · ${pending.length}</div>`}
        ${pending.map(row => html`
          <div key=${row.id} class=${cn('nl-row', { 'is-on': sel?.id === row.id })} onClick=${() => pick(row)}>
            <div class="nl-row-head">
              <${QualityChip} score=${row.quality_score} />
              ${row.has_ab ? html`<span class="ob-chip ab">A·B</span>` : null}
            </div>
            <div class="nl-row-subj">${row.subject}</div>
            <div class="nl-row-pre">${row.recipient_count ? `${row.recipient_count.toLocaleString()} recipients` : ''}</div>
          </div>
        `)}
        ${html`<div class="nl-master-group-head">Approved · ${approved.length}</div>`}
        ${approved.map(row => html`
          <div key=${row.id} class=${cn('nl-row', { 'is-on': sel?.id === row.id })} onClick=${() => pick(row)}>
            <div class="nl-row-subj">${row.subject}</div>
          </div>
        `)}
      </div>
      <div class="nl-detail">
        ${sel ? html`
          <div class="ob-detail-wrap">
            <div class="ip-head" style=${{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-faint)' }}>
              <div class="ip-meta-row" style=${{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <${QualityChip} score=${sel.quality_score} />
                ${sel.has_ab ? html`<span class="ob-chip ab">A·B</span>` : null}
                ${isCooling ? html`<${CoolingChip} until=${sel.cooling_until} />` : null}
                ${sel.recipient_count ? html`<span class="ob-chip seq">${sel.recipient_count.toLocaleString()} recipients</span>` : null}
              </div>
            </div>

            <!-- Subject / A·B alt / Preheader card (design §B) -->
            <div class="nl-subj-card">
              <div class="nl-subj-row">
                <span class="lbl">Subject</span>
                <input value=${sel.subject ?? ''} readOnly />
              </div>
              <div class="nl-subj-row alt">
                <span class="lbl">A/B alt</span>
                <input value=${sel.subject_b ?? ''} placeholder="— no alternate subject —" readOnly />
              </div>
              <div class="nl-subj-row">
                <span class="lbl">Preheader</span>
                <input value=${sel.preheader ?? ''} placeholder="— preheader —" readOnly />
              </div>
              <div class="pre-row">
                <span class="ob-chip seq">${sel.delivery_system ?? 'listmonk'}${sel.has_ab ? ' · A/B 50/50' : ''}</span>
                <span class="ob-chip seq">From <strong style=${{ color: 'var(--fg)', marginLeft: '4px' }}>${sel.from_line ?? 'Ruby <ruby@royalti.io>'}</strong></span>
                <span class="count">subject · ${subjLen} chars${sel.subject_b ? ` · alt · ${altLen} chars` : ''}</span>
              </div>
            </div>

            ${sel.has_ab ? html`
              <div style=${{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-faint)' }}>
                <p style=${{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 0.5rem' }}>
                  Select variant to advance
                </p>
                <div class="ob-ab-selector">
                  <button class=${cn('ob-ab-btn', { 'is-on': (abChoice ?? 'A') === 'A' })} onClick=${() => setAbChoice('A')}>
                    <span class="ob-ab-label">A</span>
                    <span class="ob-ab-subject">${sel.subject}</span>
                  </button>
                  ${sel.subject_b ? html`
                    <button class=${cn('ob-ab-btn', { 'is-on': abChoice === 'B' })} onClick=${() => setAbChoice('B')}>
                      <span class="ob-ab-label">B</span>
                      <span class="ob-ab-subject">${sel.subject_b}</span>
                    </button>
                  ` : null}
                </div>
              </div>
            ` : null}

            <!-- 8-cell quality scorecard (design §B) -->
            <div class="nl-quality-grid">
              ${qualityCells.map((c, i) => html`
                <div key=${i} class=${cn('nl-quality-cell', c.tone)}>
                  <div class="qlabel">${c.label}</div>
                  <div class="qvalue">${c.value} <span class="qsub">${c.sub}</span></div>
                  <div class="qbar"><div style=${{ width: `${c.pct}%` }}></div></div>
                </div>
              `)}
            </div>

            <!-- Body preview textarea (read-only mock; design §B) -->
            <div class="nl-body-pane">
              <span class="lbl">Body · rendered source</span>
              <textarea class="nl-body-textarea" readOnly value=${sel.body ?? '(body not yet generated)'}></textarea>
            </div>

            ${rejectOpen ? html`
              <${RejectPanel}
                canned=${NL_REJECT_REASONS}
                pending=${rejectMut.isPending}
                placeholder="Optional · why? (feeds the writer-agent training set)"
                onCancel=${() => setRejectOpen(false)}
                onConfirm=${(reason) => rejectMut.mutate({ id: sel.id, reason })}
              />
            ` : null}

            <div class="ob-actions">
              <div class="ob-actions-primary">
                <button
                  class="btn"
                  disabled=${isCooling || approveMut.isPending}
                  style=${isCooling ? { opacity: 0.5, cursor: 'not-allowed' } : { background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
                  onClick=${() => !isCooling && approveMut.mutate({ id: sel.id })}
                  title=${isCooling ? `Cooling — send blocked for ${sel.cooling_until}` : 'Approve & Schedule'}
                >
                  ${approveMut.isPending ? 'Approving…' : isCooling ? `Cooling ${sel.cooling_until}` : 'Approve & Schedule'}
                </button>
                <button class="btn btn-ghost" onClick=${() => setRejectOpen((o) => !o)}>
                  Reject…
                </button>
              </div>
            </div>

            <!-- Secondary action footer (design §B): Back · Send-to-chat · Skip month · meta -->
            <div class="ob-actions-secondary">
              <button class="ob-btn-sm" onClick=${() => setSelected(null)}>↩ Back to list</button>
              <button class="ob-btn-sm" onClick=${sendToChat}>⌘ Send to chat</button>
              <button class="ob-btn-sm" title="Skip this month's send">⏭ Skip month</button>
              <span class="ob-act-spacer"></span>
              <span class="ob-act-meta">${isCooling ? `cooling · ${sel.cooling_until}` : `${sel.edition ?? 'draft'} · ${sel.delivery_system ?? 'listmonk'}`}</span>
            </div>
          </div>
        ` : html`<${StateDisplay} state="empty" message="Select a draft to review" />`}
      </div>
    </div>
  `;
}

function NewsletterScheduleView({ standalone }) {
  // Scheduled newsletter sends — from outbound_newsletter_drafts whose status is
  // 'approved' (about to go out) plus any cooling drafts with a cooling_until.
  const { data } = useQuery({
    queryKey: ['newsletter', 'schedule'],
    queryFn: async () => {
      try {
        const rows = await hostDbQuery(
          `SELECT id, subject, edition, status, cooling_until, recipient_count
           FROM outbound_newsletter_drafts
           WHERE status IN ('approved','cooling','pending')
           ORDER BY cooling_until ASC
           LIMIT 30`
        );
        if (rows?.length) {
          return rows.map((r) => ({
            ...r,
            scheduled_for: r.cooling_until,
            kind: r.status === 'cooling' ? 'cooling' : (r.edition || '').toLowerCase().includes('investor') ? 'investor' : 'scheduled',
          }));
        }
      } catch { /* table empty */ }
      // No live scheduled rows → anchor fixtures to the current week so pills land.
      const wk = startOfWeekMon(new Date());
      const at = (offset, h) => { const d = new Date(wk); d.setDate(wk.getDate() + offset); d.setHours(h, 0, 0, 0); return d.toISOString(); };
      return [
        { id: 'ns-cal-1', subject: 'Schema patches that unblocked tenant 590', scheduled_for: at(1, 10), recipient_count: 2104, kind: 'scheduled' },
        { id: 'ns-cal-2', subject: 'Investor Update — May', scheduled_for: at(3, 14), recipient_count: null, kind: 'investor' },
        { id: 'ns-cal-3', subject: 'You can deliver from Royalti now', scheduled_for: at(8, 10), recipient_count: 2104, kind: 'cooling' },
      ];
    },
    enabled: !standalone,
    placeholderData: [],
  });

  return html`
    <${TwoWeekCalendar}
      items=${data ?? []}
      renderPill=${(item, k) => html`
        <span
          key=${item.id ?? k}
          class=${cn('nl-cal-pill', { cool: item.kind === 'cooling', investor: item.kind === 'investor' })}
          title=${item.subject}
        >${item.subject}</span>
      `}
    />
  `;
}

function NewsletterSentView({ standalone }) {
  const [sentView, setSentView] = useState('table');
  const [typeFilter, setTypeFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['newsletter', 'sent'],
    queryFn: fetchNewsletterSent,
    enabled: !standalone,
    placeholderData: FIXTURE_NL_SENT,
  });

  const rows = data ?? FIXTURE_NL_SENT;

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div class="nl-sent-toolbar">
        <button class=${cn('ob-filter-chip', { 'is-on': typeFilter === 'all' })} onClick=${() => setTypeFilter('all')}>All types</button>
        <button class=${cn('ob-filter-chip', { 'is-on': typeFilter === 'newsletter' })} onClick=${() => setTypeFilter('newsletter')}>Newsletter</button>
        <button class=${cn('ob-filter-chip', { 'is-on': typeFilter === 'investor' })} onClick=${() => setTypeFilter('investor')}>Investor update</button>
        <span style=${{ flex: 1 }}></span>
        <button class=${cn('ob-filter-chip', { 'is-on': channelFilter === 'all' })} onClick=${() => setChannelFilter('all')}>All channels</button>
        <button class=${cn('ob-filter-chip', { 'is-on': channelFilter === 'listmonk' })} onClick=${() => setChannelFilter('listmonk')}>listmonk</button>
        <button class=${cn('ob-filter-chip', { 'is-on': channelFilter === 'resend' })} onClick=${() => setChannelFilter('resend')}>resend</button>
        <div class="nl-view-toggle">
          <button class=${cn({ 'is-on': sentView === 'table' })} onClick=${() => setSentView('table')}>Table</button>
          <button class=${cn({ 'is-on': sentView === 'charts' })} onClick=${() => setSentView('charts')}>Charts</button>
        </div>
      </div>
      <div class="nl-sent-body">
        ${sentView === 'table' ? html`
          <table class="nl-sent-table">
            <thead><tr>
              <th>Subject</th><th>System</th><th>Sent</th>
              <th>Recipients</th><th>Open</th><th>Click</th>
            </tr></thead>
            <tbody>
              ${rows.map(r => html`
                <tr key=${r.id}>
                  <td>${r.subject}</td>
                  <td><span class="ob-chip channel-listmonk">${r.delivery_system}</span></td>
                  <td class="meta">${formatDate(r.sent_at)}</td>
                  <td class="num">${r.recipient_count ? Number(r.recipient_count).toLocaleString() : '—'}</td>
                  <td class="pct">${formatPct(r.open_rate)}</td>
                  <td class="pct">${formatPct(r.click_rate)}</td>
                </tr>
              `)}
            </tbody>
          </table>
        ` : html`<${StateDisplay} state="empty" message="Charts view coming soon" />`}
      </div>
    </div>
  `;
}

// ─── Sequences views ────────────────────────────────────────────────────────────

// Step-rail for one sequence — vertical step cards + delay labels (design §B).
// outbound_sequence_steps is empty live → falls back to a graceful empty state.
function SequenceStepRail({ sequence, standalone }) {
  const seqId = sequence?.id;
  const [rejectOpen, setRejectOpen] = useState(false);
  const qc = useQueryClient();
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }) => rejectSequence(id, reason),
    onSuccess: () => { setRejectOpen(false); qc.invalidateQueries({ queryKey: ['sequences'] }); qc.invalidateQueries({ queryKey: ['counts'] }); },
  });
  const { data: steps, isLoading } = useQuery({
    queryKey: ['sequences', 'steps', seqId],
    queryFn: () => fetchSequenceSteps(seqId),
    enabled: !standalone && !!seqId,
    placeholderData: FIXTURE_SEQ_STEPS,
  });

  const list = steps ?? [];
  const delayLabel = (s) =>
    s.delay_value > 0 ? `+${s.delay_value} ${s.delay_unit ?? 'days'} · skip if recipient replied` : 'day 0 · fires on enrol';

  return html`
    <div class="sq-detail">
      <div class="sq-detail-head">
        <div style=${{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
          ${sequence.delivery_system ? html`<span class=${cn('ob-chip', `channel-${sequence.delivery_system}`)}>${sequence.delivery_system}</span>` : null}
          ${sequence.created_by ? html`<span class="ob-chip seq">${sequence.created_by}</span>` : null}
          <span class="ob-chip cooling">awaiting approval</span>
        </div>
        <h2>${sequence.name ?? sequence.slug ?? sequence.id}</h2>
        ${sequence.description ? html`<p style=${{ fontSize: '0.8125rem', color: 'var(--fg-muted)', margin: '0.25rem 0 0', lineHeight: 1.55 }}>${sequence.description}</p>` : null}
        <div class="sq-detail-meta">
          <span><b>Segment</b> ${sequence.segment ?? '—'}</span>
          <span><b>Delivery</b> ${sequence.delivery_system ?? '—'}</span>
          <span><b>Total steps</b> ${sequence.total_steps ?? list.length}</span>
        </div>
      </div>

      ${isLoading ? html`<${StateDisplay} state="loading" message="Loading steps…" />`
        : list.length === 0 ? html`<${StateDisplay} state="empty" message="No steps defined for this sequence yet" />`
        : html`
          <div class="step-rail">
            ${list.map((s, i) => html`
              ${i > 0 ? html`<div class="step-delay">${delayLabel(s)}</div>` : null}
              <div key=${s.id ?? i} class=${cn('step-card', { 'is-current': i === 0 })}>
                <div class="step-card-head">
                  <span class="step-num">${s.step_number ?? i + 1}</span>
                  <span class="step-subj">${s.subject}</span>
                  <span class="ob-chip seq" style=${{ marginLeft: 'auto' }}>day ${s.delay_value ?? 0}</span>
                </div>
                <div class="step-card-meta">
                  <span>${s.channel ?? sequence.delivery_system ?? 'resend'}</span>
                  <span>tracked open + click</span>
                </div>
                ${s.body ? html`<div class="step-card-body">${s.body}</div>` : null}
              </div>
            `)}
          </div>
          ${rejectOpen ? html`
            <${RejectPanel}
              canned=${SEQ_REJECT_REASONS}
              pending=${rejectMut.isPending}
              placeholder="Optional · why? (feeds the writer-agent training set)"
              onCancel=${() => setRejectOpen(false)}
              onConfirm=${(reason) => rejectMut.mutate({ id: sequence.id, reason })}
            />
          ` : null}
          <div class="sq-footer">
            <span class="ob-chip seq">enrol on approve</span>
            <span class="ob-chip seq">step 1 fires immediately</span>
            <div class="actions">
              <button class="ob-btn-sm is-danger" onClick=${() => setRejectOpen((o) => !o)}>Reject</button>
              <button class="ob-btn-sm">⌘ Send to chat</button>
              <button class="btn" style=${{ background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}>Approve & activate</button>
            </div>
          </div>
        `}
    </div>
  `;
}

function SequencesQueueView({ standalone }) {
  const [selected, setSelected] = useState(null);

  // Sequences awaiting approval — master list (left), step rail (detail, right).
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sequences', 'queue'],
    queryFn: fetchSequenceQueue,
    enabled: !standalone,
    placeholderData: FIXTURE_SEQ_QUEUE,
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading sequence approvals…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load sequences" onRetry=${refetch} />`;
  if (!data?.length) return html`<${StateDisplay} state="empty" message="No sequence items awaiting approval" />`;

  const rows = data ?? [];
  const sel = selected ?? rows[0];

  return html`
    <div class="sq-md">
      <aside class="sq-master">
        <div class="sq-master-head">In review <span class="ct">${rows.length}</span></div>
        ${rows.map(row => html`
          <div key=${row.id} class=${cn('sq-row', { 'is-on': sel?.id === row.id })} onClick=${() => setSelected(row)}>
            <div class="sq-row-name">
              ${row.name ?? row.slug ?? row.id}
              <span class="sq-row-time">${row.status ?? ''}</span>
            </div>
            ${row.description ? html`<div class="sq-row-desc">${row.description}</div>` : null}
            <div class="sq-row-progress">
              ${Array.from({ length: row.total_steps ?? 1 }).map((_, i) => html`
                <span key=${i} class=${cn('sq-row-step', { 'is-active': i === 0 })}></span>
              `)}
            </div>
            <div class="sq-row-meta">
              ${row.delivery_system ? html`<span class=${cn('ob-chip', `channel-${row.delivery_system}`)}>${row.delivery_system}</span>` : null}
              ${row.segment ? html`<span class="ob-chip seq">${row.segment}</span>` : null}
            </div>
          </div>
        `)}
      </aside>
      ${sel ? html`<${SequenceStepRail} sequence=${sel} standalone=${standalone} />`
        : html`<div class="sq-detail"><${StateDisplay} state="empty" message="Select a sequence to review" /></div>`}
    </div>
  `;
}

// Derive a cohort tile state from a recipient row (design §C colour scale).
function recipientTileState(r) {
  if (r.status === 'bounced') return { cls: 'is-bounced', glyph: '!' };
  if (r.status === 'completed' || (r.current_step != null && r.total_steps != null && r.current_step >= r.total_steps)) return { cls: 'is-done', glyph: '✓' };
  if (r.last_reply_at) return { cls: 'is-replied', glyph: '↩' };
  const step = Number(r.current_step) || 1;
  if (step >= 3) return { cls: 'is-step3', glyph: '3' };
  if (step === 2) return { cls: 'is-step2', glyph: '2' };
  return { cls: 'is-step1', glyph: '1' };
}

// Recipient cohort grid for one running sequence (design §C). Tiles coloured by
// derived step; diagnostic chips above; per-recipient detail on tile click.
function RecipientCohort({ sequenceKey, fallback, standalone }) {
  const [picked, setPicked] = useState(null);
  const { data: recips, isLoading } = useQuery({
    queryKey: ['sequences', 'recipients', sequenceKey],
    queryFn: () => fetchSequenceRecipients(sequenceKey),
    enabled: !standalone && !!sequenceKey,
    placeholderData: fallback ?? FIXTURE_SEQ_RECIPIENTS,
  });

  const list = (recips && recips.length ? recips : fallback) ?? [];
  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading cohort…" />`;
  if (!list.length) return html`<${StateDisplay} state="empty" message="No recipients enrolled" />`;

  // Diagnostic counts.
  const stuck = {};
  let bounces = 0, replies = 0;
  for (const r of list) {
    const st = recipientTileState(r);
    if (st.cls === 'is-bounced') bounces++;
    else if (st.cls === 'is-replied') replies++;
    else if (st.cls.startsWith('is-step')) {
      const k = st.cls.replace('is-step', '');
      stuck[k] = (stuck[k] ?? 0) + 1;
    }
  }
  const topStuck = Object.entries(stuck).sort((a, b) => b[1] - a[1])[0];

  return html`
    <div>
      <div class="rec-diag">
        ${topStuck && topStuck[1] >= 2 ? html`<span class="ob-chip seq chip-warn">${topStuck[1]} on step ${topStuck[0]}</span>` : null}
        ${bounces > 0 ? html`<span class="ob-chip seq chip-danger">${bounces} bounce${bounces > 1 ? 's' : ''} · check list hygiene</span>` : null}
        ${replies > 0 ? html`<span class="ob-chip seq">${replies} repl${replies > 1 ? 'ies' : 'y'} · paused</span>` : null}
      </div>
      <div class="rec-grid">
        ${list.map((r, i) => {
          const st = recipientTileState(r);
          return html`<div key=${r.id ?? i} class=${cn('rec-cell', st.cls)} title=${r.contact_email ?? ''} onClick=${() => setPicked(r)}>${st.glyph}</div>`;
        })}
      </div>
      <div class="rec-legend">
        <span><span class="rec-swatch" style=${{ background: 'color-mix(in srgb, var(--tint-outbox-fg, var(--primary)) 25%, var(--bg-sunken))' }}></span> Step 1</span>
        <span><span class="rec-swatch" style=${{ background: 'color-mix(in srgb, var(--tint-outbox-fg, var(--primary)) 50%, var(--bg-sunken))' }}></span> Step 2</span>
        <span><span class="rec-swatch" style=${{ background: 'color-mix(in srgb, var(--tint-outbox-fg, var(--primary)) 75%, var(--bg-sunken))' }}></span> Step 3</span>
        <span><span class="rec-swatch" style=${{ background: 'var(--live)' }}></span> Completed</span>
        <span><span class="rec-swatch" style=${{ background: 'color-mix(in srgb, var(--agent) 60%, var(--bg-sunken))' }}></span> Replied (paused)</span>
        <span><span class="rec-swatch" style=${{ background: 'color-mix(in srgb, var(--danger) 50%, var(--bg-sunken))' }}></span> Bounced</span>
      </div>
      ${picked ? html`
        <div style=${{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-faint)' }}>
          <p style=${{ fontSize: '0.75rem', color: 'var(--fg-muted)', margin: 0 }}>
            Recipient <strong style=${{ color: 'var(--fg)' }}>${picked.contact_email ?? '—'}</strong>
            · step <strong style=${{ color: 'var(--fg)' }}>${picked.current_step ?? '—'}/${picked.total_steps ?? '—'}</strong>
            · status <strong style=${{ color: 'var(--fg)' }}>${picked.status ?? '—'}</strong>
            ${picked.last_reply_at ? html` · replied ${picked.last_reply_at}` : ''}
          </p>
        </div>
      ` : null}
    </div>
  `;
}

function SequencesActiveView({ standalone }) {
  // G-11 rule: Sequences "Schedule" tab = "Active" list (per-recipient, not per-campaign)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sequences', 'active'],
    queryFn: fetchActiveSequences,
    enabled: !standalone,
    placeholderData: FIXTURE_ACTIVE_SEQS,
  });

  const [selected, setSelected] = useState(null);

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading active sequences…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load sequences" onRetry=${refetch} />`;

  const rows = data ?? FIXTURE_ACTIVE_SEQS;
  const sel = selected ?? rows[0];

  return html`
    <div class="nl-split">
      <div class="nl-master" style=${{ gridColumn: '1' }}>
        <div class="ob-seq-list">
          ${rows.map(row => html`
            <div key=${row.id} class=${cn('ob-seq-row', { 'is-on': sel?.id === row.id })} onClick=${() => setSelected(row)}>
              <div>
                <div class="ob-seq-name">${row.sequence_name ?? row.sequence_id}</div>
                <div class="ob-seq-meta">${row.contact_email || row.segment || '—'}</div>
                <div class="ob-seq-meta" style=${{ marginTop: '0.125rem' }}>
                  <span class=${cn('ob-chip', 'seq')}>Step ${row.current_step}/${row.total_steps}</span>
                  ${row.delivery_system ? html`<span class=${cn('ob-chip', `channel-${row.delivery_system}`)} style=${{ marginLeft: '0.25rem' }}>${row.delivery_system}</span>` : null}
                </div>
              </div>
              <div class="ob-seq-stats">
                <div class="ob-seq-step">Next: ${formatDate(row.next_send_date)}</div>
                ${row.sent_count > 0 ? html`<div class="ob-seq-step">${row.sent_count} sent</div>` : null}
              </div>
            </div>
          `)}
        </div>
      </div>
      <div class="nl-detail">
        ${sel ? html`
          <div class="ob-detail-wrap">
            <div class="ob-seq-detail" style=${{ overflow: 'visible', borderBottom: '1px solid var(--border-faint)' }}>
              <h2 style=${{ fontSize: '0.9rem', fontWeight: 600, margin: '0 0 0.5rem', color: 'var(--fg)' }}>
                ${sel.sequence_name ?? sel.sequence_id}
              </h2>
              <p style=${{ fontSize: '0.75rem', color: 'var(--fg-muted)', margin: 0 }}>
                Recipient: <strong style=${{ color: 'var(--fg)' }}>${sel.contact_email || sel.segment || '—'}</strong>
              </p>
              <p style=${{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.375rem' }}>
                Step <strong style=${{ color: 'var(--fg)' }}>${sel.current_step}</strong> of ${sel.total_steps}
                · Next send: <strong style=${{ color: 'var(--fg)' }}>${formatDate(sel.next_send_date)}</strong>
              </p>
              <p style=${{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.375rem' }}>
                Delivered: <strong style=${{ color: 'var(--fg)' }}>${sel.sent_count ?? 0}</strong>
                via <span class=${cn('ob-chip', `channel-${sel.delivery_system}`)} style=${{ display: 'inline-flex' }}>${sel.delivery_system}</span>
              </p>
            </div>
            <div style=${{ flex: 1, overflowY: 'auto' }}>
              <p style=${{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '0.75rem 1rem 0', margin: 0 }}>
                Recipient cohort · who is on which step
              </p>
              <${RecipientCohort} sequenceKey=${sel.sequence_id} standalone=${standalone} />
            </div>
          </div>
        ` : html`<${StateDisplay} state="empty" message="Select a sequence to inspect" />`}
      </div>
    </div>
  `;
}

function SequencesSentView({ standalone }) {
  const [selected, setSelected] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sequences', 'sent'],
    queryFn: fetchSentSequences,
    enabled: !standalone,
    placeholderData: FIXTURE_SENT_SEQS,
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading sent sequences…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load sent sequences" onRetry=${refetch} />`;
  if (!data?.length) return html`<${StateDisplay} state="empty" message="No completed sequences yet" />`;

  const rows = data ?? [];
  const sel = selected ?? rows[0];

  // Build a per-cohort funnel from aggregate counts (sent → replied → completed → bounced).
  const funnelRows = (c) => {
    const enrolled = Number(c.enrolled) || 0;
    const pct = (n) => (enrolled ? Math.round((n / enrolled) * 100) : 0);
    const replied = Number(c.replied) || 0;
    const completed = Number(c.completed) || 0;
    const bounced = Number(c.bounced) || 0;
    return [
      { label: 'Enrolled', n: enrolled, pct: 100, cls: '' },
      { label: 'Replied', n: replied, pct: pct(replied), cls: 'is-replied' },
      { label: 'Completed', n: completed, pct: pct(completed), cls: '' },
      { label: 'Bounced', n: bounced, pct: pct(bounced), cls: 'is-bounced' },
    ];
  };

  return html`
    <div class="sq-sent-grid">
      <div class="sq-sent-master">
        <div class="sq-master-head">Completed cohorts <span class="ct">${rows.length}</span></div>
        ${rows.map(row => html`
          <div key=${row.sequence_id} class=${cn('sq-row', { 'is-on': sel?.sequence_id === row.sequence_id })} onClick=${() => setSelected(row)}>
            <div class="sq-row-name">${row.sequence_name ?? row.sequence_slug ?? row.sequence_id}<span class="sq-row-time">${formatDate(row.closed_at)}</span></div>
            <div class="sq-row-meta">
              <span class="ob-chip seq">${row.enrolled} enrolled</span>
              <span class="ob-chip quality high">${row.enrolled ? Math.round((Number(row.replied) / Number(row.enrolled)) * 100) : 0}% reply</span>
            </div>
          </div>
        `)}
      </div>
      <div class="funnel">
        ${sel ? html`
          <h2 style=${{ fontFamily: 'var(--font-display)', fontSize: '16px', margin: '0 0 0.75rem', color: 'var(--fg)' }}>
            ${sel.sequence_name ?? sel.sequence_slug ?? sel.sequence_id}
          </h2>
          <p style=${{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--fg-faint)', margin: '0 0 1rem' }}>
            closed ${formatDate(sel.closed_at)} · ${sel.enrolled} enrolled · ${sel.sent_total ?? 0} sends
          </p>
          ${funnelRows(sel).map((f, i) => html`
            <div key=${i} class="funnel-row">
              <span class="funnel-label">${f.label}</span>
              <div class="funnel-bar"><i class=${f.cls} style=${{ width: `${f.pct}%` }}></i></div>
              <span class="funnel-num">${f.n} / ${sel.enrolled}</span>
              <span class="funnel-pct">${f.pct}%</span>
            </div>
          `)}
        ` : html`<${StateDisplay} state="empty" message="Select a cohort" />`}
      </div>
    </div>
  `;
}

// ─── Social views ───────────────────────────────────────────────────────────────

// Per-platform preview editor (design social §B): base body on the left, stacked
// LinkedIn / X / Bluesky previews on the right with per-platform char caps; fan-out
// rows + reject below. Body is editable locally (preview-only mock — no write-back
// since social_queue stores one platform per row).
function SocialEditor({ post, standalone, onApprove, approvePending, onReject, rejectPending }) {
  const [body, setBody] = useState(post?.content ?? '');
  const [rejectOpen, setRejectOpen] = useState(false);

  // Reset local body when the selected post changes.
  useEffect(() => { setBody(post?.content ?? ''); setRejectOpen(false); }, [post?.id]);

  const { data: fanout } = useQuery({
    queryKey: ['social', 'fanout', post?.slug],
    queryFn: () => fetchSocialFanout(post?.slug),
    enabled: !standalone && !!post?.slug,
    placeholderData: [],
  });

  const len = body.length;
  const anyBlocked = SOCIAL_PLATFORMS.some((p) => len > p.cap);

  // Fan-out rows: live siblings if present, otherwise the three standard targets.
  const fanRows = (fanout && fanout.length)
    ? fanout.map((r) => ({
        plat: ({ linkedin: 'plat-li', x: 'plat-x', twitter: 'plat-x', bluesky: 'plat-bs', instagram: 'plat-ig' }[r.platform] ?? 'plat-x'),
        label: r.platform,
        blocked: (r.content?.length ?? 0) > (PLATFORM_CAPS[r.platform] ?? 280),
        schedule: r.scheduled_for,
      }))
    : SOCIAL_PLATFORMS.map((p) => ({ plat: p.plat, label: p.sub, blocked: len > p.cap, schedule: post?.scheduled_for }));

  return html`
    <div class="ob-detail-wrap">
      <div class="so-detail-head" style=${{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-faint)' }}>
        <div style=${{ flex: 1, minWidth: 0 }}>
          <div style=${{ display: 'flex', gap: '0.375rem', marginBottom: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            ${post?.source ? html`<span class="ob-chip seq">${post.source}</span>` : null}
            ${SOCIAL_PLATFORMS.map((p) => html`<span key=${p.key} class=${cn('plat', p.plat)}>${p.sub}</span>`)}
          </div>
          <h2 style=${{ fontFamily: 'var(--font-display)', fontSize: '18px', margin: 0, color: 'var(--fg)' }}>
            ${post?.title ?? 'Social post'}
          </h2>
          <p style=${{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--fg-muted)', margin: '0.375rem 0 0' }}>
            scheduled · ${formatDate(post?.scheduled_for)}
          </p>
        </div>
      </div>

      <div class="so-editor">
        <div>
          <div class="so-editor-pane-label"><span>Editor · base body</span></div>
          <textarea class="so-text" value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
          <div class="char-rows">
            ${SOCIAL_PLATFORMS.map((p) => {
              const over = len - p.cap;
              return html`
                <div key=${p.key} class="char-row">
                  <span class="clabel">${p.sub} ${len} / ${p.cap}${over > 0 ? html`<span class="over">+${over}</span>` : ''}</span>
                  <div class=${cn('char-bar', charBarClass(len, p.cap))}><i style=${{ width: `${Math.min(100, (len / p.cap) * 100)}%` }}></i></div>
                </div>
              `;
            })}
          </div>
        </div>

        <div>
          <div class="so-editor-pane-label"><span>Live previews</span><span class="ob-chip seq" style=${{ marginLeft: 'auto' }}>scroll to compare</span></div>
          ${SOCIAL_PLATFORMS.map((p) => {
            const over = len > p.cap;
            return html`
              <div key=${p.key} class="pv-card">
                <div class="pv-head">
                  <div class="pv-avatar"></div>
                  <div class="pv-handle"><b>${p.handle}</b><span>· ${p.sub}</span></div>
                  <span class=${cn('plat', p.plat)} style=${{ marginLeft: 'auto' }}>${p.mark}</span>
                </div>
                ${over ? html`
                  <div class="pv-body is-blocked">⚠ Over ${p.cap}-char cap by ${len - p.cap}. Add an alt-body for ${p.sub}, or split into a thread.</div>
                  <div class="pv-stats"><span style=${{ color: 'var(--danger)' }}>cannot post until resolved</span></div>
                ` : html`
                  <div class="pv-body">${body}</div>
                  <div class="pv-stats"><span>♡ 0</span><span>↻ 0</span></div>
                `}
              </div>
            `;
          })}
        </div>
      </div>

      <div class="so-fanout">
        <div class="so-fanout-head">Per-platform fan-out · ${fanRows.length} row${fanRows.length > 1 ? 's' : ''}</div>
        <table class="so-fanout-table">
          <thead><tr><th>Platform</th><th>Status</th><th>Schedule</th></tr></thead>
          <tbody>
            ${fanRows.map((r, i) => html`
              <tr key=${i}>
                <td><span class=${cn('plat', r.plat)}>${r.label}</span></td>
                <td>${r.blocked ? html`<span class="chip-warn-sm">blocked · over cap</span>` : html`<span class="chip-ok-sm">ready</span>`}</td>
                <td class="meta">${r.blocked ? '—' : formatDate(r.schedule)}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>

      ${rejectOpen ? html`
        <${RejectPanel}
          canned=${SOCIAL_REJECT_REASONS}
          pending=${rejectPending}
          placeholder="Optional · why? (feeds the cmo-agent training set)"
          onCancel=${() => setRejectOpen(false)}
          onConfirm=${(reason) => onReject(reason)}
        />
      ` : null}

      <div class="ob-actions">
        <div class="ob-actions-primary">
          <button
            class="btn"
            style=${anyBlocked ? { opacity: 0.55, cursor: 'not-allowed' } : { background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
            disabled=${anyBlocked || approvePending}
            title=${anyBlocked ? 'Resolve over-cap platforms first' : 'Approve & schedule'}
            onClick=${() => !anyBlocked && onApprove()}
          >
            ${approvePending ? 'Approving…' : 'Approve & Schedule'}
          </button>
          <button class="btn btn-ghost" onClick=${() => setRejectOpen((o) => !o)}>Reject…</button>
        </div>
      </div>
      <div class="ob-actions-secondary">
        <button
          class="ob-btn-sm"
          onClick=${() => hostSendToActiveSession(`Help me edit this social post before approval.\n\nPlatforms: LinkedIn · X · Bluesky\n\n${body}`).catch(() => {})}
        >⌘ Send to chat</button>
        ${anyBlocked ? html`<span class="chip-warn-sm" style=${{ marginLeft: '0.5rem' }}>1+ platform over cap</span>` : null}
      </div>
    </div>
  `;
}

function SocialQueueView({ standalone }) {
  const [selected, setSelected] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['social', 'queue'],
    queryFn: fetchSocialQueue,
    enabled: !standalone,
    placeholderData: FIXTURE_SOCIAL_QUEUE,
  });

  const qc = useQueryClient();
  const approveMut = useMutation({
    mutationFn: ({ id }) => approveSocialPost(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['social'] }); qc.invalidateQueries({ queryKey: ['counts'] }); },
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }) => rejectSocialPost(id, reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['social'] }); qc.invalidateQueries({ queryKey: ['counts'] }); },
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading social queue…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load social queue" onRetry=${refetch} />`;
  if (!data?.length) return html`<${StateDisplay} state="empty" message="No social posts awaiting approval" />`;

  const rows = data ?? [];
  const sel = selected ?? rows[0];

  return html`
    <div class="nl-split">
      <div class="nl-master">
        ${rows.map(row => html`
          <div key=${row.id} class=${cn('nl-row', { 'is-on': sel?.id === row.id })} onClick=${() => setSelected(row)}>
            <div class="nl-row-head">
              <${PlatformBadge} platform=${row.platform} />
              <span class="ob-chip seq">${row.source ?? ''}</span>
            </div>
            <div class="nl-row-subj" style=${{ whiteSpace: 'normal', WebkitLineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              ${row.content?.substring(0, 80)}${row.content?.length > 80 ? '…' : ''}
            </div>
            <div class="nl-row-pre">${formatDate(row.scheduled_for)}</div>
          </div>
        `)}
      </div>
      <div class="nl-detail">
        ${sel ? html`
          <${SocialEditor}
            post=${sel}
            standalone=${standalone}
            onApprove=${() => approveMut.mutate({ id: sel.id })}
            approvePending=${approveMut.isPending}
            onReject=${(reason) => rejectMut.mutate({ id: sel.id, reason })}
            rejectPending=${rejectMut.isPending}
          />
        ` : html`<${StateDisplay} state="empty" message="Select a post to review" />`}
      </div>
    </div>
  `;
}

function SocialScheduleView({ standalone }) {
  const { data, isLoading } = useQuery({
    queryKey: ['social', 'schedule'],
    queryFn: fetchSocialSchedule,
    enabled: !standalone,
    placeholderData: FIXTURE_SOCIAL_SCHEDULE,
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading social schedule…" />`;

  const rows = data ?? FIXTURE_SOCIAL_SCHEDULE;

  return html`
    <${TwoWeekCalendar}
      items=${rows}
      renderPill=${(item, k) => html`
        <span key=${item.id ?? k} class="nl-cal-pill" title=${item.content}>
          <${PlatformBadge} platform=${item.platform} />
          ${(item.content ?? '').substring(0, 24)}${(item.content?.length ?? 0) > 24 ? '…' : ''}
        </span>
      `}
    />
  `;
}

function SocialSentView({ standalone }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['social', 'sent'],
    queryFn: fetchSocialSent,
    enabled: !standalone,
    placeholderData: FIXTURE_SOCIAL_SENT,
  });

  const rows = data ?? FIXTURE_SOCIAL_SENT;

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div class="nl-sent-toolbar">
        <span style=${{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>${rows.length} sent posts</span>
        <div class="nl-view-toggle" style=${{ marginLeft: 'auto' }}>
          <button class="is-on">Table</button>
          <button>Charts</button>
        </div>
      </div>
      <div class="nl-sent-body">
        <table class="nl-sent-table">
          <thead><tr>
            <th>Platform</th><th>Content</th><th>Posted</th><th>Source</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => html`
              <tr key=${r.id}>
                <td><${PlatformBadge} platform=${r.platform} /></td>
                <td style=${{ maxWidth: '280px' }}>${r.content?.substring(0, 60)}${r.content?.length > 60 ? '…' : ''}</td>
                <td class="meta">${formatDate(r.posted_at)}</td>
                <td class="meta">${r.source ?? '—'}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── View dispatcher ────────────────────────────────────────────────────────────

function ViewBody({ channel, view, standalone }) {
  if (channel === 'email') {
    if (view === 'queue') return html`<${EmailQueueView} standalone=${standalone} />`;
    if (view === 'schedule') return html`<${EmailScheduleView} standalone=${standalone} />`;
    if (view === 'sent') return html`<${EmailSentView} standalone=${standalone} />`;
  }
  if (channel === 'newsletter') {
    if (view === 'queue') return html`<${NewsletterQueueView} standalone=${standalone} />`;
    if (view === 'schedule') return html`<${NewsletterScheduleView} standalone=${standalone} />`;
    if (view === 'sent') return html`<${NewsletterSentView} standalone=${standalone} />`;
  }
  if (channel === 'sequences') {
    if (view === 'queue') return html`<${SequencesQueueView} standalone=${standalone} />`;
    if (view === 'schedule') return html`<${SequencesActiveView} standalone=${standalone} />`; // G-11
    if (view === 'sent') return html`<${SequencesSentView} standalone=${standalone} />`;
  }
  if (channel === 'social') {
    if (view === 'queue') return html`<${SocialQueueView} standalone=${standalone} />`;
    if (view === 'schedule') return html`<${SocialScheduleView} standalone=${standalone} />`;
    if (view === 'sent') return html`<${SocialSentView} standalone=${standalone} />`;
  }
  return html`<${StateDisplay} state="empty" message="Unknown view" />`;
}

// ─── Main OutboundView ──────────────────────────────────────────────────────────

export function OutboundView({ activeFeature }) {
  // Initialise channel from activeFeature directly (lazy init) so the first paint
  // already reflects the sidebar selection — closes the mount race where the
  // useEffect relay below lands a frame after the initial render (F-01).
  const [channel, setChannel] = useState(() => {
    if (typeof activeFeature === 'string' && activeFeature.startsWith('ch:')) {
      const ch = activeFeature.slice(3);
      if (CHANNELS.includes(ch)) return ch;
    }
    return 'newsletter';
  });
  const [view, setView] = useState('queue');
  const standalone = isStandalone();

  // Channel counts query (for sidebar badges)
  const { data: counts } = useQuery({
    queryKey: ['counts'],
    queryFn: fetchChannelCounts,
    enabled: !standalone,
    refetchInterval: 30_000,
    placeholderData: { email: 5, newsletter: 2, sequences: 4, social: 4 },
  });

  // Agent counts for the active channel
  const { data: agents } = useQuery({
    queryKey: ['agents', channel],
    queryFn: () => fetchAgentCounts(channel),
    enabled: !standalone,
    placeholderData: { pa: 4, cmo: 5, cbo: 2 },
  });

  // Totals for the in-pane ob-header meta line. The design (F-14) also wanted a
  // sidebar mode line, but host.pkg.setMenu only accepts an items array — there
  // is no statusLine field. Decision (2026-06-07 review, E.10): DROP the sidebar
  // mode line rather than extend the shell setMenu contract; these same totals
  // are surfaced in-pane below (ob-header .meta), so no information is lost.
  const totalAwaiting = (counts?.email ?? 0) + (counts?.newsletter ?? 0) + (counts?.social ?? 0);
  const activeSeqCount = counts?.sequences ?? 0;

  // Publish menu whenever channel/view/counts/agents change
  useEffect(() => {
    const items = buildOutboundMenu(channel, view, counts ?? {}, agents ?? {});
    setMenu(items).catch(() => {/* standalone — ignore */});
  }, [channel, view, counts, agents]);

  // ── activeFeature → channel switching (side-menu item clicks) ──────────────
  // The shell relays sidebar clicks via the host-context re-emit
  // (royaltiSuite.activeFeature) — the same wire tasks/mail/sales use. The
  // original "pkg-menu-click" window-message listener here referenced a relay
  // that never existed (wave-2 live-verify finding: channel switching dead).
  useEffect(() => {
    if (!activeFeature) return;
    if (activeFeature.startsWith('ch:')) {
      const newChannel = activeFeature.slice(3);
      if (CHANNELS.includes(newChannel)) {
        setChannel(newChannel);
        setView('queue'); // reset to queue on channel switch
      }
    }
    // Filter clicks (f:pa/f:cmo/f:cbo) — no state change needed in pkg
    // (the shell menu already handles the is-on visual)
  }, [activeFeature]);

  // Dim by-agent group when view is not 'queue' — JS class approach
  useEffect(() => {
    publishIykeState('outbound.view', view);
  }, [view]);

  const meta = CHANNEL_META[channel];

  return html`
    <div class="frame" style=${{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      <!-- Frame header -->
      <div class="frame-head">
        <span class="frame-title-mark" style=${{ color: 'var(--tint-outbox-fg, var(--fg-muted))' }}>
          <${Icon} name="send" size=${14} />
        </span>
        <span class="frame-title">Outbox</span>
      </div>

      <!-- Channel header — design atelier-outbound.html: h1 = [outbox] Outbox · <Channel> -->
      <div class="ob-header">
        <h1 style=${{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style=${{ display: 'inline-flex', color: 'var(--tint-outbox-fg, var(--tint-fg-active, var(--fg)))' }}>
            <${Icon} name="send" size=${16} />
          </span>
          <span>Outbox · ${meta.label}</span>
        </h1>
        <p class="sub">${meta.subtitle}</p>
        <p class="meta">${totalAwaiting} awaiting · ${activeSeqCount} sequences active</p>
      </div>

      <!-- Inner-tab strip: Approval queue / Schedule / Sent -->
      <div class="nl-inner-tabs">
        ${meta.views.map(v => {
          const label = meta.viewLabels[v];
          const cnt = v === 'queue' ? (counts?.[channel] ?? 0) : 0;
          return html`
            <button
              key=${v}
              class=${cn({ 'is-on': view === v })}
              onClick=${() => setView(v)}
            >
              ${label}
              ${v === 'queue' && cnt > 0 ? html`<span class="nl-tab-count">${cnt}</span>` : null}
            </button>
          `;
        })}
      </div>

      <!-- View body -->
      <div class="frame-body-flush" style=${{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <${ViewBody} channel=${channel} view=${view} standalone=${standalone} />
      </div>

    </div>
  `;
}
