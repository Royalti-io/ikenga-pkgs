// derive.js — the single-source adapter: pa_action_drafts → per-channel view-models.
//
// The outbound pkg reads ONE table — `pa_action_drafts` (the approve-gate +
// mutation-worker seam) — and DERIVES the four content-type surfaces from it.
// `channel` is the PROVIDER (smtp|resend|listmonk|buffer); `payload_json` is
// `{ item: DraftItem, meta: ApproveGateMeta }`; `batch_id` groups a campaign /
// sequence run / social fan-out. These pure functions map a row onto the exact
// field shapes the renderers already consume (see the FIXTURE_* shapes in
// outbound-view.js — that is the contract this module satisfies).
//
// Pure + dependency-free → unit-testable under plain Node (see derive.test.mjs).
// Plan: plans/outbound-pkg/01-plan.md §Schema · G-DERIVE.

export const DRAFT_CHANNELS = ['smtp', 'resend', 'listmonk', 'buffer'];

// Status buckets over pa_action_drafts.status (free-text, code-enforced):
//   awaiting → edited? → committed → sending → sent | failed | rejected
export const QUEUE_STATUSES = ['awaiting', 'edited', 'committed', 'sending', 'failed'];
// Sent = successfully-sent history only. `failed` rows live in the QUEUE (for
// retry, matching the approve-gate model), not in the Sent table.
export const SENT_STATUSES = ['sent'];
export const SCHEDULE_STATUSES = ['committed', 'awaiting', 'edited'];

// ── Content-type derive (G-DERIVE) ───────────────────────────────────────────
// `kind` wins (producer/backfill stamp); else the heuristic chain. The one
// unresolvable case (newsletter vs email via resend/smtp without `kind`) falls
// to 'email' — see 03 §F3.
export function deriveContentType(item) {
  if (!item) return 'email';
  if (item.kind) return item.kind === 'sequence' ? 'sequences' : item.kind;
  if (item.channel === 'buffer') return 'social';
  if (item.sequence != null) return 'sequences';
  if (item.channel === 'listmonk') return 'newsletter';
  return 'email';
}

// ── Row parsing ──────────────────────────────────────────────────────────────
// Tolerant: bad JSON → {}, bare-item payloads (harness rows) accepted, edited_json
// overrides merged. Returns { item, meta, edited }.
export function parseDraft(row) {
  let payload = {};
  try {
    payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json || {};
  } catch {
    payload = {};
  }
  const item = (payload && payload.item) || payload || {};
  const meta = (payload && payload.meta) || {};
  let edited = {};
  if (row.edited_json) {
    try {
      edited = typeof row.edited_json === 'string' ? JSON.parse(row.edited_json) : row.edited_json;
    } catch {
      edited = {};
    }
  }
  return { item: item || {}, meta: meta || {}, edited: edited || {} };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
// SQLite UTC 'YYYY-MM-DD HH:MM:SS' (or ISO) → epoch ms (or NaN).
function toEpoch(s) {
  if (!s) return NaN;
  const str = String(s).trim();
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(str);
  return Date.parse(str.includes('T') ? str : str.replace(' ', 'T') + (hasTz ? '' : 'Z'));
}

function isPast(s) {
  const t = toEpoch(s);
  return Number.isFinite(t) && t < Date.now();
}

function agentOf(meta) {
  const a = String(meta && meta.agent ? meta.agent : 'pa').toLowerCase();
  return a || 'pa';
}

// Buffer DraftItems carry the platform inside `recipient` ("LinkedIn · …").
// Best-effort parse for the social Platform column (fan-out is Phase 2).
function platformOf(item) {
  const r = `${item.recipient || ''} ${item.fromProvider || ''}`.toLowerCase();
  if (r.includes('linkedin') || /\bli\b/.test(r)) return 'linkedin';
  if (r.includes('bluesky') || r.includes('bsky') || /\bbs\b/.test(r)) return 'bluesky';
  if (r.includes('twitter') || /\b[x]\b/.test(r) || r.includes('· x')) return 'twitter';
  return 'linkedin';
}

// pa_action_drafts.status (+ delivery_status + scheduled_at) → the per-channel
// DESIGN status vocab the renderers chip on. Channel-aware only where the design
// diverges (social uses 'posted'; newsletter groups on cooling/pending/approved).
export function designStatus(row, ct) {
  const s = row.status;
  if (s === 'sent') {
    const d = row.delivery_status;
    if (d === 'bounced' || d === 'complained') return d;
    if (ct === 'social') return 'posted';
    return d === 'delivered' ? 'delivered' : 'sent';
  }
  if (s === 'failed') return 'failed';
  if (s === 'rejected') return 'rejected';
  if (s === 'sending') return 'sending';
  if (s === 'committed') return ct === 'social' ? 'approved' : 'approved';
  if (s === 'edited') return ct === 'newsletter' ? 'pending' : 'edited';
  // awaiting
  if (ct !== 'social' && isPast(row.scheduled_at)) return 'overdue';
  return ct === 'newsletter' ? 'pending' : 'pending';
}

// ── Per-view mappers (produce the FIXTURE_* field shapes) ─────────────────────

// Shared queue/sent base for email + newsletter + social.
function baseRow(row) {
  const { item, meta, edited } = parseDraft(row);
  const ct = deriveContentType(item);
  return {
    item,
    meta,
    ct,
    subject: edited.subject ?? item.subject ?? '(no subject)',
    body: edited.body ?? item.body ?? '',
    channel: row.channel ?? item.channel ?? null, // provider
    drafted_by: agentOf(meta),
    scheduled_for: item.scheduledLabel || row.scheduled_at || null,
    sent_at: row.sent_at || null,
    delivery_status: row.delivery_status || null,
    attempts: row.attempts ?? 0,
    error_text: row.error_text || null,
    external_id: row.external_id || null,
  };
}

export function mapEmailQueue(row) {
  const b = baseRow(row);
  return {
    id: row.id,
    subject: b.subject,
    body: b.body,
    recipient_name: b.item.recipient ?? null,
    recipient_email: b.item.recipientEmail ?? null,
    channel: b.channel,
    status: designStatus(row, b.ct),
    ux_mode: 'approve',
    drafted_by: b.drafted_by,
    sequence_id: b.item.sequence ? b.item.sequence.name : null,
    scheduled_for: b.scheduled_for,
    is_overdue: b.ct !== 'social' && isPast(row.scheduled_at) && row.status === 'awaiting' ? 1 : 0,
    src: 'pa', // WP-04 rewires approve/reject through host.paActions* (Strategy B)
    delivery_status: b.delivery_status,
    error_text: b.error_text,
  };
}

export function mapEmailSent(row) {
  const b = baseRow(row);
  return {
    id: row.id,
    subject: b.subject,
    recipient_email: b.item.recipientEmail ?? b.item.recipient ?? null,
    channel: b.channel,
    delivery_system: b.channel,
    status: designStatus(row, b.ct),
    sent_at: b.sent_at,
    delivery_status: b.delivery_status,
    attempts: b.attempts,
    open_rate: null, // engagement metrics are Phase 2 (not on pa_action_drafts)
    click_rate: null,
  };
}

export function mapNewsletterQueue(row) {
  const b = baseRow(row);
  return {
    id: row.id,
    subject: b.subject,
    subject_b: null, // A/B is Phase 2
    draft_slug: b.item.section ?? null,
    edition: null,
    status: designStatus(row, b.ct),
    cooling_until: null, // cooling is Phase 2
    quality_score: null, // scorecard is Phase 2
    recipient_count: b.item.recipients ?? b.item.sequence?.recipients ?? null,
    delivery_system: b.channel,
    drafted_by: b.drafted_by,
    has_ab: 0,
    body: b.body,
  };
}

export function mapNewsletterSent(row) {
  const b = baseRow(row);
  return {
    id: row.id,
    draft_slug: b.item.section ?? null,
    edition: null,
    subject: b.subject,
    delivery_system: b.channel,
    status: designStatus(row, b.ct),
    sent_at: b.sent_at,
    delivery_status: b.delivery_status,
    recipient_count: b.item.recipients ?? null,
    open_rate: null,
    click_rate: null,
  };
}

export function mapSocialQueue(row) {
  const b = baseRow(row);
  return {
    id: row.id,
    platform: platformOf(b.item),
    account: b.item.senderAddress || b.item.fromProvider || 'Buffer',
    content: b.body || b.subject,
    status: designStatus(row, b.ct),
    scheduled_for: b.scheduled_for,
    approved_at: row.committed_at || null,
    source: b.meta.actionName || null,
    slug: row.batch_id || null, // batch_id is the fan-out group key
    title: b.subject,
  };
}

export function mapSocialSent(row) {
  const b = baseRow(row);
  return {
    id: row.id,
    platform: platformOf(b.item),
    account: b.item.senderAddress || b.item.fromProvider || 'Buffer',
    content: b.body || b.subject,
    status: designStatus(row, b.ct),
    scheduled_for: b.scheduled_for,
    posted_at: b.sent_at,
    delivery_status: b.delivery_status,
    source: b.meta.actionName || null,
    slug: row.batch_id || null,
  };
}

// Sequences: a flat list of sequence-step sends, grouped by sequence name.
// The rich cohort grid + funnel (per-recipient state) is Phase 2 — these mappers
// produce the def/queue/sent shapes from the same rows.
export function mapSequenceQueue(row) {
  const b = baseRow(row);
  const seq = b.item.sequence || {};
  return {
    id: row.id,
    name: seq.name || b.subject,
    slug: row.batch_id || null,
    description: b.subject,
    segment: b.item.recipient || null,
    total_steps: seq.total ?? null,
    delivery_system: b.channel,
    status: designStatus(row, b.ct),
    created_by: b.drafted_by,
    created_at: row.created_at || null,
  };
}

export function mapSequenceSent(row) {
  const b = baseRow(row);
  const seq = b.item.sequence || {};
  return {
    id: row.id,
    sequence_name: seq.name || b.subject,
    subject: b.subject,
    step: seq.step ?? null,
    total_steps: seq.total ?? null,
    recipient_email: b.item.recipientEmail ?? b.item.recipient ?? null,
    delivery_system: b.channel,
    status: designStatus(row, b.ct),
    sent_at: b.sent_at,
    delivery_status: b.delivery_status,
  };
}

// ── Batch loader → per-channel/per-view split ─────────────────────────────────
// One pass over a set of rows: parse + derive + map by (contentType, mapper).
export function splitByContentType(rows, mapper) {
  const out = { email: [], newsletter: [], social: [], sequences: [] };
  for (const row of rows || []) {
    const { item } = parseDraft(row);
    const ct = deriveContentType(item);
    (out[ct] = out[ct] || []).push(mapper(row));
  }
  return out;
}

// Queue counts per channel from a set of queue-status rows.
export function countByContentType(rows) {
  const out = { email: 0, newsletter: 0, social: 0, sequences: 0 };
  for (const row of rows || []) {
    const { item } = parseDraft(row);
    out[deriveContentType(item)] += 1;
  }
  return out;
}
