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
// Data: SINGLE SOURCE — pa_action_drafts (approve-gate + mutation-worker seam) via
//       host.dbQuery, mapped per content type by dist/lib/derive.js (G-DERIVE).
//       plans/outbound-pkg/01-plan.md.

import {
  html,
  cn,
  Icon,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useQuery,
  useMutation,
  useQueryClient,
} from '../../lib/ui.js';
import {
  hostDbQuery,
  setMenu,
  isStandalone,
  publishIykeState,
  hostNavigate,
  hostSendToActiveSession,
  hostPaActionsCommit,
  hostPaActionsReject,
  hostPaActionsRetry,
  hostPaActionsUpdate,
} from '../../lib/bridge.js';
import {
  QUEUE_STATUSES,
  SENT_STATUSES,
  SCHEDULE_STATUSES,
  deriveContentType,
  parseDraft,
  countByContentType,
  mapEmailQueue,
  mapEmailSent,
  mapNewsletterQueue,
  mapNewsletterSent,
  mapSocialQueue,
  mapSocialSent,
  mapSequenceQueue,
} from '../../lib/derive.js';

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

// ─── Initial channel/view resolution (deep-link, WP-07) ─────────────────────────
// The shell deep-links /outbox/{email,newsletter,social,sequences,approvals} into
// this pkg and pre-seeds usePkgMenuStore activeFeature as 'v:<view>' (F9). The
// iframe is also mounted at the matching sub-route (pathname '/email' etc.). We
// honour BOTH: the pre-seeded activeFeature wins, the pathname is the fallback.
// 'approvals' is the cross-channel folded approve-gate; the channels map 1:1 to
// the per-channel Approval queue. Returns { channel, view } where view is one of
// 'queue' | 'approvals' (deep-links only ever land on a queue/approvals surface).

function viewFromToken(token) {
  if (!token) return null;
  // 'approvals' → cross-channel; a channel name → that channel's queue.
  if (token === 'approvals') return { channel: 'newsletter', view: 'approvals' };
  if (CHANNELS.includes(token)) return { channel: token, view: 'queue' };
  return null;
}

function parseInitialTarget(activeFeature) {
  // 1. Pre-seeded activeFeature: 'ch:<channel>' or 'v:<view>'.
  if (typeof activeFeature === 'string') {
    if (activeFeature.startsWith('ch:')) {
      const r = viewFromToken(activeFeature.slice(3));
      if (r) return r;
    }
    if (activeFeature.startsWith('v:')) {
      const r = viewFromToken(activeFeature.slice(2));
      if (r) return r;
    }
  }
  // 2. Pathname fallback: the last segment of /pkg/com.ikenga.outbound/<seg>.
  try {
    const segs = (window.location?.pathname || '').split('/').filter(Boolean);
    const last = segs[segs.length - 1];
    const r = viewFromToken(last);
    if (r) return r;
  } catch {
    /* no window/location in some embeds — fall through to default */
  }
  return null;
}

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

// ─── Queries — single source: pa_action_drafts (approve-gate + worker seam) ──
// All channel surfaces derive from ONE table via dist/lib/derive.js. `channel` is
// the provider; deriveContentType() splits email/newsletter/social/sequences.
// host.dbQuery reads are NOT table-scoped, so no manifest change is needed here.

const SEL_COLS = `id, batch_id, action_id, status, channel, payload_json, edited_json,
  scheduled_at, created_at, committed_at, sent_at, attempts, error_text, external_id, delivery_status`;

async function loadDrafts(statuses, { limit = 300 } = {}) {
  const ph = statuses.map(() => '?').join(',');
  try {
    return await hostDbQuery(
      `SELECT ${SEL_COLS} FROM pa_action_drafts WHERE status IN (${ph})
       ORDER BY COALESCE(sent_at, scheduled_at, created_at) DESC LIMIT ${limit}`,
      statuses
    );
  } catch {
    return [];
  }
}

// Filter loaded rows to one content type + map to the renderer's view shape.
function pick(rows, ct, mapper) {
  const out = [];
  for (const r of rows || []) {
    if (deriveContentType(parseDraft(r).item) === ct) out.push(mapper(r));
  }
  return out;
}
const hasSchedule = (r) => !!r.scheduled_at;

async function fetchChannelCounts() {
  return countByContentType(await loadDrafts(QUEUE_STATUSES));
}

async function fetchAgentCounts(channel) {
  const results = { pa: 0, cmo: 0, cbo: 0 };
  for (const r of await loadDrafts(QUEUE_STATUSES)) {
    const { item, meta } = parseDraft(r);
    if (deriveContentType(item) !== channel) continue;
    const key = String(meta.agent || 'pa').toLowerCase();
    if (key in results) results[key] += 1;
  }
  return results;
}

// ── Email ────────────────────────────────────────────────────────────────────
async function fetchEmailQueue() {
  const m = pick(await loadDrafts(QUEUE_STATUSES), 'email', mapEmailQueue);
  return m.length ? m : FIXTURE_EMAIL_QUEUE;
}

async function fetchEmailSchedule() {
  const rows = (await loadDrafts(SCHEDULE_STATUSES)).filter(hasSchedule);
  const m = pick(rows, 'email', mapEmailQueue);
  return m.length ? m : FIXTURE_EMAIL_SCHEDULE;
}

async function fetchEmailSent() {
  const m = pick(await loadDrafts(SENT_STATUSES), 'email', mapEmailSent);
  return m.length ? m : FIXTURE_EMAIL_SENT;
}

// ── Newsletter ────────────────────────────────────────────────────────────────
async function fetchNewsletterQueue() {
  const m = pick(await loadDrafts(QUEUE_STATUSES), 'newsletter', mapNewsletterQueue);
  return m.length ? m : FIXTURE_NL_QUEUE;
}

async function fetchNewsletterSent() {
  const m = pick(await loadDrafts(SENT_STATUSES), 'newsletter', mapNewsletterSent);
  return m.length ? m : FIXTURE_NL_SENT;
}

// ── Sequences (flat first slice; cohort grid + funnel are Phase 2) ─────────────
// A "sequence" = pa_action_drafts rows whose item.sequence is set, grouped by name.
function seqGroups(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const { item } = parseDraft(r);
    if (deriveContentType(item) !== 'sequences') continue;
    const name = (item.sequence && item.sequence.name) || item.subject || '(sequence)';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ r, item });
  }
  return groups;
}

async function fetchSequenceDefs() {
  const defs = [];
  for (const [name, members] of seqGroups(await loadDrafts([...QUEUE_STATUSES, ...SENT_STATUSES]))) {
    const { r, item } = members[0];
    const seq = item.sequence || {};
    defs.push({ id: r.batch_id || r.id, name, slug: r.batch_id || null, segment: item.recipient || null,
                total_steps: seq.total ?? null, delivery_system: r.channel, status: 'active' });
  }
  return defs.length ? defs : FIXTURE_SEQ_DEFS;
}

async function fetchActiveSequences() {
  const out = [];
  for (const r of await loadDrafts(QUEUE_STATUSES)) {
    const { item } = parseDraft(r);
    if (deriveContentType(item) !== 'sequences') continue;
    const seq = item.sequence || {};
    out.push({ id: r.id, sequence_id: r.batch_id || r.id, contact_email: item.recipientEmail || item.recipient || 'batch',
               segment: item.recipient || null, current_step: seq.step ?? 1, total_steps: seq.total ?? null,
               next_send_date: r.scheduled_at || null, status: 'active', sent_count: seq.recipients ?? 0,
               sequence_name: seq.name || item.subject, sequence_slug: r.batch_id || null, delivery_system: r.channel });
  }
  return out.length ? out : FIXTURE_ACTIVE_SEQS;
}

async function fetchSequenceQueue() {
  const m = pick(await loadDrafts(QUEUE_STATUSES), 'sequences', mapSequenceQueue);
  return m.length ? m : FIXTURE_SEQ_QUEUE;
}

// Per-step rail + per-recipient cohort are Phase 2 (steps/recipients aren't modeled
// as distinct rows yet) — return empty so the renderer empty-states honestly.
async function fetchSequenceSteps(sequenceId) {
  return sequenceId ? [] : [];
}

async function fetchSequenceRecipients(sequenceId) {
  return sequenceId ? [] : [];
}

async function fetchSentSequences() {
  const out = [];
  for (const [name, members] of seqGroups(await loadDrafts(SENT_STATUSES))) {
    const { r, item } = members[0];
    const seq = item.sequence || {};
    const enrolled = members.length;
    const bounced = members.filter((m) => m.r.delivery_status === 'bounced').length;
    out.push({ sequence_id: r.batch_id || r.id, sequence_name: name, sequence_slug: r.batch_id || null,
               total_steps: seq.total ?? null, enrolled, completed: enrolled, replied: 0, bounced,
               sent_total: enrolled, closed_at: r.sent_at || null });
  }
  return out.length ? out : FIXTURE_SENT_SEQS;
}

// Relative-age label for the reply-intelligence "last touch" cell.
// compact:true → terse top-right form for email rows ("15m", "6h", "2d", "just now").
function relDays(iso, { compact = false } = {}) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const ms = Date.now() - t;
  if (ms < 0) return compact ? '' : '—'; // future
  const mins = Math.round(ms / 60_000);
  if (compact && mins < 2) return 'just now';
  const d = Math.round(ms / 86_400_000);
  if (compact) {
    if (mins < 60) return `${mins}m`;
    const h = Math.round(ms / 3_600_000);
    if (h < 24) return `${h}h`;
    if (d < 7) return `${d}d`;
    if (d < 30) return `${Math.round(d / 7)}w`;
    if (d < 365) return `${Math.round(d / 30)}mo`;
    return `${Math.round(d / 365)}y`;
  }
  if (d <= 0) return 'today';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.round(d / 7)}w ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

// From-label for email queue grouped rows (spec 01-email-grouping.md §5).
function emailFromLabel(row) {
  if (row.emailGroup === 'sequence') {
    const who = row.drafted_by ?? '—';
    const seq = row.sequence_id ?? '—';
    return `${who} → ${seq}`;
  }
  if (row.emailGroup === 'reply') {
    return row.recipient_name || row.recipient_email || '—';
  }
  // manual
  const who = row.drafted_by ?? '—';
  const recip = row.recipient_name || row.recipient_email;
  return recip ? `${who} → ${recip}` : who;
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
  const m = pick(await loadDrafts(QUEUE_STATUSES), 'social', mapSocialQueue);
  return m.length ? m : FIXTURE_SOCIAL_QUEUE;
}

async function fetchSocialSchedule() {
  const rows = (await loadDrafts(SCHEDULE_STATUSES)).filter(hasSchedule);
  const m = pick(rows, 'social', mapSocialQueue);
  return m.length ? m : FIXTURE_SOCIAL_SCHEDULE;
}

async function fetchSocialSent() {
  const m = pick(await loadDrafts(SENT_STATUSES), 'social', mapSocialSent);
  return m.length ? m : FIXTURE_SOCIAL_SENT;
}

// ── Approval mutations — the FOLDED approve-gate write path (WP-04, G-PAACTIONS) ──
// SINGLE SOURCE: every channel's approve/reject/retry/edit operates on the
// pa_action_drafts row `id` via the new host.paActions* verbs (Strategy B —
// thin shell wrappers over the tested pa_actions_* Rust commands). The legacy
// `src` branching is GONE: ids are now pa_action_drafts ids, identical across
// channels, so there is one commit path. Approve uses a 10s LOCAL undo window
// (no DB write during the window — see useUndoCommit); these fns fire only after
// the timer elapses (commit) or immediately (reject/retry/edit).
//
//   approve → host.paActions.commit  (status → committed → worker sends)
//   reject  → host.paActions.reject  (will not send)
//   retry   → host.paActions.retry   (failed → committed; clears claim/error + wakes)
//   edit    → host.paActions.update  ({subject,body} → edited_json, awaiting→edited)
//
// NOTE: reject reason text is captured in the pkg UI for the writer-agent training
// set, but the shell pa_actions_reject verb takes only the draftId (it does not
// persist a free-text reason on the row) — the reason is surfaced to chat/handoff,
// not written to pa_action_drafts. So the channel-specific reject fns ignore the
// reason for the write and just call the verb.

async function approveDraft(id) {
  // Defense-in-depth (review G-01): only commit a row that is still awaiting/edited.
  // pa_actions_commit guards on its SELECT (status IN awaiting/edited) but the UPDATE
  // has no status predicate — this FE pre-check closes the TOCTOU window before the
  // verb round-trip. Committing an already committed/sending/sent row would otherwise
  // flip it back to 'committed' and the worker could DOUBLE-SEND. This also closes the
  // 10s-undo-window race (if the row changed while the timer ran).
  const rows = await hostDbQuery('SELECT status FROM pa_action_drafts WHERE id = ?', [id]);
  const st = rows?.[0]?.status;
  if (st !== 'awaiting' && st !== 'edited') {
    throw new Error(`cannot approve: draft is '${st ?? 'missing'}' (only awaiting/edited can be sent)`);
  }
  await hostPaActionsCommit(id);
}

async function rejectDraft(id, _reason = null) {
  await hostPaActionsReject(id);
}

async function retryDraft(id) {
  await hostPaActionsRetry(id);
}

async function updateDraft(id, patch) {
  await hostPaActionsUpdate(id, patch);
}

// ── 10-second undo before commit (WP-04) ──────────────────────────────────────
// Ported from shell/src/shell/atelier/surfaces/approve-gate-panel.tsx:177-197.
// Approve ARMS a countdown (default 10s); NO DB write happens during the window.
// When the counter reaches 0 it calls `onCommit(id)` (→ host.paActions.commit).
// `cancel()` clears the timer so commit never fires. Pure-React, zero host
// involvement during the window. One armed draft at a time (matches the single-
// detail approve UX); arming a new one replaces the prior pending undo.
//
// Returns { armed, secondsLeft, arm, cancel, isArmed }:
//   armed       — the draft id currently counting down (or null)
//   secondsLeft — remaining whole seconds for the armed draft
//   arm(id, ms) — start the countdown for `id` (ms defaults to 10000)
//   cancel()    — abort the pending commit
//   isArmed(id) — convenience predicate for per-row rendering
function useUndoCommit(onCommit) {
  const [undo, setUndo] = useState(null); // { draftId, secondsLeft } | null

  const arm = useCallback((draftId, undoMs = 10000) => {
    setUndo({ draftId, secondsLeft: Math.round((undoMs ?? 10000) / 1000) });
  }, []);

  const cancel = useCallback(() => setUndo(null), []);

  // Drive the countdown; commit (onCommit + clear) at 0. Mirrors approve-gate.
  useEffect(() => {
    if (!undo) return;
    if (undo.secondsLeft <= 0) {
      onCommit(undo.draftId);
      setUndo(null);
      return;
    }
    const t = setTimeout(
      () => setUndo((u) => (u ? { ...u, secondsLeft: u.secondsLeft - 1 } : null)),
      1000
    );
    return () => clearTimeout(t);
  }, [undo, onCommit]);

  return {
    armed: undo?.draftId ?? null,
    secondsLeft: undo?.secondsLeft ?? 0,
    arm,
    cancel,
    isArmed: (id) => undo?.draftId === id,
  };
}

// Inline undo banner — shown while a commit is armed. Cancel aborts the send.
function UndoBar({ secondsLeft, onCancel, label = 'Sending' }) {
  return html`
    <div class="ob-undo-bar" role="status">
      <span class="ob-undo-text">
        ${label} in <strong>${secondsLeft}s</strong> — change your mind?
      </span>
      <button class="ob-btn-sm" onClick=${onCancel}>Undo</button>
    </div>
  `;
}

// C-2: only an awaiting/edited draft can be approved (the verb's SELECT guard).
// committed/sending/sent rows render a disabled status chip instead of Approve.
const isApprovable = (r) => !!r && (r.raw_status === 'awaiting' || r.raw_status === 'edited');

// C-2: disabled status chip shown in the action footer when a row is NOT
// approvable (already committed/sending/etc.) and NOT failed.
const RAW_STATUS_LABEL = {
  committed: 'Queued to send',
  sending: 'Sending…',
  sent: 'Sent',
  rejected: 'Rejected',
};
function StatusChip({ rawStatus }) {
  const label = RAW_STATUS_LABEL[rawStatus] ?? (rawStatus ? `Status · ${rawStatus}` : 'Not approvable');
  return html`
    <div class="ob-status-chip" role="status" aria-disabled="true" title=${label}>
      ${label}
    </div>
  `;
}

// C-5: inline error chip surfaced near the action footer when a commit is refused
// (e.g. "Already committed — nothing sent.").
function CommitError({ message }) {
  if (!message) return null;
  return html`
    <div class="atelier-state is-error ob-commit-error" role="alert">${message}</div>
  `;
}

// F-7: before-click consequence line populated from the selected draft, shown
// ABOVE the Approve button so the operator sees the effect before committing.
function ConsequenceLine({ recipient, channel, scheduled }) {
  const when = scheduled || 'now';
  const parts = [
    `→ sends to ${recipient || 'segment'}`,
    channel || 'channel',
    when,
    'undo 10s',
  ];
  return html`
    <div class="ob-consequence ob-act-meta">${parts.join(' · ')}</div>
  `;
}

// C-3: FLOATING undo banner — rendered at the view root keyed on the ARMED
// draftId (not the selected row), so an armed send stays cancellable no matter
// which row the operator selects. Arming a new draft replaces the prior pending
// one (single-armed invariant lives in useUndoCommit); the timer is cleaned up
// on unmount there too.
function FloatingUndoBar({ armed, secondsLeft, onCancel, subject, label = 'Sending' }) {
  if (!armed) return null;
  const what = subject ? `“${subject}”` : 'draft';
  return html`
    <div class="ob-undo-bar ob-undo-floating" role="status">
      <span class="ob-undo-text">
        ${label} ${what} in <strong>${secondsLeft}s</strong> — change your mind?
      </span>
      <button class="ob-btn-sm" onClick=${onCancel}>Undo</button>
    </div>
  `;
}

// Edit-in-place panel — patch subject/body, writes via host.paActions.update.
// onSave(patch) receives { subject, body } and resolves to advance edited→.
function EditPanel({ subject, body, onSave, onCancel, pending }) {
  const [subj, setSubj] = useState(subject ?? '');
  const [bod, setBod] = useState(body ?? '');
  return html`
    <div class="ob-edit-panel">
      <span class="ob-edit-label">Edit before approving</span>
      <label class="ob-edit-field">
        <span>Subject</span>
        <input type="text" value=${subj} onInput=${(e) => setSubj(e.target.value)} />
      </label>
      <label class="ob-edit-field">
        <span>Body</span>
        <textarea rows="6" value=${bod} onInput=${(e) => setBod(e.target.value)}></textarea>
      </label>
      <div class="ob-edit-row">
        <button class="ob-btn-sm" onClick=${onCancel}>Cancel</button>
        <button
          class="ob-btn-sm is-primary"
          disabled=${pending}
          onClick=${() => onSave({ subject: subj, body: bod })}
        >${pending ? 'Saving…' : 'Save edit'}</button>
      </div>
    </div>
  `;
}

// Fan-out siblings: pa_action_drafts rows sharing the selected post's batch_id
// (one approved social post fans out to N provider rows). batch_id is the group key.
async function fetchSocialFanout(slug) {
  if (!slug) return [];
  try {
    const rows = await hostDbQuery(
      `SELECT ${SEL_COLS} FROM pa_action_drafts WHERE batch_id = ? ORDER BY channel ASC`,
      [slug]
    );
    return (rows || []).map(mapSocialSent);
  } catch {
    return [];
  }
}

// ─── Fixture data (fallback until real rows exist) ──────────────────────────────

const FIXTURE_EMAIL_QUEUE = [
  // ── Replies group (emailGroup: 'reply') ─────────────────────────────────────
  // eq-r1 recipient is keyed into FIXTURE_CRM → drives the full 8-cell ri-grid
  // in standalone. Auto-selected first (rows[0]) so the showcase opens on it.
  {
    id: 'eq-r1',
    subject: 'Re: Royalti onboarding · file processing delay',
    body: `Hi,\n\nThanks for flagging this. The delay you saw was caused by a schema mismatch on the ingestion side — we patched it in 0.7.4 and the backfill ran clean this morning.\n\nYour tenant (id 590) should now show all statements. Let me know if anything looks off.\n\nBest,\nRuby`,
    recipient_name: 'Valentim de Carvalho',
    recipient_email: 'valentim@soundlabel.pt',
    channel: 'smtp',
    status: 'pending',
    raw_status: 'awaiting',
    ux_mode: 'approve',
    is_overdue: 1,
    hours_late: 17,
    src: 'approval',
    scheduled_for: null,
    drafted_by: 'pa',
    tenant_id: 590,
    emailGroup: 'reply',
  },
  {
    id: 'eq-r2',
    subject: 'Re: Pricing question for enterprise tier',
    body: `Hi Amara,\n\nGreat question — enterprise pricing is bespoke and based on catalog size and team seats.\n\nHappy to jump on a 20-minute call this week to walk through the numbers. Does Thursday 15:00 WAT work?\n\nBest,\nChinedum`,
    recipient_name: 'Amara Okafor',
    recipient_email: 'amara.okafor@afrobeats-dist.com',
    channel: 'smtp',
    status: 'pending',
    raw_status: 'awaiting',
    ux_mode: 'approve',
    is_overdue: 0,
    src: 'approval',
    scheduled_for: 'Today 16:00',
    drafted_by: 'cbo',
    topic_tag: 'enterprise',
    emailGroup: 'reply',
  },
  // ── Manual outreach group (emailGroup: 'manual') ────────────────────────────
  {
    id: 'eq-m1',
    subject: 'Welcome — your Royalti tenant is ready',
    body: `Hi {{first_name}},\n\nYour Royalti workspace is live. Here is what you can do in the first 48 hours:\n\n1. Ingest your first statement from the Statements tab.\n2. Set up your split templates under Settings → Splits.\n3. Invite your accountant or distributor contact.\n\nIf anything is unclear the docs are at docs.royalti.io and I am available on this email.\n\nRuby`,
    recipient_name: '{{first_name}}',
    recipient_email: '',
    channel: 'resend',
    status: 'pending',
    raw_status: 'awaiting',
    ux_mode: 'approve',
    is_overdue: 0,
    src: 'approval',
    scheduled_for: 'Today 14:30',
    drafted_by: 'pa',
    emailGroup: 'manual',
  },
  // ── Sequence step group (emailGroup: 'sequence') ────────────────────────────
  {
    id: 'eq-s1',
    subject: 'Following up on the Royalti deck · step 2',
    body: `Hi [first name],\n\nWanted to circle back on the deck I sent last week — if you had a chance to look, happy to walk you through the ingestion demo on a 15-minute call.\n\nAlternatively I can send a Loom if async is easier. Just say the word.\n\nBest,\nChinedum`,
    recipient_name: 'ar@universalmusic.pt',
    recipient_email: 'ar@universalmusic.pt',
    channel: 'smtp',
    status: 'pending',
    raw_status: 'awaiting',
    ux_mode: 'approve',
    is_overdue: 0,
    src: 'approval',
    scheduled_for: 'Mon 09:00',
    drafted_by: 'pa',
    emailGroup: 'sequence',
    sequence_id: 'Cold A&R outreach',
    sequence_step: 2,
    sequence_total: 4,
  },
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
  { id: 'nl-1', subject: 'You can deliver from Royalti now', subject_b: null, draft_slug: 'royalti-deliver', status: 'cooling', raw_status: 'awaiting', cooling_until: '47m', quality_score: 92, recipient_count: 2104, delivery_system: 'listmonk', drafted_by: 'cmo', has_ab: 0,
    preheader: 'Send DDEX messages from your workspace — no aggregator required.',
    from_line: 'Ruby <ruby@royalti.io>',
    body: `Royalti now ships a full delivery pipeline.\n\nYou can send DDEX ERN4 messages directly from your workspace to DSPs that accept DDEX — no third-party aggregator account required for the initial batch.\n\nHere is what that means in practice:\n\n## What changed\n\nThe delivery seam was the last piece of the puzzle. Before this release, labels using Royalti could ingest statements and calculate royalties, but the outbound leg still meant exporting a spreadsheet and handing it to a distributor.\n\nNow the loop is closed. A single approval in the Outbound pane sends a DDEX message to your connected DSPs.\n\n## What you need to do\n\nIf you are already on Royalti, your tenant is DDEX-ready. Go to Settings → Delivery, connect your first DSP endpoint, and submit a test release. The confirmation takes 24 hours.\n\nIf you are not on Royalti yet, you can request early access at royalti.io/deliver.\n\n## What is next\n\nWe are working on a MEAD profile for sync licensing and a batch-release scheduler. Both are on the public roadmap.\n\nAs always, reply to this email with questions — Ruby reads every one.\n\nRuby\nRoyalti` },
  { id: 'nl-2', subject: 'Schema patches that unblocked tenant 590', subject_b: 'The shape disparity that was eating royalty data', draft_slug: 'schema-patches-590', status: 'pending', raw_status: 'awaiting', cooling_until: null, quality_score: 86, recipient_count: 2104, delivery_system: 'listmonk', drafted_by: 'cmo', has_ab: 1,
    preheader: 'A two-line migration fix that took three days to find — and how we made it automatic.',
    from_line: 'Ruby <ruby@royalti.io>',
    body: `Tenant 590 hit a wall last month.\n\nWhen they uploaded their first statement batch, the ingestion pipeline rejected 312 rows because the revenue model field was an enum the schema didn't recognise.\n\nThe fix was a two-line migration, but finding it took three days of log triage.\n\nWe are writing about it because the same shape problem shows up across 8% of new tenants in their first month. This is the kind of thing that erodes trust before a product has a chance to prove itself.\n\nThe patch is in 0.7.3. If you are running an older version, the upgrade path is in the docs.\n\nRuby` },
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
  { id: 'seq-q1', name: 'distributor-q3', slug: 'distributor-q3', description: 'Cold outbound to 14 distributor leads sourced from Q1 trade-show contacts. 4 steps over 21 days.', segment: 'distributor-leads-q1', total_steps: 4, delivery_system: 'resend', status: 'in_review', raw_status: 'awaiting', created_by: 'vp-sales-agent', created_at: '2026-04-28' },
  { id: 'seq-q2', name: 'label-onboarding-v3', slug: 'label-onboarding-v3', description: 'Replaces v2. New labels get 5 emails over 14 days walking them from signup → first statement ingested.', segment: 'new-labels', total_steps: 5, delivery_system: 'listmonk', status: 'in_review', raw_status: 'awaiting', created_by: 'pa', created_at: '2026-04-27' },
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
  // ── Blog announcement · fan-out batch (LinkedIn + X + Bluesky share blog-01) ──
  // Three siblings collapse to ONE display row carrying all three platform pills.
  { id: 'sq-b1-li', slug: 'blog-01', platform: 'linkedin', account: 'Royalti', source_group: 'blog', blog_slug: 'royalty-calc-overhaul', content: 'The royalty calculator overhaul shipped this week. Statements ingest in ~90s for a 30k-row CSV, and splits recompute live as you edit. #royalti #musicbusiness', status: 'in_review', raw_status: 'awaiting', scheduled_for: '2026-06-10 12:48', source: 'C-07', title: 'Royalty calculator overhaul · launch post', drafted_by: 'pa', thread_index: null, thread_total: null, tone_check: false, media_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200&h=627&fit=crop', hashtags: ['#royalti', '#musicbusiness', '#labels'], platforms: ['linkedin'], thread: null },
  { id: 'sq-b1-x', slug: 'blog-01', platform: 'x', account: 'royalti_io', source_group: 'blog', blog_slug: 'royalty-calc-overhaul', content: 'The royalty calculator overhaul shipped this week. Statements ingest in ~90s for a 30k-row CSV…', status: 'in_review', raw_status: 'awaiting', scheduled_for: '2026-06-10 12:48', source: 'C-07', title: 'Royalty calculator overhaul · launch post', drafted_by: 'pa', thread_index: null, thread_total: null, tone_check: false, media_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200&h=627&fit=crop', hashtags: ['#royalti', '#musicbusiness', '#labels'], platforms: ['x'], thread: null },
  { id: 'sq-b1-bs', slug: 'blog-01', platform: 'bluesky', account: 'royalti.io', source_group: 'blog', blog_slug: 'royalty-calc-overhaul', content: 'The royalty calculator overhaul shipped this week. Statements ingest in ~90s for a 30k-row CSV…', status: 'in_review', raw_status: 'awaiting', scheduled_for: '2026-06-10 12:48', source: 'C-07', title: 'Royalty calculator overhaul · launch post', drafted_by: 'pa', thread_index: null, thread_total: null, tone_check: false, media_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200&h=627&fit=crop', hashtags: ['#royalti', '#musicbusiness', '#labels'], platforms: ['bluesky'], thread: null },
  // ── Blog announcement · singleton (no batch, no blog_slug path) ───────────────
  { id: 'sq-b2', slug: null, platform: 'linkedin', account: 'Royalti', source_group: 'blog', blog_slug: null, content: 'New blog post: "Why we rewrote the splits engine in 6 weeks" — the trade-offs we made on accuracy vs speed, and what we\'d do differently.', status: 'pending', raw_status: 'awaiting', scheduled_for: '2026-06-10 14:00', source: 'C-09', title: 'Splits engine rewrite · explainer', drafted_by: 'pa', thread_index: null, thread_total: null, tone_check: false, media_url: null, hashtags: ['#engineering'], platforms: ['linkedin'], thread: null },
  // ── AI generation · tone-check row (renders the tone-check warn chip) ─────────
  { id: 'sq-ai1', slug: null, platform: 'linkedin', account: 'Royalti', source_group: 'ai', blog_slug: null, content: 'If you\'ve ever fought with split sheets in Excel for a 6-feature track, you\'ll find this familiar. We turned that fight into one ledger.', status: 'in_review', raw_status: 'awaiting', scheduled_for: '2026-06-09 09:00', source: 'C-10', title: 'Split sheet story', drafted_by: 'ruby', thread_index: null, thread_total: null, tone_check: true, media_url: null, hashtags: [], platforms: ['linkedin'], thread: null },
  // ── AI generation · thread row (thread · 4 of 4 chip) ─────────────────────────
  { id: 'sq-ai2', slug: null, platform: 'x', account: 'royalti_io', source_group: 'ai', blog_slug: null, content: 'The least glamorous part of running a label: chasing a $124 cheque across three statement formats. Royalti unifies them into one ledger. 1/4', status: 'in_review', raw_status: 'awaiting', scheduled_for: '2026-06-09 11:00', source: 'C-11', title: 'Thread · chasing the cheque', drafted_by: 'cmo-agent', thread_index: 4, thread_total: 4, tone_check: false, media_url: null, hashtags: ['#royaltyaccounting', '#ddex'], platforms: ['x', 'bluesky'], thread: [
    '2/4: The root cause is the format war. Every distributor sends a different CSV shape — columns named differently, currency sometimes implicit, territory codes inconsistent.',
    '3/4: The fix is not a parser for each distributor. It is a schema all distributors can map to. That is what Royalti does under the hood.',
    '4/4: If you run a label and you are still reconciling by hand — try Royalti. Link in bio.',
  ] },
];

const FIXTURE_SOCIAL_SCHEDULE = [
  { id: 'sq-2', platform: 'twitter', account: 'royalti_io', content: 'Thread 1/7: The royalty data problem nobody talks about.', status: 'scheduled', scheduled_for: '2026-06-10 09:00', source: 'C-08' },
];

const FIXTURE_SOCIAL_SENT = [
  { id: 'sq-0', platform: 'linkedin', account: 'Royalti', content: 'We\'ve built a workspace that puts royalty data, outreach, and reporting in one place.', status: 'posted', scheduled_for: '2026-06-01 09:00', posted_at: '2026-06-01 09:01', source: 'C-06', media_url: 'https://royalti.io/og/workspace-card.jpg', hashtags: ['#royalti', '#musicbusiness'] },
];

// Fixture CRM records — keyed by LOWERCASED recipient_email. Provides the 8-cell
// ri-grid data (and the email scorecard's thread/personalization signals) in
// STANDALONE mode only; live mode resolves these from the host DB via
// fetchReplyIntelligence. Shape mirrors fetchReplyIntelligence's return.
// eq-r1 (valentim@soundlabel.pt) is the auto-selected first Replies row, so the
// showcase opens straight onto a populated grid.
const FIXTURE_CRM = {
  'valentim@soundlabel.pt': {
    tenant_name: 'Sound Label Lda.',
    tenant_sub: 'Distributor',
    last_touch: '3d ago',
    last_touch_sub: '14 interactions',
    health: 'Active',
    health_sub: '3d since contact',
    sequence: '— none — (direct reply)',
    sequence_sub: 'not part of a sequence run',
    catalog: '880 tracks',
    catalog_sub: 'Afropop / Fado blend · ingested 2026-03-12',
    open_balance: '$0',
    balance_sub: 'current',
    owner: 'Chinedum O.',
    owner_sub: 'CEO · direct relationship',
    risk_flag: 'None',
    risk_color: 'var(--live)',
    thread_count: 3,
  },
};

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

function OverdueChip({ hoursLate } = {}) {
  // Honest: only show lateness detail when the worker stamped a real hours_late.
  const detail = hoursLate > 0 ? ` · ${hoursLate}h late` : '';
  return html`<span class="ob-chip overdue">overdue${detail}</span>`;
}

function formatPct(v) {
  if (v == null) return '—';
  return (Number(v) * 100).toFixed(0) + '%';
}

function formatDate(v) {
  if (!v) return '—';
  return String(v);
}

// Compact relative-time for social queue rows ("now" / "12m" / "6h" / "3d").
// Honest: no signal → '—'. Treats the stored "YYYY-MM-DD HH:MM" as UTC.
function relativeTime(v) {
  if (!v) return '—';
  const t = new Date(String(v).replace(' ', 'T') + 'Z').getTime();
  if (!Number.isFinite(t)) return '—';
  const abs = Math.abs(Date.now() - t);
  if (abs < 60e3) return 'now';
  if (abs < 3600e3) return Math.round(abs / 60e3) + 'm';
  if (abs < 86400e3) return Math.round(abs / 3600e3) + 'h';
  return Math.round(abs / 86400e3) + 'd';
}

// Compact platform pill for the social-queue master rows — the design-system
// `.plat` family (mono, tinted, compact), NOT the full-width .ob-platform-badge.
const PLAT_KEY = { linkedin: 'li', twitter: 'x', x: 'x', bluesky: 'bs', bsky: 'bs', instagram: 'ig', facebook: 'fb' };
function PlatPill({ platform }) {
  const k = PLAT_KEY[platform] ?? platform;
  return html`<span class=${'plat plat-' + k}>${String(k).toUpperCase()}</span>`;
}

// Social source-group → verbatim design label + fixed render order (omit empties).
const SOURCE_GROUP_LABEL = { blog: 'Blog announcement', ai: 'AI generation', manual: 'Manual', reply: 'Reply' };
const SOCIAL_GROUP_ORDER = ['blog', 'ai', 'manual', 'reply'];
// Platform badge order within a fan-out row: li → x → bs → ig → fb.
const SOCIAL_PLAT_ORDER = ['linkedin', 'twitter', 'x', 'bluesky', 'bsky', 'instagram', 'facebook'];

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

// ─── Email draft quality cells (5-cell, design §B email) ─────────────────────
// Mirrors newsletterQualityCells shape: { label, value, sub, pct, tone } so the
// cells render through the exact same nl-quality-cell markup. crm = resolved CRM
// record from fetchReplyIntelligence, or null. Every cell is honest about its
// signal limits — '—' value and 'warn' tone when no real data exists.
function emailQualityCells(row, crm) {
  const body = row.body ?? '';
  const hasBody = !!body;
  const agent = row.drafted_by ?? null;

  // --- LENGTH --- direct body signal (line count). "on-voice" only signals the
  // draft came from a named agent — never claims voice analysis ran.
  const lines = hasBody ? body.split('\n').filter((s) => s.trim()).length : 0;
  const onVoice = agent ? 'on-voice' : 'heuristic';

  // --- CLAIMS --- detectable but not verifiable (no verifier pipeline yet).
  const claims = countClaims(body);

  // --- PERSONALIZATION --- merge-field count + CRM presence.
  const mergeCount = hasBody
    ? (body.match(/\{\{[^}]+\}\}|\[first[\s_]name\]/gi) || []).length
    : 0;
  const hasCrm = !!crm;
  const persLevel = mergeCount >= 3 ? 'High' : (mergeCount >= 1 || hasCrm) ? 'Med' : 'Low';
  const crmNote = hasCrm ? ' · via CRM' : (mergeCount ? '' : ' · no CRM');

  // --- THREAD CONTEXT --- CRM thread_count → full; sequence membership → partial;
  // nothing → honest "No thread · —". Never fabricates a count.
  const threadCount = crm?.thread_count;
  const hasSeq = !!row.sequence_id;
  const hasThread = threadCount != null && threadCount > 0;
  const threadLevel = hasThread && threadCount >= 3 ? 'Full'
                    : hasThread                     ? 'Partial'
                    : hasSeq                        ? 'Sequence'
                    :                                 'No thread';
  const priorLabel = hasThread
    ? `${threadCount} prior msg${threadCount !== 1 ? 's' : ''}`
    : '—';

  // --- TONE MATCH --- coarse anti-pattern heuristic, clearly labelled.
  const anti = countAntiPatterns(body);
  const toneOk = hasBody && anti === 0;

  return [
    {
      label: 'Length',
      value: lines ? `${lines}` : '—',
      sub: lines ? `lines · ${onVoice}` : 'no body',
      pct: lines ? Math.min(100, Math.round((lines / 8) * 100)) : 0,
      tone: !lines ? 'warn' : lines >= 2 && lines <= 8 ? 'ok' : 'warn',
    },
    {
      label: 'Claims',
      value: hasBody ? `${claims}` : '—',
      sub: hasBody ? (claims > 0 ? 'detected · unverified' : 'none detected') : 'no body',
      pct: hasBody ? Math.min(100, claims * 20) : 0,
      tone: !hasBody ? 'warn' : claims === 0 ? 'ok' : 'warn',
    },
    {
      label: 'Personalization',
      value: persLevel,
      sub: `${mergeCount} merge field${mergeCount !== 1 ? 's' : ''}${crmNote}`,
      pct: persLevel === 'High' ? 90 : persLevel === 'Med' ? 55 : 20,
      tone: persLevel === 'High' ? 'ok' : 'warn',
    },
    {
      label: 'Thread context',
      value: threadLevel,
      sub: priorLabel,
      pct: threadLevel === 'Full' ? 100 : threadLevel === 'Partial' ? 60 : threadLevel === 'Sequence' ? 40 : 0,
      tone: threadLevel === 'Full' ? 'ok' : 'warn',
    },
    {
      label: 'Tone match',
      value: !hasBody ? '—' : toneOk ? 'On-voice' : 'Off-voice',
      sub: !hasBody ? 'no body' : agent ? `${agent} model · heuristic` : 'heuristic',
      pct: !hasBody ? 0 : toneOk ? 88 : Math.max(10, 88 - anti * 25),
      tone: !hasBody ? 'warn' : toneOk ? 'ok' : 'warn',
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
    // Standalone resolves synchronously from FIXTURE_CRM (or null → honest empty
    // state); live mode calls the host DB. typeof-guard so the standalone path
    // degrades to null if the fixtures layer is absent. Query runs whenever
    // `email` is truthy in both modes (same dedup key as the email scorecard).
    queryFn: () => {
      if (standalone) {
        const map = typeof FIXTURE_CRM !== 'undefined' ? FIXTURE_CRM : {};
        return Promise.resolve(map[email?.toLowerCase()] ?? null);
      }
      return fetchReplyIntelligence(email);
    },
    enabled: !!email,
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
        <span class="ob-chip seq" style=${{ marginLeft: 'auto' }}>CRM · Twenty</span>
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
  const [editOpen, setEditOpen] = useState(false);
  const [commitError, setCommitError] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['email', 'queue'],
    queryFn: fetchEmailQueue,
    enabled: !standalone,
    placeholderData: FIXTURE_EMAIL_QUEUE,
  });

  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['email'] }); qc.invalidateQueries({ queryKey: ['counts'] }); };
  const commitMut = useMutation({
    mutationFn: ({ id }) => approveDraft(id),
    onSuccess: () => { setCommitError(null); invalidate(); },
    onError: (e) => { const m = String(e?.message ?? e); console.error('[outbound] commit refused:', m); setCommitError(m); },
  });
  const undo = useUndoCommit((id) => { setCommitError(null); commitMut.mutate({ id }); });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }) => rejectDraft(id, reason),
    onSuccess: () => { setRejectOpen(false); invalidate(); },
  });
  const retryMut = useMutation({
    mutationFn: ({ id }) => retryDraft(id),
    onSuccess: invalidate,
  });
  const editMut = useMutation({
    mutationFn: ({ id, patch }) => updateDraft(id, patch),
    onSuccess: () => { setEditOpen(false); invalidate(); },
  });

  // Resolved selection (must be computed pre-return so the crm hook can key on it,
  // without violating rules-of-hooks). selected wins; else first queue row.
  const rowsAll = data ?? [];
  const selResolved = selected ?? rowsAll[0] ?? null;
  // Sibling CRM query for the 5-cell email quality scorecard's THREAD/PERSONALIZATION
  // signals. Same queryKey as ReplyIntelligence → request is deduplicated. Standalone
  // resolves synchronously from the email fixture map; live calls the host DB.
  const { data: crm } = useQuery({
    queryKey: ['email', 'ri', selResolved?.recipient_email],
    queryFn: () => {
      const email = selResolved?.recipient_email;
      if (standalone) {
        // FIXTURE_CRM is supplied by the fixtures layer; typeof-guard so the
        // standalone path degrades to null (→ honest empty cells) if it's absent.
        const map = typeof FIXTURE_CRM !== 'undefined' ? FIXTURE_CRM : {};
        return Promise.resolve(map[email?.toLowerCase()] ?? null);
      }
      return fetchReplyIntelligence(email);
    },
    enabled: !!selResolved?.recipient_email,
    placeholderData: null,
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading email queue…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load email queue" onRetry=${refetch} />`;
  if (!data?.length) return html`<${StateDisplay} state="empty" message="No email items awaiting approval" />`;

  const rows = data ?? [];
  const sel = selected ?? rows[0];
  const isFailed = sel?.raw_status === 'failed';
  const canApprove = isApprovable(sel);
  const armedRow = undo.armed ? rows.find((r) => r.id === undo.armed) : null;
  const emailCells = sel ? emailQualityCells(sel, crm ?? null) : [];

  const pick = (row) => { setSelected(row); setRejectOpen(false); setEditOpen(false); };

  const sendToChat = () => {
    if (!sel) return;
    hostSendToActiveSession(
      `Help me edit this outbound email reply before I approve it.\n\nSubject: ${sel.subject}\nTo: ${sel.recipient_name || sel.recipient_email || 'segment'}\nDrafted by: ${sel.drafted_by ?? 'agent'}`,
    ).catch(() => {});
  };

  return html`
    <${FloatingUndoBar} armed=${undo.armed} secondsLeft=${undo.secondsLeft} onCancel=${undo.cancel} subject=${armedRow?.subject ?? sel?.subject} />
    <div class="nl-split">
      <div class="nl-master">
        ${(() => {
          // Grouped master list: REPLIES → MANUAL → SEQUENCE STEP (design email §B).
          // Empty groups are omitted entirely (no empty header). Agent rows surface
          // under their inferred emailGroup; never hard-code a fixed group count.
          const groups = [
            { key: 'reply', label: 'REPLIES' },
            { key: 'manual', label: 'MANUAL' },
            { key: 'sequence', label: 'SEQUENCE STEP' },
          ];
          // Any rows whose emailGroup is missing/unknown fall into MANUAL so they
          // are never silently dropped from the list.
          const known = new Set(groups.map((g) => g.key));
          const bucket = (r) => (known.has(r.emailGroup) ? r.emailGroup : 'manual');
          return groups.map(({ key, label }) => {
            const group = rows.filter((r) => bucket(r) === key);
            if (!group.length) return null;
            return html`
              <div class="nl-master-group-head" key=${'gh-' + key}>
                ${label} · ${group.length}
              </div>
              ${group.map((row) => {
                const fromLabel = emailFromLabel(row);
                const timeLabel = relDays(row.scheduled_for, { compact: true });
                const snip = row.body
                  ? `"${row.body.replace(/\s+/g, ' ').trim().slice(0, 80).trimEnd()}…"`
                  : null;
                return html`
                  <div
                    key=${row.id}
                    class=${cn('nl-row', { 'is-on': sel?.id === row.id })}
                    onClick=${() => pick(row)}
                  >
                    <div class="em-row-line1">
                      <span class="em-row-from">${fromLabel}</span>
                      ${timeLabel && timeLabel !== '—'
                        ? html`<span class="em-row-time">${timeLabel}</span>`
                        : null}
                    </div>
                    <div class="nl-row-subj">${row.subject}</div>
                    ${snip ? html`<div class="em-row-snip">${snip}</div>` : null}
                    <div class="em-row-foot">
                      <${ChannelChip} channel=${row.channel} />
                      ${row.is_overdue ? html`<${OverdueChip} hoursLate=${row.hours_late} />` : null}
                      ${row.tenant_id ? html`<span class="ob-chip seq">tenant ${row.tenant_id}</span>` : null}
                      ${row.topic_tag ? html`<span class="ob-chip tint">${row.topic_tag}</span>` : null}
                      ${key === 'sequence' && row.sequence_step != null
                        ? html`<span class="ob-chip seq">sequence · step ${row.sequence_step}/${row.sequence_total ?? '?'}</span>`
                        : null}
                      ${key === 'sequence' && row.sequence_id
                        ? html`<span class="ob-chip tint">${row.sequence_id}</span>`
                        : null}
                    </div>
                  </div>
                `;
              })}
            `;
          });
        })()}
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

            ${emailCells.length ? html`
              <div class="nl-quality-grid eq-quality-grid">
                ${emailCells.map((c, i) => html`
                  <div key=${i} class=${cn('nl-quality-cell', c.tone)}>
                    <div class="qlabel">${c.label}</div>
                    <div class="qvalue">${c.value} <span class="qsub">${c.sub}</span></div>
                    <div class="qbar"><div style=${{ width: `${c.pct}%` }}></div></div>
                  </div>
                `)}
              </div>
            ` : null}

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

            ${sel.error_text ? html`
              <div class="ob-chip overdue" style=${{ display: 'inline-flex', margin: '0 1rem' }}>
                Last attempt failed · ${sel.error_text}
              </div>
            ` : null}

            ${editOpen ? html`
              <${EditPanel}
                subject=${sel.subject}
                body=${sel.body}
                pending=${editMut.isPending}
                onCancel=${() => setEditOpen(false)}
                onSave=${(patch) => editMut.mutate({ id: sel.id, patch })}
              />
            ` : null}

            ${rejectOpen ? html`
              <${RejectPanel}
                canned=${EMAIL_REJECT_REASONS}
                pending=${rejectMut.isPending}
                placeholder="Optional · why? (feeds the writer-agent training set)"
                onCancel=${() => setRejectOpen(false)}
                onConfirm=${(reason) => rejectMut.mutate({ id: sel.id, reason })}
              />
            ` : null}

            <${CommitError} message=${commitError} />
            ${canApprove ? html`
              <${ConsequenceLine}
                recipient=${sel.recipient_name || sel.recipient_email}
                channel=${sel.channel}
                scheduled=${sel.scheduled_for}
              />
            ` : null}
            <div class="ob-actions">
              <div class="ob-actions-primary">
                ${isFailed ? html`
                  <button
                    class="btn"
                    style=${{ background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
                    onClick=${() => retryMut.mutate({ id: sel.id })}
                    disabled=${retryMut.isPending}
                  >
                    ${retryMut.isPending ? 'Retrying…' : 'Retry send'}
                  </button>
                ` : canApprove ? html`
                  <button
                    class="btn"
                    style=${{ background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
                    onClick=${() => undo.arm(sel.id)}
                    disabled=${commitMut.isPending || undo.isArmed(sel.id)}
                  >
                    ${commitMut.isPending ? 'Sending…' : undo.isArmed(sel.id) ? 'Sending…' : 'Approve & schedule'}
                  </button>
                ` : html`
                  <${StatusChip} rawStatus=${sel.raw_status} />
                `}
                <button class="btn btn-ghost" onClick=${() => setEditOpen((o) => !o)}>
                  Edit
                </button>
                <button class="btn btn-ghost is-danger" onClick=${() => setRejectOpen((o) => !o)}>
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
  const [commitError, setCommitError] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['newsletter', 'queue'],
    queryFn: fetchNewsletterQueue,
    enabled: !standalone,
    placeholderData: FIXTURE_NL_QUEUE,
  });

  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['newsletter'] }); qc.invalidateQueries({ queryKey: ['counts'] }); };
  const commitMut = useMutation({
    mutationFn: ({ id }) => approveDraft(id),
    onSuccess: () => { setCommitError(null); invalidate(); },
    onError: (e) => { const m = String(e?.message ?? e); console.error('[outbound] commit refused:', m); setCommitError(m); },
  });
  const undo = useUndoCommit((id) => { setCommitError(null); commitMut.mutate({ id }); });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }) => rejectDraft(id, reason),
    onSuccess: () => { setRejectOpen(false); invalidate(); },
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
  const canApprove = isApprovable(sel) && !isCooling;
  const armedRow = undo.armed ? rows.find((r) => r.id === undo.armed) : null;
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
    <${FloatingUndoBar} armed=${undo.armed} secondsLeft=${undo.secondsLeft} onCancel=${undo.cancel} subject=${armedRow?.subject ?? sel?.subject} label="Scheduling" />
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

            <${CommitError} message=${commitError} />
            ${canApprove ? html`
              <${ConsequenceLine}
                recipient=${sel.recipient_count ? `${sel.recipient_count.toLocaleString()} recipients` : 'segment'}
                channel=${sel.delivery_system ?? 'listmonk'}
                scheduled=${sel.scheduled_for}
              />
            ` : null}
            <div class="ob-actions">
              <div class="ob-actions-primary">
                ${sel.raw_status === 'failed' ? html`
                  <button
                    class="btn"
                    style=${{ background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
                    disabled=${commitMut.isPending}
                    onClick=${() => undo.arm(sel.id)}
                  >Retry send</button>
                ` : isApprovable(sel) ? html`
                  <button
                    class="btn"
                    disabled=${isCooling || commitMut.isPending || undo.isArmed(sel.id)}
                    style=${isCooling ? { opacity: 0.5, cursor: 'not-allowed' } : { background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
                    onClick=${() => !isCooling && undo.arm(sel.id)}
                    title=${isCooling ? `Cooling — send blocked for ${sel.cooling_until}` : 'Approve & Schedule'}
                  >
                    ${commitMut.isPending || undo.isArmed(sel.id) ? 'Scheduling…' : isCooling ? `Cooling ${sel.cooling_until}` : 'Approve & Schedule'}
                  </button>
                ` : html`
                  <${StatusChip} rawStatus=${sel.raw_status} />
                `}
                <button class="btn btn-ghost is-danger" onClick=${() => setRejectOpen((o) => !o)}>
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
  // Scheduled newsletter sends — single source: pa_action_drafts rows whose
  // derived content type is 'newsletter' and that carry a future scheduled_at.
  const { data } = useQuery({
    queryKey: ['newsletter', 'schedule'],
    queryFn: async () => {
      const scheduled = (await loadDrafts(SCHEDULE_STATUSES)).filter(hasSchedule);
      const nl = [];
      for (const r of scheduled) {
        const { item } = parseDraft(r);
        if (deriveContentType(item) !== 'newsletter') continue;
        nl.push({
          id: r.id,
          subject: item.subject ?? '(no subject)',
          edition: null,
          status: r.status,
          cooling_until: null,
          recipient_count: item.recipients ?? null,
          scheduled_for: r.scheduled_at,
          kind: 'scheduled',
        });
      }
      if (nl.length) return nl;
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
  const [commitError, setCommitError] = useState(null);
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['sequences'] }); qc.invalidateQueries({ queryKey: ['counts'] }); };
  const commitMut = useMutation({
    mutationFn: ({ id }) => approveDraft(id),
    onSuccess: () => { setCommitError(null); invalidate(); },
    onError: (e) => { const m = String(e?.message ?? e); console.error('[outbound] commit refused:', m); setCommitError(m); },
  });
  const undo = useUndoCommit((id) => { setCommitError(null); commitMut.mutate({ id }); });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }) => rejectDraft(id, reason),
    onSuccess: () => { setRejectOpen(false); invalidate(); },
  });
  const canApprove = isApprovable(sequence);
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
          <${FloatingUndoBar} armed=${undo.armed} secondsLeft=${undo.secondsLeft} onCancel=${undo.cancel} subject=${sequence?.name ?? sequence?.slug} label="Activating" />
          <${CommitError} message=${commitError} />
          ${canApprove ? html`
            <${ConsequenceLine}
              recipient=${sequence?.segment || 'enrolled recipients'}
              channel=${sequence?.delivery_system}
              scheduled="now"
            />
          ` : null}
          <div class="sq-footer">
            <span class="ob-chip seq">enrol on approve</span>
            <span class="ob-chip seq">step 1 fires immediately</span>
            <div class="actions">
              <button class="ob-btn-sm is-danger" onClick=${() => setRejectOpen((o) => !o)}>Reject</button>
              <button class="ob-btn-sm">⌘ Send to chat</button>
              ${sequence?.raw_status === 'failed' ? html`
                <button
                  class="btn"
                  style=${{ background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
                  disabled=${commitMut.isPending}
                  onClick=${() => undo.arm(sequence.id)}
                >Retry send</button>
              ` : canApprove ? html`
                <button
                  class="btn"
                  style=${{ background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
                  disabled=${commitMut.isPending || undo.isArmed(sequence.id)}
                  onClick=${() => undo.arm(sequence.id)}
                >${commitMut.isPending || undo.isArmed(sequence.id) ? 'Activating…' : 'Approve & activate'}</button>
              ` : html`
                <${StatusChip} rawStatus=${sequence?.raw_status} />
              `}
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

// MediaCard — the OG image card (1200×627) when media_url is present, else a
// tasteful "no media" empty slot with a URL-attach affordance. Writes via the
// parent-provided onUpdate (→ updateDraft → edited_json). No upload (Phase 2).
function MediaCard({ mediaUrl, onUpdate }) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const hasMedia = Boolean(mediaUrl);
  return html`
    <div class="ob-social-media">
      <div class="ob-social-media-label">Media</div>
      ${hasMedia ? html`
        <div class="ob-social-media-card">
          <img src=${mediaUrl} alt="Post media" class="ob-social-media-img" />
          <button class="ob-social-media-remove" title="Remove media" aria-label="Remove media" onClick=${() => onUpdate(null)}>×</button>
        </div>
      ` : html`
        <div class="ob-social-media-empty" role="button" tabindex="0"
             onClick=${() => setAttachOpen((o) => !o)}
             onKeyDown=${(e) => { if (e.key === 'Enter') setAttachOpen((o) => !o); }}>
          <span class="ob-social-media-empty-icon" aria-hidden="true">▱</span>
          <span>No media · attach URL</span>
        </div>
      `}
      ${attachOpen ? html`
        <div class="ob-social-media-attach">
          <input class="ob-social-media-url-input" type="url"
            placeholder="https://cdn.example.com/image.jpg (1200×627)"
            value=${urlDraft} onInput=${(e) => setUrlDraft(e.target.value)} />
          <button class="ob-btn-sm is-primary" disabled=${!urlDraft}
            onClick=${() => { onUpdate(urlDraft); setAttachOpen(false); setUrlDraft(''); }}>Attach</button>
          <button class="ob-btn-sm" onClick=${() => setAttachOpen(false)}>Cancel</button>
        </div>
      ` : null}
    </div>
  `;
}

// HashtagEditor — parsed/explicit hashtags as removable pill chips + a "+ add"
// inline input. Local state lifts to the parent (onChange) for live preview, and
// every add/remove writes through onUpdate (→ updateDraft → edited_json).
function HashtagEditor({ hashtags, onChange, onUpdate }) {
  const [inputVal, setInputVal] = useState('');
  const [inputOpen, setInputOpen] = useState(false);
  const inputRef = useRef(null);
  const tags = hashtags || [];

  function removeTag(tag) {
    const next = tags.filter((t) => t !== tag);
    onChange(next);
    onUpdate(next);
  }
  function addTag() {
    const raw = inputVal.trim();
    if (!raw) { setInputOpen(false); return; }
    const tag = raw.startsWith('#') ? raw : '#' + raw;
    if (tags.includes(tag)) { setInputVal(''); setInputOpen(false); return; }
    const next = [...tags, tag];
    onChange(next);
    onUpdate(next);
    setInputVal('');
    setInputOpen(false);
  }
  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
    if (e.key === 'Escape') { setInputVal(''); setInputOpen(false); }
  }

  return html`
    <div class="ob-hashtags">
      <div class="ob-hashtags-label">Hashtags</div>
      <div class="ob-hashtags-chips">
        ${tags.map((tag) => html`
          <span key=${tag} class="ob-tag-chip">
            ${tag}
            <button class="ob-tag-chip-remove" aria-label=${'Remove ' + tag} onClick=${() => removeTag(tag)}>×</button>
          </span>
        `)}
        ${inputOpen ? html`
          <input ref=${inputRef} class="ob-tag-chip-input" type="text" placeholder="#tag"
            value=${inputVal} onInput=${(e) => setInputVal(e.target.value)}
            onKeyDown=${handleKeyDown} onBlur=${addTag} autoFocus />
        ` : html`
          <button class="ob-tag-chip ob-tag-chip-add" onClick=${() => setInputOpen(true)}>+ add</button>
        `}
      </div>
    </div>
  `;
}

// Per-platform preview editor (design social §B): base body on the left, stacked
// LinkedIn / X / Bluesky previews on the right with per-platform char caps; fan-out
// rows + reject below. Body is editable locally; media + hashtags write back to
// edited_json via updateDraft (the per-platform base body stays preview-only).
function SocialEditor({ post, standalone, onApprove, approvePending, onReject, rejectPending, onRetry, rawStatus, commitError, armed, undoSecondsLeft, onCancelUndo }) {
  const canApprove = isApprovable({ raw_status: rawStatus });
  const [body, setBody] = useState(post?.content ?? '');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [localHashtags, setLocalHashtags] = useState(post?.hashtags ?? []);
  const [mediaUpdatePending, setMediaUpdatePending] = useState(false);
  const [hashtagUpdatePending, setHashtagUpdatePending] = useState(false);

  // Reset local state when the selected post changes.
  useEffect(() => {
    setBody(post?.content ?? '');
    setLocalHashtags(post?.hashtags ?? []);
    setRejectOpen(false);
  }, [post?.id]);

  // Write media_url / hashtags through edited_json (host.paActions.update).
  // In standalone (fixture) mode there is no host write path — keep it a no-op
  // so the chip editor stays interactive without throwing.
  async function handleMediaUpdate(newUrl) {
    if (standalone || !post?.id) return;
    setMediaUpdatePending(true);
    try { await updateDraft(post.id, { media_url: newUrl }); }
    catch (e) { console.error('[outbound] media update failed:', String(e?.message ?? e)); }
    finally { setMediaUpdatePending(false); }
  }
  async function handleHashtagUpdate(tags) {
    if (standalone || !post?.id) return;
    setHashtagUpdatePending(true);
    try { await updateDraft(post.id, { hashtags: tags }); }
    catch (e) { console.error('[outbound] hashtag update failed:', String(e?.message ?? e)); }
    finally { setHashtagUpdatePending(false); }
  }

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
          <${MediaCard} mediaUrl=${post?.media_url} onUpdate=${handleMediaUpdate} />
          <${HashtagEditor} hashtags=${localHashtags} onChange=${setLocalHashtags} onUpdate=${handleHashtagUpdate} />
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
                  <div class="pv-body">${body}${localHashtags.length ? html`<span class="pv-tags"> ${localHashtags.join(' ')}</span>` : null}</div>
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

      <${CommitError} message=${commitError} />
      ${canApprove ? html`
        <${ConsequenceLine}
          recipient=${post?.account || 'social accounts'}
          channel=${'LinkedIn · X · Bluesky'}
          scheduled=${post?.scheduled_for}
        />
      ` : null}
      <div class="ob-actions">
        <div class="ob-actions-primary">
          ${rawStatus === 'failed' ? html`
            <button
              class="btn"
              style=${{ background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
              disabled=${approvePending}
              onClick=${() => onRetry()}
            >Retry send</button>
          ` : canApprove ? html`
            <button
              class="btn"
              style=${anyBlocked ? { opacity: 0.55, cursor: 'not-allowed' } : { background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
              disabled=${anyBlocked || approvePending}
              title=${anyBlocked ? 'Resolve over-cap platforms first' : 'Approve & schedule'}
              onClick=${() => !anyBlocked && onApprove()}
            >
              ${approvePending ? 'Scheduling…' : 'Approve & Schedule'}
            </button>
          ` : html`
            <${StatusChip} rawStatus=${rawStatus} />
          `}
          <button class="btn btn-ghost is-danger" onClick=${() => setRejectOpen((o) => !o)}>Reject…</button>
        </div>
      </div>
      <${FloatingUndoBar} armed=${armed} secondsLeft=${undoSecondsLeft} onCancel=${onCancelUndo} subject=${post?.title ?? post?.content} label="Scheduling" />
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
  const [commitError, setCommitError] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['social', 'queue'],
    queryFn: fetchSocialQueue,
    enabled: !standalone,
    placeholderData: FIXTURE_SOCIAL_QUEUE,
  });

  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['social'] }); qc.invalidateQueries({ queryKey: ['counts'] }); };
  const commitMut = useMutation({
    mutationFn: ({ id }) => approveDraft(id),
    onSuccess: () => { setCommitError(null); invalidate(); },
    onError: (e) => { const m = String(e?.message ?? e); console.error('[outbound] commit refused:', m); setCommitError(m); },
  });
  const undo = useUndoCommit((id) => { setCommitError(null); commitMut.mutate({ id }); });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }) => rejectDraft(id, reason),
    onSuccess: invalidate,
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading social queue…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load social queue" onRetry=${refetch} />`;
  if (!data?.length) return html`<${StateDisplay} state="empty" message="No social posts awaiting approval" />`;

  const rows = data ?? [];

  // Collapse fan-out siblings (same batch_id / slug) into one display row carrying
  // a platforms[] array. Rows with no slug are singletons. The first sibling is the
  // representative (_batchRows[0]) handed to the detail editor.
  const batchMap = new Map();
  const displayRows = [];
  for (const row of rows) {
    if (row.slug) {
      if (batchMap.has(row.slug)) {
        batchMap.get(row.slug).platforms.push(row.platform);
      } else {
        const dr = { ...row, platforms: [row.platform], _batchRows: [row] };
        batchMap.set(row.slug, dr);
        displayRows.push(dr);
      }
    } else {
      displayRows.push({ ...row, platforms: [row.platform], _batchRows: [row] });
    }
  }
  // Sort platform badge order within each display row: li → x → bs → ig → fb.
  for (const dr of displayRows) {
    dr.platforms.sort((a, b) => {
      const ai = SOCIAL_PLAT_ORDER.indexOf(a);
      const bi = SOCIAL_PLAT_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }
  // Group into fixed-order sections (omit empties).
  const groupedRows = SOCIAL_GROUP_ORDER.map((key) => ({
    key,
    label: SOURCE_GROUP_LABEL[key],
    rows: displayRows.filter((r) => (r.source_group ?? 'manual') === key),
  })).filter((g) => g.rows.length > 0);

  // Selection: `sel` is a REAL mapSocialQueue row (the representative), not the
  // synthetic display row. Default to the first display row's representative.
  const sel = selected ?? displayRows[0]?._batchRows[0];
  const isArmed = sel ? undo.isArmed(sel.id) : false;
  const armedRow = undo.armed ? rows.find((r) => r.id === undo.armed) : null;

  return html`
    <${FloatingUndoBar} armed=${undo.armed} secondsLeft=${undo.secondsLeft} onCancel=${undo.cancel} subject=${armedRow?.title ?? armedRow?.content ?? sel?.title} label="Scheduling" />
    <div class="nl-split">
      <div class="nl-master">
        ${groupedRows.map((group) => html`
          <div key=${group.key}>
            <div class="nl-master-group-head">${group.label} · ${group.rows.length}</div>
            ${group.rows.map((row) => {
              const isOn = sel?.id === row.id;
              const platformCount = row.platforms.length;
              const blogSlugChip = row.blog_slug
                ? html`<span class="ob-chip">blog · /${row.blog_slug}</span>`
                : (row.source_group === 'blog' ? html`<span class="ob-chip">blog</span>` : null);
              const platformsChip = platformCount >= 2
                ? html`<span class="ob-chip chip-tint">${platformCount} platform${platformCount > 2 ? 's' : ''}</span>`
                : null;
              const agentChip = row.drafted_by && row.drafted_by !== 'pa'
                ? html`<span class="ob-chip">cmo-agent · ${row.drafted_by}</span>`
                : null;
              const threadChip = row.thread_index != null && row.thread_total != null
                ? html`<span class="ob-chip">thread · ${row.thread_index} of ${row.thread_total}</span>`
                : null;
              const toneChip = row.tone_check
                ? html`<span class="ob-chip ob-chip-warn">tone check</span>`
                : null;
              return html`
                <div key=${row.id} class=${cn('so-q-row nl-row', { 'is-on': isOn })} onClick=${() => setSelected(row._batchRows[0])}>
                  <div class="so-q-row-head">
                    ${row.platforms.map((p) => html`<${PlatPill} key=${p} platform=${p} />`)}
                    <span class="so-q-row-time">${relativeTime(row.scheduled_for)}</span>
                  </div>
                  <div class="so-q-row-text">"${(row.content ?? '').substring(0, 100)}${(row.content?.length ?? 0) > 100 ? '…' : ''}"</div>
                  <div class="so-q-row-foot">
                    ${blogSlugChip}
                    ${platformsChip}
                    ${agentChip}
                    ${threadChip}
                    ${toneChip}
                  </div>
                </div>
              `;
            })}
          </div>
        `)}
      </div>
      <div class="nl-detail">
        ${sel ? html`
          <${SocialEditor}
            post=${sel}
            standalone=${standalone}
            onApprove=${() => undo.arm(sel.id)}
            approvePending=${commitMut.isPending || isArmed}
            onReject=${(reason) => rejectMut.mutate({ id: sel.id, reason })}
            rejectPending=${rejectMut.isPending}
            onRetry=${() => undo.arm(sel.id)}
            rawStatus=${sel.raw_status}
            commitError=${commitError}
            armed=${isArmed}
            undoSecondsLeft=${undo.secondsLeft}
            onCancelUndo=${undo.cancel}
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

// ─── Cross-channel Approvals view (the folded approve-gate, WP-07) ──────────────
// Mirrors the shell approve-gate: every awaiting/edited/committed/failed row
// ACROSS ALL channels, each tagged with its derived content type, with the same
// approve/reject/retry/edit + 10s undo actions. Single source: pa_action_drafts.

const CT_LABEL = { email: 'Email', newsletter: 'Newsletter', social: 'Social', sequences: 'Sequence' };

// One row → a unified approval-row view-model (channel-agnostic).
function mapApprovalRow(row) {
  const { item, meta, edited } = parseDraft(row);
  const ct = deriveContentType(item);
  return {
    id: row.id,
    ct,
    ct_label: CT_LABEL[ct] ?? ct,
    status: row.status, // raw lifecycle status (awaiting/edited/committed/sending/failed)
    raw_status: row.status, // alias matching the per-channel mappers (C-2 gate)
    channel: row.channel ?? item.channel ?? null, // provider
    subject: edited.subject ?? item.subject ?? '(no subject)',
    body: edited.body ?? item.body ?? '',
    recipient: item.recipient ?? item.recipientEmail ?? null,
    drafted_by: String(meta.agent || 'pa').toLowerCase(),
    scheduled_for: item.scheduledLabel || row.scheduled_at || null,
    error_text: row.error_text || null,
    attempts: row.attempts ?? 0,
    batch_id: row.batch_id || null,
  };
}

// All in-flight approval rows across every channel (newest first).
async function fetchAllApprovals() {
  const rows = await loadDrafts(QUEUE_STATUSES);
  return (rows || []).map(mapApprovalRow);
}

const APPROVAL_REJECT_REASONS = ['Wrong recipient', 'Tone is off', 'Misses context', 'Already handled', "Don't send · close out"];

function CrossChannelApprovalsView({ standalone }) {
  const [selected, setSelected] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [commitError, setCommitError] = useState(null);
  const [ctFilter, setCtFilter] = useState('all'); // all | email | newsletter | social | sequences

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['approvals', 'all'],
    queryFn: fetchAllApprovals,
    enabled: !standalone,
    refetchInterval: 30_000,
    placeholderData: [],
  });

  const qc = useQueryClient();
  // Invalidate EVERY channel + counts so any view downstream repaints.
  const invalidate = () => {
    for (const k of ['approvals', 'email', 'newsletter', 'sequences', 'social', 'counts']) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
  const commitMut = useMutation({
    mutationFn: ({ id }) => approveDraft(id),
    onSuccess: () => { setCommitError(null); invalidate(); },
    onError: (e) => { const m = String(e?.message ?? e); console.error('[outbound] commit refused:', m); setCommitError(m); },
  });
  const undo = useUndoCommit((id) => { setCommitError(null); commitMut.mutate({ id }); });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }) => rejectDraft(id, reason),
    onSuccess: () => { setRejectOpen(false); invalidate(); },
  });
  const retryMut = useMutation({ mutationFn: ({ id }) => retryDraft(id), onSuccess: invalidate });
  const editMut = useMutation({
    mutationFn: ({ id, patch }) => updateDraft(id, patch),
    onSuccess: () => { setEditOpen(false); invalidate(); },
  });

  if (isLoading) return html`<${StateDisplay} state="loading" message="Loading approvals…" />`;
  if (isError) return html`<${StateDisplay} state="error" message="Couldn't load approvals" onRetry=${refetch} />`;

  const all = data ?? [];
  const rows = ctFilter === 'all' ? all : all.filter((r) => r.ct === ctFilter);
  if (!all.length) return html`<${StateDisplay} state="empty" message="Nothing awaiting approval across any channel" />`;

  const sel = (selected && rows.find((r) => r.id === selected.id)) ?? rows[0] ?? null;
  const isFailed = sel?.raw_status === 'failed';
  const canApprove = isApprovable(sel);
  const armedRow = undo.armed ? all.find((r) => r.id === undo.armed) : null;
  const pick = (row) => { setSelected(row); setRejectOpen(false); setEditOpen(false); };

  // Per-content-type counts for the filter strip.
  const ctCounts = all.reduce((acc, r) => { acc[r.ct] = (acc[r.ct] ?? 0) + 1; return acc; }, {});

  const sendToChat = () => {
    if (!sel) return;
    hostSendToActiveSession(
      `Help me review this outbound ${sel.ct_label} before I approve it.\n\nSubject: ${sel.subject}\nTo: ${sel.recipient ?? 'segment'}\nDrafted by: ${sel.drafted_by ?? 'agent'}`,
    ).catch(() => {});
  };

  return html`
    <${FloatingUndoBar} armed=${undo.armed} secondsLeft=${undo.secondsLeft} onCancel=${undo.cancel} subject=${armedRow?.subject ?? sel?.subject} />
    <div style=${{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div class="nl-sent-toolbar">
        <button class=${cn('ob-filter-chip', { 'is-on': ctFilter === 'all' })} onClick=${() => setCtFilter('all')}>All · ${all.length}</button>
        ${CHANNELS.map((ct) => html`
          <button
            key=${ct}
            class=${cn('ob-filter-chip', { 'is-on': ctFilter === ct })}
            onClick=${() => setCtFilter(ct)}
          >${CT_LABEL[ct]}${ctCounts[ct] ? ` · ${ctCounts[ct]}` : ''}</button>
        `)}
      </div>
      <div class="nl-split" style=${{ flex: 1, minHeight: 0 }}>
        <div class="nl-master">
          ${rows.length ? rows.map(row => html`
            <div
              key=${row.id}
              class=${cn('nl-row', { 'is-on': sel?.id === row.id })}
              onClick=${() => pick(row)}
            >
              <div class="nl-row-head">
                <span class="ob-chip seq">${row.ct_label}</span>
                ${row.channel ? html`<${ChannelChip} channel=${row.channel} />` : null}
                ${row.status === 'failed' ? html`<span class="ob-chip overdue">failed</span>` : null}
              </div>
              <div class="nl-row-subj">${row.subject}</div>
              <div class="nl-row-pre">${row.recipient || '—'} · ${row.drafted_by}</div>
            </div>
          `) : html`<${StateDisplay} state="empty" message="No items for this filter" />`}
        </div>
        <div class="nl-detail">
          ${sel ? html`
            <div class="ob-detail-wrap">
              <div class="ip-head">
                <div class="ip-meta-row">
                  <span class="ob-chip seq">${sel.ct_label}</span>
                  ${sel.channel ? html`<${ChannelChip} channel=${sel.channel} />` : null}
                  <span style=${{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>${sel.recipient || '—'}</span>
                </div>
                <h2 style=${{ fontSize: '0.9rem', fontWeight: 600, margin: '0.5rem 0 0', color: 'var(--fg)' }}>${sel.subject}</h2>
              </div>

              <div class="ip-body" style=${{ flex: 1, padding: '1rem', color: 'var(--fg-muted)', fontSize: '0.8125rem' }}>
                ${sel.body ? html`
                  <p style=${{ margin: 0, color: 'var(--fg)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>${sel.body}</p>
                ` : html`<p style=${{ margin: 0 }}>(no body)</p>`}
                <p style=${{ marginTop: '1rem', color: 'var(--fg-muted)' }}>
                  Drafted by <strong style=${{ color: 'var(--fg)' }}>${sel.drafted_by ?? 'agent'}</strong>
                  ${sel.scheduled_for ? html` · scheduled <strong style=${{ color: 'var(--fg)' }}>${sel.scheduled_for}</strong>` : ''}
                </p>
              </div>

              ${sel.error_text ? html`
                <div class="ob-chip overdue" style=${{ display: 'inline-flex', margin: '0 1rem' }}>
                  Last attempt failed · ${sel.error_text}
                </div>
              ` : null}

              ${editOpen ? html`
                <${EditPanel}
                  subject=${sel.subject}
                  body=${sel.body}
                  pending=${editMut.isPending}
                  onCancel=${() => setEditOpen(false)}
                  onSave=${(patch) => editMut.mutate({ id: sel.id, patch })}
                />
              ` : null}

              ${rejectOpen ? html`
                <${RejectPanel}
                  canned=${APPROVAL_REJECT_REASONS}
                  pending=${rejectMut.isPending}
                  placeholder="Optional · why? (feeds the writer-agent training set)"
                  onCancel=${() => setRejectOpen(false)}
                  onConfirm=${(reason) => rejectMut.mutate({ id: sel.id, reason })}
                />
              ` : null}

              <${CommitError} message=${commitError} />
              ${canApprove ? html`
                <${ConsequenceLine}
                  recipient=${sel.recipient}
                  channel=${sel.channel ?? sel.ct_label}
                  scheduled=${sel.scheduled_for}
                />
              ` : null}
              <div class="ob-actions">
                <div class="ob-actions-primary">
                  ${isFailed ? html`
                    <button
                      class="btn"
                      style=${{ background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
                      onClick=${() => retryMut.mutate({ id: sel.id })}
                      disabled=${retryMut.isPending}
                    >${retryMut.isPending ? 'Retrying…' : 'Retry send'}</button>
                  ` : canApprove ? html`
                    <button
                      class="btn"
                      style=${{ background: 'var(--tint-outbox-bg, var(--bg-alt))', color: 'var(--tint-outbox-fg, var(--fg))' }}
                      onClick=${() => undo.arm(sel.id)}
                      disabled=${commitMut.isPending || undo.isArmed(sel.id)}
                    >${commitMut.isPending || undo.isArmed(sel.id) ? 'Sending…' : 'Approve & schedule'}</button>
                  ` : html`
                    <${StatusChip} rawStatus=${sel.raw_status} />
                  `}
                  <button class="btn btn-ghost" onClick=${() => setEditOpen((o) => !o)}>Edit</button>
                  <button class="btn btn-ghost is-danger" onClick=${() => setRejectOpen((o) => !o)}>Reject</button>
                </div>
              </div>
              <div class="ob-actions-secondary">
                <button class="ob-btn-sm" onClick=${sendToChat}>⌘ Send to chat</button>
                <span class="ob-act-spacer"></span>
                <span class="ob-act-meta">${sel.status}${sel.attempts ? ` · ${sel.attempts} attempt${sel.attempts === 1 ? '' : 's'}` : ''}</span>
              </div>
            </div>
          ` : html`<${StateDisplay} state="empty" message="Select an item to review" />`}
        </div>
      </div>
    </div>
  `;
}

// ─── View dispatcher ────────────────────────────────────────────────────────────

function ViewBody({ channel, view, standalone }) {
  // Cross-channel Approvals is a top-level view independent of channel.
  if (view === 'approvals') return html`<${CrossChannelApprovalsView} standalone=${standalone} />`;
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
  // Initialise channel + view from the deep-link target (pre-seeded activeFeature
  // 'v:<view>' OR the mounted sub-route pathname) directly (lazy init) so the
  // first paint already reflects the deep-link / sidebar selection — closes the
  // mount race where the useEffect relay below lands a frame after the initial
  // render (F-01, WP-07).
  const initial = parseInitialTarget(activeFeature);
  const [channel, setChannel] = useState(() => initial?.channel ?? 'newsletter');
  const [view, setView] = useState(() => initial?.view ?? 'queue');
  const standalone = isStandalone();
  const isApprovals = view === 'approvals';

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
    // Sidebar channel clicks → 'ch:<channel>' (Channels group).
    if (activeFeature.startsWith('ch:')) {
      const newChannel = activeFeature.slice(3);
      if (CHANNELS.includes(newChannel)) {
        setChannel(newChannel);
        setView('queue'); // reset to queue on channel switch
      }
      return;
    }
    // Deep-link re-emits → 'v:<view>' ('v:approvals' = cross-channel gate;
    // 'v:<channel>' = that channel's queue).
    if (activeFeature.startsWith('v:')) {
      const target = viewFromToken(activeFeature.slice(2));
      if (target) {
        setChannel(target.channel);
        setView(target.view);
      }
      return;
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
            <${Icon} name=${isApprovals ? 'check-circle' : 'send'} size=${16} />
          </span>
          <span>${isApprovals ? 'Outbox · Approvals' : `Outbox · ${meta.label}`}</span>
        </h1>
        <p class="sub">${isApprovals ? 'Cross-channel approve-gate · every channel' : meta.subtitle}</p>
        <p class="meta">${totalAwaiting} awaiting · ${activeSeqCount} sequences active</p>
      </div>

      <!-- Inner-tab strip: Approvals (cross-channel) + per-channel Approval queue / Schedule / Sent -->
      <div class="nl-inner-tabs">
        <button
          key="approvals"
          class=${cn({ 'is-on': isApprovals })}
          onClick=${() => setView('approvals')}
        >
          Approvals
          ${totalAwaiting + activeSeqCount > 0 ? html`<span class="nl-tab-count">${totalAwaiting + activeSeqCount}</span>` : null}
        </button>
        ${meta.views.map(v => {
          const label = meta.viewLabels[v];
          const cnt = v === 'queue' ? (counts?.[channel] ?? 0) : 0;
          return html`
            <button
              key=${v}
              class=${cn({ 'is-on': !isApprovals && view === v })}
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
