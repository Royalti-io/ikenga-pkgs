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
  newsletterHistorySignals,
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

// D-4: an unknown/typo `kind` must NOT short-circuit — fall through to heuristic.
eq(deriveContentType({ channel: 'resend', kind: 'bogus' }), 'email', 'bogus kind falls through to heuristic (resend → email)');
eq(deriveContentType({ channel: 'buffer', kind: 'bogus' }), 'social', 'bogus kind falls through to heuristic (buffer → social)');
eq(deriveContentType({ channel: 'resend', kind: 'newsletter' }), 'newsletter', 'valid kind:newsletter still wins over heuristic');

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

// D-1 + D-9: platformOf via mapSocialQueue — instagram derive, fast-path, '· x'.
{
  const m = mapSocialQueue(row({ channel: 'buffer', item: { recipient: 'instagram · royalti-io', body: 'IG post', channel: 'buffer' } }));
  eq(m.platform, 'instagram', 'social: instagram derived from recipient (no item.platform)');
}
{
  const m = mapSocialQueue(row({ channel: 'buffer', item: { platform: 'x', recipient: 'whatever', body: 'p', channel: 'buffer' } }));
  eq(m.platform, 'x', 'social: item.platform fast-path returns x');
}
{
  const m = mapSocialQueue(row({ channel: 'buffer', item: { recipient: 'Royalti · x', body: 'p', channel: 'buffer' } }));
  eq(m.platform, 'x', 'social: "· x" recipient → x (design key, not twitter)');
}
{
  const m = mapSocialQueue(row({ channel: 'buffer', item: { recipient: 'on Twitter today', body: 'p', channel: 'buffer' } }));
  eq(m.platform, 'x', 'social: twitter recipient → x');
}

// raw_status (C-2): the pa_action_drafts lifecycle status rides on queue mappers.
{
  const m = mapEmailQueue(row({ status: 'committed', item: { recipient: 'V', recipientEmail: 'v@a.b', subject: 'S', channel: 'resend' } }));
  eq(m.raw_status, 'committed', 'email queue: raw_status carries lifecycle status');
  ok(m.status !== m.raw_status, 'email queue: raw_status is distinct from design status');
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

// ── newsletterHistorySignals (WP-11) ─────────────────────────────────────────
// Helpers
function histRow(over = {}) {
  return {
    subject: over.subject ?? 'Default subject',
    draft_slug: over.draft_slug ?? null,
    edition: over.edition ?? null,
    sent_at: over.sent_at ?? '2026-01-01 10:00:00',
    body: over.body ?? null,
  };
}

// Anchor "now" for deterministic 60-day window tests.
// Use a fixed past date so relative comparisons are stable.
// All "inside 60d" dates are set to within 60 days of 2026-06-10.
const INSIDE_60D = '2026-06-01 10:00:00';   // 9 days before 2026-06-10
const OUTSIDE_60D = '2026-03-01 10:00:00';  // ~101 days before 2026-06-10

{
  // 1. Empty history → honest '—' freshness + '—' previously-featured.
  const { freshness, previouslyFeatured } = newsletterHistorySignals(
    { subject: 'Hello', body: 'Hello https://royalti.io/blog/a', section: 'slug-a' },
    []
  );
  eq(freshness.value, '—', 'empty history: freshness value is —');
  eq(freshness.sub, 'no sent history', 'empty history: freshness sub correct');
  eq(freshness.tone, 'warn', 'empty history: freshness tone warn');
  eq(previouslyFeatured.value, '—', 'empty history: previouslyFeatured value is —');
  eq(previouslyFeatured.sub, 'no sent history', 'empty history: previouslyFeatured sub correct');
}

{
  // 2. Repeat subject inside 60 days → warn with date in sub.
  const rows = [histRow({ subject: 'You can deliver from Royalti now', sent_at: INSIDE_60D })];
  const { freshness } = newsletterHistorySignals(
    { subject: 'You can deliver from Royalti now' },
    rows
  );
  eq(freshness.tone, 'warn', 'repeat inside 60d: tone is warn');
  eq(freshness.value, 'Repeat', 'repeat inside 60d: value is Repeat');
  ok(freshness.sub.includes('2026-06-01'), 'repeat inside 60d: sub includes sent date');
}

{
  // 3. Repeat subject OUTSIDE 60 days → ok (fresh).
  const rows = [histRow({ subject: 'You can deliver from Royalti now', sent_at: OUTSIDE_60D })];
  const { freshness } = newsletterHistorySignals(
    { subject: 'You can deliver from Royalti now' },
    rows
  );
  eq(freshness.tone, 'ok', 'repeat outside 60d: tone is ok');
  eq(freshness.value, 'Fresh', 'repeat outside 60d: value is Fresh');
  eq(freshness.sub, 'no repeat <60d', 'repeat outside 60d: sub is no repeat <60d');
}

{
  // 4. No subject match at all → ok (Fresh).
  const rows = [histRow({ subject: 'Different subject entirely', sent_at: INSIDE_60D })];
  const { freshness } = newsletterHistorySignals(
    { subject: 'Schema patches that unblocked tenant 590' },
    rows
  );
  eq(freshness.tone, 'ok', 'no subject match: tone ok');
  eq(freshness.value, 'Fresh', 'no subject match: value Fresh');
}

{
  // 5. Subject comparison is case+whitespace normalised.
  const rows = [histRow({ subject: '  YOU CAN DELIVER FROM ROYALTI NOW  ', sent_at: INSIDE_60D })];
  const { freshness } = newsletterHistorySignals(
    { subject: 'you can deliver from royalti now' },
    rows
  );
  eq(freshness.tone, 'warn', 'normalised subject: still matches');
}

{
  // 6. Link overlap → previously featured (1 edition).
  const sharedUrl = 'https://royalti.io/blog/schema-patches';
  const rows = [histRow({ body: `Check this out: ${sharedUrl} and more.`, sent_at: OUTSIDE_60D })];
  const { previouslyFeatured } = newsletterHistorySignals(
    { subject: 'New edition', body: `Read more: ${sharedUrl}\n`, section: null },
    rows
  );
  eq(previouslyFeatured.tone, 'warn', 'link overlap: tone warn');
  eq(previouslyFeatured.value, '1', 'link overlap: value is 1');
  ok(previouslyFeatured.sub.includes('1 prior edition'), 'link overlap: sub mentions 1 prior edition');
}

{
  // 7. Slug overlap → previously featured (1 edition).
  const rows = [histRow({ draft_slug: 'royalti-deliver', sent_at: OUTSIDE_60D, body: null })];
  const { previouslyFeatured } = newsletterHistorySignals(
    { subject: 'New edition', body: '', section: 'royalti-deliver' },
    rows
  );
  eq(previouslyFeatured.tone, 'warn', 'slug overlap: tone warn');
  eq(previouslyFeatured.value, '1', 'slug overlap: 1 match');
}

{
  // 8. Multiple overlapping editions.
  const url = 'https://royalti.io/deliver';
  const rows = [
    histRow({ body: `Visit ${url}`, sent_at: OUTSIDE_60D }),
    histRow({ body: `Also at ${url} today`, sent_at: INSIDE_60D }),
  ];
  const { previouslyFeatured } = newsletterHistorySignals(
    { subject: 'New', body: `See ${url} for details`, section: null },
    rows
  );
  eq(previouslyFeatured.value, '2', 'multiple overlapping: count is 2');
  ok(previouslyFeatured.sub.includes('2 prior editions'), 'multiple overlapping: sub says 2 editions');
}

{
  // 9. All history rows have no body and no slug → '—' (no body in history).
  // Per spec: "Zero history rows with bodies → honest '—'".
  const rows = [histRow({ body: null, draft_slug: null, sent_at: OUTSIDE_60D })];
  const url = 'https://royalti.io/blog/something';
  const { previouslyFeatured } = newsletterHistorySignals(
    { subject: 'New', body: `See ${url}`, section: 'my-slug' },
    rows
  );
  eq(previouslyFeatured.value, '—', 'all rows no body+slug: value is — (cannot check)');
  eq(previouslyFeatured.sub, 'no body in history', 'all rows no body+slug: sub says no body in history');
  eq(previouslyFeatured.tone, 'warn', 'all rows no body+slug: tone warn');
}

{
  // 10. Draft has no body and no slug → '—' (no links/slug to check).
  const rows = [histRow({ body: 'https://royalti.io/blog/a', sent_at: OUTSIDE_60D })];
  const { previouslyFeatured } = newsletterHistorySignals(
    { subject: 'New', body: '', section: '' },
    rows
  );
  eq(previouslyFeatured.value, '—', 'no draft body/slug: value —');
  eq(previouslyFeatured.sub, 'no links/slug to check', 'no draft body/slug: sub correct');
}

{
  // 11. URL query string + trailing slash stripped — same canonical URL matches.
  const canonical = 'https://royalti.io/blog/a';
  const rows = [histRow({ body: `${canonical}?utm_source=email#section`, sent_at: OUTSIDE_60D })];
  const { previouslyFeatured } = newsletterHistorySignals(
    { subject: 'New', body: `${canonical}/`, section: null },
    rows
  );
  eq(previouslyFeatured.value, '1', 'URL normalisation: query+slash stripped, still matches');
}

{
  // 12. No-body history rows and non-empty history → honest '—' sub says 'no body in history'.
  // (all rows lack body AND draft_slug)
  const rows = [
    histRow({ body: null, draft_slug: null }),
    histRow({ body: null, draft_slug: null }),
  ];
  const { previouslyFeatured } = newsletterHistorySignals(
    { subject: 'S', body: 'https://royalti.io/a', section: 'slug-x' },
    rows
  );
  // rowsWithBody = 0 → honest '—'
  eq(previouslyFeatured.value, '—', 'all rows no body+slug: value —');
  eq(previouslyFeatured.sub, 'no body in history', 'all rows no body+slug: sub correct');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
