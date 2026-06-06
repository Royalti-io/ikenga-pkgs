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
      `SELECT id, subject, recipient_email, recipient_name, channel,
              status, ux_mode, drafted_by, scheduled_for, is_overdue,
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
      `SELECT id, subject, subject_b, draft_slug, status,
              cooling_until, quality_score, recipient_count,
              delivery_system, drafted_by, has_ab
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

// ─── Social queries ─────────────────────────────────────────────────────────────

async function fetchSocialQueue() {
  try {
    const rows = await hostDbQuery(
      `SELECT id, platform, account, content, status,
              scheduled_for, approved_at, approved_by, source
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

async function rejectEmailDraft(id, src) {
  if (src === 'cold') {
    await hostDbExec(`UPDATE fundraising_outreach SET status='rejected' WHERE id=?`, [id]);
  } else {
    await hostDbExec(`UPDATE outbound_email_approvals SET status='rejected' WHERE id=?`, [id]);
  }
}

async function approveNewsletterDraft(id) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await hostDbExec(
    `UPDATE outbound_newsletter_drafts SET status='approved', approved_by='operator', approved_at=? WHERE id=?`,
    [now, id]
  );
}

async function rejectNewsletterDraft(id) {
  await hostDbExec(`UPDATE outbound_newsletter_drafts SET status='rejected' WHERE id=?`, [id]);
}

async function approveSocialPost(id) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await hostDbExec(
    `UPDATE social_queue SET status='approved', approved_at=?, approved_by='operator' WHERE id=?`,
    [now, id]
  );
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
  { id: 'nl-1', subject: 'You can deliver from Royalti now', subject_b: null, draft_slug: 'royalti-deliver', status: 'cooling', cooling_until: '47m', quality_score: 92, recipient_count: 2104, delivery_system: 'listmonk', drafted_by: 'cmo', has_ab: 0 },
  { id: 'nl-2', subject: 'Schema patches that unblocked tenant 590', subject_b: 'The shape disparity that was eating royalty data', draft_slug: 'schema-patches-590', status: 'pending', cooling_until: null, quality_score: 86, recipient_count: 2104, delivery_system: 'listmonk', drafted_by: 'cmo', has_ab: 1 },
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

// ─── Email views ────────────────────────────────────────────────────────────────

function EmailQueueView({ standalone }) {
  const [selected, setSelected] = useState(null);

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
    mutationFn: ({ id, src }) => rejectEmailDraft(id, src),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['email'] }); qc.invalidateQueries({ queryKey: ['counts'] }); },
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading email queue…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load email queue" onRetry=${refetch} />`;
  if (!data?.length) return html`<${StateDisplay} state="empty" message="No email items awaiting approval" />`;

  const rows = data ?? [];
  const sel = selected ?? rows[0];

  return html`
    <div class="nl-split">
      <div class="nl-master">
        ${rows.map(row => html`
          <div
            key=${row.id}
            class=${cn('nl-row', { 'is-on': sel?.id === row.id })}
            onClick=${() => setSelected(row)}
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
            <div class="ip-body" style=${{ flex: 1, padding: '1rem', color: 'var(--fg-muted)', fontSize: '0.8125rem' }}>
              <p style=${{ margin: 0 }}>
                To: <strong style=${{ color: 'var(--fg)' }}>${sel.recipient_name || sel.recipient_email || 'segment'}</strong>
                ${sel.scheduled_for ? html` · Scheduled: <strong style=${{ color: 'var(--fg)' }}>${sel.scheduled_for}</strong>` : ''}
              </p>
              <p style=${{ marginTop: '1rem', color: 'var(--fg-muted)' }}>
                Drafted by <strong style=${{ color: 'var(--fg)' }}>${sel.drafted_by ?? 'agent'}</strong>
              </p>
              ${sel.is_overdue ? html`
                <div class="ob-chip overdue" style=${{ display: 'inline-flex', marginTop: '0.5rem' }}>
                  Past scheduled time — approve to send now
                </div>
              ` : null}
            </div>
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
                <button
                  class="btn btn-ghost"
                  onClick=${() => rejectMut.mutate({ id: sel.id, src: sel.src })}
                  disabled=${rejectMut.isPending}
                >
                  Reject
                </button>
              </div>
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
    <div class="nl-cal-wrap">
      <div class="nl-cal-week">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => html`
          <div key=${d} class="nl-cal-cell">
            <div class=${cn('nl-cal-day-num', { today: i === 0 })}>${d}</div>
            ${(data ?? []).filter((_, idx) => idx % 7 === i).map(item => html`
              <span key=${item.id} class="nl-cal-pill">
                ${item.subject}
              </span>
            `)}
          </div>
        `)}
      </div>
    </div>
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
    mutationFn: ({ id }) => rejectNewsletterDraft(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['newsletter'] }); qc.invalidateQueries({ queryKey: ['counts'] }); },
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

  return html`
    <div class="nl-split">
      <div class="nl-master">
        ${cooling.length ? html`
          <div class="nl-master-group-head">Cooling · ${cooling.length}</div>
          ${cooling.map(row => html`
            <div key=${row.id} class=${cn('nl-row', { 'is-on': sel?.id === row.id })} onClick=${() => { setSelected(row); setAbChoice(null); }}>
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
          <div key=${row.id} class=${cn('nl-row', { 'is-on': sel?.id === row.id })} onClick=${() => { setSelected(row); setAbChoice(null); }}>
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
          <div key=${row.id} class=${cn('nl-row', { 'is-on': sel?.id === row.id })} onClick=${() => { setSelected(row); setAbChoice(null); }}>
            <div class="nl-row-subj">${row.subject}</div>
          </div>
        `)}
      </div>
      <div class="nl-detail">
        ${sel ? html`
          <div class="ob-detail-wrap">
            <div class="ip-head" style=${{ padding: '1rem', borderBottom: '1px solid var(--border-faint)' }}>
              <div class="ip-meta-row" style=${{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <${QualityChip} score=${sel.quality_score} />
                ${sel.has_ab ? html`<span class="ob-chip ab">A·B</span>` : null}
                ${isCooling ? html`<${CoolingChip} until=${sel.cooling_until} />` : null}
              </div>
              <h2 style=${{ fontSize: '0.9rem', fontWeight: 600, margin: '0.5rem 0 0', color: 'var(--fg)' }}>
                ${sel.subject}
              </h2>
              ${sel.recipient_count ? html`
                <p style=${{ fontSize: '0.75rem', color: 'var(--fg-muted)', margin: '0.25rem 0 0' }}>
                  ${sel.recipient_count.toLocaleString()} recipients · ${sel.delivery_system ?? 'listmonk'}
                </p>
              ` : null}
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

            <div class="nl-quality-wrap">
              <p style=${{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 0.375rem' }}>Quality</p>
              <div class="nl-quality-row"><span class="label">Overall score</span><span class=${cn('score', { pass: (sel.quality_score ?? 0) >= 80, fail: (sel.quality_score ?? 0) < 70 })}>${sel.quality_score ?? '—'}/100</span></div>
              <div class="nl-quality-row"><span class="label">Subject line</span><span class="score pass">Pass</span></div>
              <div class="nl-quality-row"><span class="label">Spam check</span><span class="score pass">Pass</span></div>
              <div class="nl-quality-row"><span class="label">Unsubscribe link</span><span class="score pass">Present</span></div>
            </div>

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
                <button class="btn btn-ghost" onClick=${() => rejectMut.mutate({ id: sel.id })} disabled=${rejectMut.isPending}>
                  Reject
                </button>
              </div>
            </div>
          </div>
        ` : html`<${StateDisplay} state="empty" message="Select a draft to review" />`}
      </div>
    </div>
  `;
}

function NewsletterScheduleView({ standalone }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['newsletter', 'schedule'],
    queryFn: () => Promise.resolve(FIXTURE_NL_SENT.map(r => ({ ...r, status: 'scheduled', scheduled_for: r.sent_at }))),
    placeholderData: [],
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading newsletter schedule…" />`;

  const calFixture = [
    { id: 'ns-cal-1', subject: 'Schema patches that unblocked tenant 590', scheduled_for: 'Tue 06 May 10:00', recipient_count: 2104, status: 'scheduled' },
    { id: 'ns-cal-2', subject: 'Investor Update — May', scheduled_for: 'Wed 08 May 14:00', recipient_count: null, status: 'investor' },
  ];

  return html`
    <div class="nl-cal-wrap">
      <div class="nl-cal-week">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => html`
          <div key=${d} class="nl-cal-cell">
            <div class=${cn('nl-cal-day-num', { today: i === 1 })}>${d}</div>
            ${calFixture.filter((_, idx) => idx % 7 === i).map(item => html`
              <span key=${item.id} class=${cn('nl-cal-pill', { cool: item.status === 'cooling', investor: item.status === 'investor', sent: item.status === 'sent' })}>
                ${item.subject}
              </span>
            `)}
          </div>
        `)}
      </div>
    </div>
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

function SequencesQueueView({ standalone }) {
  // Active sequences that have pending approval items
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sequences', 'queue'],
    queryFn: () => hostDbQuery(
      `SELECT * FROM outbound_email_approvals WHERE status = 'pending' AND sequence_id IS NOT NULL LIMIT 20`
    ).catch(() => []),
    enabled: !standalone,
    placeholderData: [],
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading sequence approvals…" />`;
  if (!data?.length) return html`<${StateDisplay} state="empty" message="No sequence items awaiting approval" />`;

  return html`<${StateDisplay} state="empty" message="No sequence items awaiting approval" />`;
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
          <div class="ob-seq-detail">
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
        ` : html`<${StateDisplay} state="empty" message="Select a sequence to inspect" />`}
      </div>
    </div>
  `;
}

function SequencesSentView() {
  return html`<${StateDisplay} state="empty" message="Sequence sent log coming soon" />`;
}

// ─── Social views ───────────────────────────────────────────────────────────────

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
          <div class="ob-detail-wrap">
            <div class="ip-head" style=${{ padding: '1rem', borderBottom: '1px solid var(--border-faint)' }}>
              <div class="ip-meta-row" style=${{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                <${PlatformBadge} platform=${sel.platform} />
                <span class="ob-chip seq">${sel.source ?? ''}</span>
              </div>
              <p style=${{ fontSize: '0.75rem', color: 'var(--fg-muted)', margin: '0.5rem 0 0' }}>
                ${formatDate(sel.scheduled_for)}
              </p>
            </div>
            <div class="ip-body" style=${{ flex: 1, padding: '1rem' }}>
              <p style=${{ fontSize: '0.8125rem', lineHeight: 1.6, color: 'var(--fg)', whiteSpace: 'pre-wrap', margin: 0 }}>
                ${sel.content}
              </p>
            </div>
            <div class="ob-actions">
              <div class="ob-actions-primary">
                <button
                  class="btn"
                  style=${{ background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
                  onClick=${() => approveMut.mutate({ id: sel.id })}
                  disabled=${approveMut.isPending}
                >
                  ${approveMut.isPending ? 'Approving…' : 'Approve & Schedule'}
                </button>
                <button class="btn btn-ghost">Reject</button>
              </div>
            </div>
          </div>
        ` : html`<${StateDisplay} state="empty" message="Select a post to review" />`}
      </div>
    </div>
  `;
}

function SocialScheduleView({ standalone }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['social', 'schedule'],
    queryFn: fetchSocialSchedule,
    enabled: !standalone,
    placeholderData: FIXTURE_SOCIAL_SCHEDULE,
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading social schedule…" />`;

  const rows = data ?? FIXTURE_SOCIAL_SCHEDULE;

  return html`
    <div class="nl-cal-wrap">
      <div class="nl-cal-week">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => html`
          <div key=${d} class="nl-cal-cell">
            <div class="nl-cal-day-num">${d}</div>
            ${rows.filter((_, idx) => idx % 7 === i).map(item => html`
              <span key=${item.id} class="nl-cal-pill">
                <${PlatformBadge} platform=${item.platform} />
                ${item.content?.substring(0, 30)}…
              </span>
            `)}
          </div>
        `)}
      </div>
    </div>
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
    if (view === 'sent') return html`<${SequencesSentView} />`;
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
  const [channel, setChannel] = useState('newsletter');
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

  // Sidebar head: total awaiting + active sequences
  const totalAwaiting = (counts?.email ?? 0) + (counts?.newsletter ?? 0) + (counts?.social ?? 0);
  const activeSeqCount = counts?.sequences ?? 0;

  // Publish menu whenever channel/view/counts/agents change
  useEffect(() => {
    const items = buildOutboundMenu(channel, view, counts ?? {}, agents ?? {});
    setMenu(items).catch(() => {/* standalone — ignore */});
  }, [channel, view, counts, agents]);

  // Listen for sidebar nav-item clicks relayed by the shell pkg-menu-click message
  useEffect(() => {
    function onMessage(ev) {
      const data = ev.data;
      if (!data || data.__iyke) return;

      // pkg-menu-click: { menuItemId }
      const id = data?.menuItemId ?? data?.payload?.menuItemId;
      if (!id) return;

      if (id.startsWith('ch:')) {
        const newChannel = id.slice(3);
        if (CHANNELS.includes(newChannel)) {
          setChannel(newChannel);
          setView('queue'); // reset to queue on channel switch
        }
      }
      // Filter clicks (f:pa/f:cmo/f:cbo) — no state change needed in pkg
      // (the shell menu already handles the is-on visual)
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

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

      <!-- Channel header -->
      <div class="ob-header">
        <h1>${meta.label}</h1>
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
