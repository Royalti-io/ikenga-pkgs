// Unit test for the single-source derive + mappers. Run: node tests/derive.test.mjs
// Proves G-DERIVE + the pa_action_drafts → view-model mapping without a shell.
import {
  deriveContentType,
  parseDraft,
  designStatus,
  mapEmailQueue,
  mapEmailSent,
  mapSocialQueue,
  mapNewsletterQueue,
  mapSequenceQueue,
  splitByContentType,
  countByContentType,
} from '../dist/lib/derive.js';

let pass = 0;
let fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}\n   expected: ${e}\n   actual:   ${a}`);
  }
}
function ok(cond, label) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

// Row factory (mirrors pa_action_drafts columns).
function row(over = {}) {
  const item = { id: 'i', recipient: 'X', recipientEmail: 'x@y.z', subject: 'S', body: 'B', channel: 'resend', ...over.item };
  const meta = { actionId: 'com.ikenga.skill-outbound/send', actionName: 'send', agent: 'CMO', model: 'Opus', ...over.meta };
  return {
    id: over.id ?? 'r1',
    batch_id: over.batch_id ?? 'b1',
    action_id: meta.actionId,
    status: over.status ?? 'awaiting',
    channel: over.channel ?? item.channel,
    payload_json: JSON.stringify({ item, meta }),
    edited_json: over.edited_json ?? null,
    scheduled_at: over.scheduled_at ?? null,
    created_at: over.created_at ?? '2026-06-01 10:00:00',
    committed_at: over.committed_at ?? null,
    sent_at: over.sent_at ?? null,
    attempts: over.attempts ?? 0,
    error_text: over.error_text ?? null,
    external_id: over.external_id ?? null,
    delivery_status: over.delivery_status ?? null,
  };
}

// ── G-DERIVE: content-type derive ────────────────────────────────────────────
eq(deriveContentType({ channel: 'buffer' }), 'social', 'buffer → social');
eq(deriveContentType({ channel: 'resend', sequence: { name: 'L5', step: 1, total: 3 } }), 'sequences', 'sequence → sequences');
eq(deriveContentType({ channel: 'listmonk' }), 'newsletter', 'listmonk → newsletter');
eq(deriveContentType({ channel: 'resend' }), 'email', 'resend → email');
eq(deriveContentType({ channel: 'smtp' }), 'email', 'smtp → email');
eq(deriveContentType({ channel: 'resend', kind: 'newsletter' }), 'newsletter', 'kind override beats heuristic');
eq(deriveContentType({ channel: 'smtp', kind: 'sequence' }), 'sequences', 'kind:sequence → sequences');
eq(deriveContentType(null), 'email', 'null item → email (safe default)');

// ── parseDraft tolerance ─────────────────────────────────────────────────────
eq(parseDraft({ payload_json: 'not json' }).item, {}, 'bad JSON → empty item');
eq(parseDraft({ payload_json: JSON.stringify({ subject: 'bare' }) }).item.subject, 'bare', 'bare item payload accepted');
{
  const p = parseDraft({ payload_json: JSON.stringify({ item: { subject: 'orig', body: 'b' } }), edited_json: JSON.stringify({ subject: 'edited' }) });
  eq(p.edited.subject, 'edited', 'edited_json parsed');
}

// ── designStatus mapping ─────────────────────────────────────────────────────
eq(designStatus(row({ status: 'sent', delivery_status: 'delivered' }), 'email'), 'delivered', 'sent+delivered → delivered');
eq(designStatus(row({ status: 'sent', delivery_status: 'bounced' }), 'email'), 'bounced', 'sent+bounced → bounced');
eq(designStatus(row({ status: 'sent' }), 'social'), 'posted', 'social sent → posted');
eq(designStatus(row({ status: 'failed' }), 'email'), 'failed', 'failed → failed');
eq(designStatus(row({ status: 'committed' }), 'email'), 'approved', 'committed → approved');
eq(designStatus(row({ status: 'awaiting', scheduled_at: '2020-01-01 00:00:00' }), 'email'), 'overdue', 'awaiting+past schedule → overdue');
eq(designStatus(row({ status: 'awaiting' }), 'email'), 'pending', 'awaiting → pending');

// ── mappers produce the renderer field contract ──────────────────────────────
{
  const m = mapEmailQueue(row({ status: 'awaiting', scheduled_at: '2020-01-01 00:00:00', item: { recipient: 'Val', recipientEmail: 'v@a.b', subject: 'Hi', channel: 'smtp' }, channel: 'smtp' }));
  eq(m.is_overdue, 1, 'email queue: overdue flag set');
  eq(m.recipient_name, 'Val', 'email queue: recipient_name');
  eq(m.channel, 'smtp', 'email queue: provider channel');
  eq(m.status, 'overdue', 'email queue: status');
  ok('subject' in m && 'ux_mode' in m && 'src' in m && 'drafted_by' in m, 'email queue: full field shape');
}
{
  const m = mapEmailSent(row({ status: 'sent', sent_at: '2026-06-02 09:00:00', delivery_status: 'delivered', channel: 'resend' }));
  eq(m.delivery_system, 'resend', 'email sent: delivery_system = provider');
  eq(m.status, 'delivered', 'email sent: delivered status');
  ok('open_rate' in m && 'click_rate' in m, 'email sent: engagement columns present (null Phase 1)');
}
{
  const m = mapSocialQueue(row({ channel: 'buffer', batch_id: 'grp7', item: { recipient: 'LinkedIn · Royalti', body: 'Post body', channel: 'buffer' } }));
  eq(m.platform, 'linkedin', 'social: platform parsed from recipient');
  eq(m.slug, 'grp7', 'social: batch_id = fan-out slug');
  ok(m.content === 'Post body', 'social: content from body');
}
{
  const m = mapNewsletterQueue(row({ channel: 'listmonk', item: { subject: 'Edition', channel: 'listmonk', recipients: 2104 } }));
  eq(m.recipient_count, 2104, 'newsletter: recipient_count from item.recipients');
  ok(m.cooling_until === null && m.quality_score === null, 'newsletter: cooling/quality null (Phase 2)');
}
{
  const m = mapSequenceQueue(row({ channel: 'resend', item: { subject: 'Step 1', channel: 'resend', sequence: { name: 'L5 Winback', step: 1, total: 5, recipients: 388 } } }));
  eq(m.name, 'L5 Winback', 'sequence: name from item.sequence');
  eq(m.total_steps, 5, 'sequence: total_steps');
}

// ── split / count ────────────────────────────────────────────────────────────
{
  const rows = [
    row({ channel: 'buffer', item: { channel: 'buffer' } }),
    row({ channel: 'listmonk', item: { channel: 'listmonk' } }),
    row({ channel: 'resend', item: { channel: 'resend' } }),
    row({ channel: 'smtp', item: { channel: 'smtp', sequence: { name: 'S', step: 1, total: 2 } } }),
  ];
  const counts = countByContentType(rows);
  eq(counts, { email: 1, newsletter: 1, social: 1, sequences: 1 }, 'countByContentType splits 4 ways');
  const split = splitByContentType(rows, mapEmailSent);
  ok(split.social.length === 1 && split.newsletter.length === 1, 'splitByContentType groups by derived type');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
