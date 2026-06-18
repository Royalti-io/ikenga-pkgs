// Query layer — mail domain. All reads/writes via host.dbQuery / host.dbExec.
// Schema: email_messages, email_replies, email_drafts, contacts, mail_thread_state.
// Migration 0042_mail_domain.sql creates mail_thread_state.

import { hostDbQuery, hostDbExec } from './bridge.js';

// ─── Thread list (inbox/triage/all/drafts) ───────────────────────────────────

/** Fetch mail thread list with thread-state join.
 *  Returns rows with columns:
 *    id, subject, from_address, from_name, received_at, triage_category,
 *    is_read, snoozed_until, tags, preview
 */
export async function fetchThreadList(view = "inbox", searchTerm = "") {
  let whereClause = '';
  let orderClause = 'ORDER BY em.received_at DESC';

  switch (view) {
    case 'inbox':
      whereClause = `WHERE (mts.snoozed_until IS NULL OR mts.snoozed_until < datetime('now'))`;
      break;
    case 'triage':
      whereClause = `WHERE em.triage_category IS NOT NULL AND em.triage_category != ''`;
      break;
    case 'all':
      whereClause = '';
      break;
    case 'drafts':
      // Drafts view reads email_drafts, not email_messages
      return fetchDraftList(searchTerm);
    default:
      whereClause = '';
  }

  const params = [];
  if (searchTerm) {
    const searchClause = `(em.subject LIKE ? OR em.from_address LIKE ? OR em.body_text LIKE ? OR COALESCE(c.name, "") LIKE ?)`;
    if (whereClause) whereClause += ` AND ${searchClause}`;
    else whereClause = `WHERE ${searchClause}`;
    const s = `%${searchTerm}%`;
    params.push(s, s, s, s);
  }

  const sql = `
    SELECT
      em.id,
      em.subject,
      em.from_address,
      COALESCE(c.name, em.from_address) AS from_name,
      em.received_at,
      em.triage_category,
      COALESCE(mts.is_read, 0) AS is_read,
      mts.snoozed_until,
      mts.tags,
      COALESCE(mts.preview, substr(em.body_text, 1, 160)) AS preview
    FROM email_messages em
    LEFT JOIN contacts c ON c.email = em.from_address
    LEFT JOIN mail_thread_state mts ON mts.message_id = em.id
    ${whereClause}
    ${orderClause}
    LIMIT 100
  `;
  const rows = await hostDbQuery(sql, params);
  return rows.map(normalizeThreadRow);
}

/** Fetch drafts list from email_drafts.
 *  Filters to unsent drafts (status = 'draft') so the list matches the Drafts
 *  nav badge (fetchDraftCount, also status='draft'). The previous filter
 *  (type='outreach' OR type IS NULL) returned 95 outreach-sequence rows — i.e.
 *  the list was effectively unfiltered and mirrored Inbox (F-22).
 */
export async function fetchDraftList(searchTerm = "") {
  let whereClause = "WHERE status = 'draft'";
  const params = [];
  if (searchTerm) {
    whereClause += " AND (subject LIKE ? OR from_email LIKE ? OR body LIKE ? OR from_name LIKE ?)";
    const s = `%${searchTerm}%`;
    params.push(s, s, s, s);
  }
  const sql = `
    SELECT
      id,
      subject,
      from_email AS from_address,
      from_name,
      created_at AS received_at,
      NULL AS triage_category,
      body AS body_text,
      1 AS is_read,
      NULL AS snoozed_until,
      NULL AS tags,
      substr(body, 1, 160) AS preview
    FROM email_drafts
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT 50
  `;
  const rows = await hostDbQuery(sql, params);
  return rows.map(normalizeThreadRow);
}
export async function fetchUnreadCount() {
  const sql = `
    SELECT COUNT(*) AS cnt
    FROM email_messages em
    LEFT JOIN mail_thread_state mts ON mts.message_id = em.id
    WHERE COALESCE(mts.is_read, 0) = 0
      AND (mts.snoozed_until IS NULL OR mts.snoozed_until < datetime('now'))
  `;
  const rows = await hostDbQuery(sql, []);
  return rows[0]?.cnt ?? 0;
}
/** Count triage-flagged threads. */
export async function fetchTriageCount() {
  const sql = `
    SELECT COUNT(*) AS cnt
    FROM email_messages em
    WHERE em.triage_category IS NOT NULL AND em.triage_category != ''
  `;
  const params = [];
  if (searchTerm) {
    const searchClause = `(em.subject LIKE ? OR em.from_address LIKE ? OR em.body_text LIKE ? OR COALESCE(c.name, "") LIKE ?)`;
    if (whereClause) whereClause += ` AND ${searchClause}`;
    else whereClause = `WHERE ${searchClause}`;
    const s = `%${searchTerm}%`;
    params.push(s, s, s, s);
  }
  const rows = await hostDbQuery(sql, params);
  return rows[0]?.cnt ?? 0;
}

/** Count snoozed threads. */
export async function fetchSnoozedCount() {
  const sql = `
    SELECT COUNT(*) AS cnt
    FROM mail_thread_state
    WHERE snoozed_until IS NOT NULL AND snoozed_until > datetime('now')
  `;
  const params = [];
  if (searchTerm) {
    const searchClause = `(em.subject LIKE ? OR em.from_address LIKE ? OR em.body_text LIKE ? OR COALESCE(c.name, "") LIKE ?)`;
    if (whereClause) whereClause += ` AND ${searchClause}`;
    else whereClause = `WHERE ${searchClause}`;
    const s = `%${searchTerm}%`;
    params.push(s, s, s, s);
  }
  const rows = await hostDbQuery(sql, params);
  return rows[0]?.cnt ?? 0;
}

/** Count unsent drafts. */
export async function fetchDraftCount() {
  const sql = `SELECT COUNT(*) AS cnt FROM email_drafts WHERE status = 'draft'`;
  const params = [];
  if (searchTerm) {
    const searchClause = `(em.subject LIKE ? OR em.from_address LIKE ? OR em.body_text LIKE ? OR COALESCE(c.name, "") LIKE ?)`;
    if (whereClause) whereClause += ` AND ${searchClause}`;
    else whereClause = `WHERE ${searchClause}`;
    const s = `%${searchTerm}%`;
    params.push(s, s, s, s);
  }
  const rows = await hostDbQuery(sql, params);
  return rows[0]?.cnt ?? 0;
}

// ─── Thread detail ────────────────────────────────────────────────────────────

/** Fetch a single message with contact lookup.
 *  Drafts live in email_drafts (separate id namespace), so when the id is not
 *  found in email_messages we fall back to email_drafts. Without this fallback
 *  selecting a draft row rendered "Thread not found." (F-03).
 */
export async function fetchMessage(id) {
  const sql = `
    SELECT
      em.*,
      COALESCE(c.name, em.from_address) AS from_name,
      COALESCE(c.organization, '') AS from_org,
      COALESCE(mts.is_read, 0) AS is_read,
      mts.snoozed_until,
      mts.tags
    FROM email_messages em
    LEFT JOIN contacts c ON c.email = em.from_address
    LEFT JOIN mail_thread_state mts ON mts.message_id = em.id
    WHERE em.id = ?
  `;
  const rows = await hostDbQuery(sql, [id]);
  if (rows[0]) return rows[0];
  return fetchDraftMessage(id);
}

/** Fetch a single draft as a reader-pane-shaped message. */
export async function fetchDraftMessage(id) {
  const sql = `
    SELECT
      id,
      subject,
      from_email AS from_address,
      COALESCE(from_name, from_email) AS from_name,
      '' AS from_org,
      created_at AS received_at,
      body AS body_text,
      body_format,
      type,
      status,
      1 AS is_read,
      NULL AS snoozed_until,
      NULL AS tags
    FROM email_drafts
    WHERE id = ?
  `;
  const rows = await hostDbQuery(sql, [id]);
  const row = rows[0];
  if (!row) return null;
  // Newsletter / HTML drafts carry markup in body — strip to plain text so the
  // reader renders readable paragraphs (the reader splits body_text on \n).
  const isHtml = (row.body_format && /html/i.test(row.body_format)) ||
    (typeof row.body_text === 'string' && /<[a-z][\s\S]*>/i.test(row.body_text));
  if (isHtml && typeof row.body_text === 'string') {
    row.body_text = htmlToText(row.body_text);
  }
  row.is_draft = true;
  return row;
}

// Normalize an email subject to a thread key — strip leading Re:/Fwd:/Fw:
// prefixes (repeatedly) and lowercase. Used to size a thread for the reader-meta
// "Thread of N" chip (B.7). in_reply_to is populated on <10% of real rows, so
// the normalized subject is the reliable thread signal.
export function normalizeSubject(subject) {
  let x = String(subject || '').trim();
  let prev;
  do {
    prev = x;
    x = x.replace(/^\s*(re|fwd|fw)\s*:\s*/i, '');
  } while (x !== prev);
  return x.trim().toLowerCase();
}

/**
 * Count the messages in the same thread as `subject` (B.7). A thread = all
 * email_messages whose normalized subject matches. A bounded LIKE narrows the
 * candidate set; the exact normalized comparison happens in JS to avoid
 * substring false positives. Returns >= 1.
 *
 * @param {string|null|undefined} subject
 * @returns {Promise<number>}
 */
export async function fetchThreadCount(subject) {
  const core = normalizeSubject(subject);
  if (!core) return 1;
  const like = `%${core.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await hostDbQuery(
    `SELECT subject FROM email_messages WHERE LOWER(subject) LIKE ? ESCAPE '\\'`,
    [like],
  ).catch(() => []);
  let n = 0;
  for (const r of rows) if (normalizeSubject(r.subject) === core) n += 1;
  return Math.max(1, n);
}

/** Fetch Chi-drafted reply for a message. */
export async function fetchReply(messageId) {
  const sql = `
    SELECT * FROM email_replies
    WHERE reply_to_message_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const rows = await hostDbQuery(sql, [messageId]);
  return rows[0] ?? null;
}

// ─── Thread-state writes ──────────────────────────────────────────────────────

/** Mark a message as read (upsert into mail_thread_state). */
export async function markRead(messageId) {
  const sql = `
    INSERT INTO mail_thread_state (message_id, is_read, updated_at)
    VALUES (?, 1, datetime('now'))
    ON CONFLICT(message_id) DO UPDATE SET
      is_read = 1,
      updated_at = datetime('now')
  `;
  return hostDbExec(sql, [messageId]);
}

/** Mark a message as unread. */
export async function markUnread(messageId) {
  const sql = `
    INSERT INTO mail_thread_state (message_id, is_read, updated_at)
    VALUES (?, 0, datetime('now'))
    ON CONFLICT(message_id) DO UPDATE SET
      is_read = 0,
      updated_at = datetime('now')
  `;
  return hostDbExec(sql, [messageId]);
}

/** Snooze a thread until a given ISO datetime string. */
export async function snoozeThread(messageId, until) {
  const sql = `
    INSERT INTO mail_thread_state (message_id, snoozed_until, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(message_id) DO UPDATE SET
      snoozed_until = ?,
      updated_at = datetime('now')
  `;
  return hostDbExec(sql, [messageId, until, until]);
}

/** Set tags on a thread (JSON array string). */
export async function setThreadTags(messageId, tags) {
  const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : [tags]);
  const sql = `
    INSERT INTO mail_thread_state (message_id, tags, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(message_id) DO UPDATE SET
      tags = ?,
      updated_at = datetime('now')
  `;
  return hostDbExec(sql, [messageId, tagsJson, tagsJson]);
}

// ─── Normalize helpers ────────────────────────────────────────────────────────

function normalizeThreadRow(row) {
  if (!row || typeof row !== 'object') return row;
  // tags arrives as JSON string or null
  const t = row.tags;
  if (typeof t === 'string' && t.trim()) {
    try {
      const parsed = JSON.parse(t);
      row.tags = Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch {
      row.tags = t.split(',').map((x) => x.trim()).filter(Boolean);
    }
  } else {
    row.tags = [];
  }
  row.is_read = Boolean(row.is_read);
  // Drafts (and any inbound) may carry HTML in preview — strip tags so the row
  // preview reads as plain text rather than dumping markup.
  if (typeof row.preview === 'string' && /<[a-z][\s\S]*>/i.test(row.preview)) {
    row.preview = htmlToText(row.preview);
  }
  return row;
}

/** Collapse an HTML fragment to readable plain text. */
function htmlToText(htmlStr) {
  return String(htmlStr)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}
