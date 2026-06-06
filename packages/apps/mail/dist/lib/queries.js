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
export async function fetchThreadList(view = 'inbox') {
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
      return fetchDraftList();
    default:
      whereClause = '';
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
  const rows = await hostDbQuery(sql, []);
  return rows.map(normalizeThreadRow);
}

/** Fetch drafts list from email_drafts. */
export async function fetchDraftList() {
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
      substr(body, 1, 120) AS preview
    FROM email_drafts
    WHERE type = 'outreach' OR type IS NULL
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return hostDbQuery(sql, []);
}

/** Count unread threads (for is-hot badge on Inbox nav item). */
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
  const rows = await hostDbQuery(sql, []);
  return rows[0]?.cnt ?? 0;
}

/** Count snoozed threads. */
export async function fetchSnoozedCount() {
  const sql = `
    SELECT COUNT(*) AS cnt
    FROM mail_thread_state
    WHERE snoozed_until IS NOT NULL AND snoozed_until > datetime('now')
  `;
  const rows = await hostDbQuery(sql, []);
  return rows[0]?.cnt ?? 0;
}

/** Count unsent drafts. */
export async function fetchDraftCount() {
  const sql = `SELECT COUNT(*) AS cnt FROM email_drafts WHERE status = 'draft'`;
  const rows = await hostDbQuery(sql, []);
  return rows[0]?.cnt ?? 0;
}

// ─── Thread detail ────────────────────────────────────────────────────────────

/** Fetch a single message with contact lookup. */
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
  return rows[0] ?? null;
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
  return row;
}
