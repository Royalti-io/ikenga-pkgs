import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqlExecutor } from '@ikenga/meetings-contract';

export function resolveDatabasePath(customPath?: string): string {
  if (customPath) return customPath;
  if (process.env.IKENGA_DB) return process.env.IKENGA_DB;
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  if (process.env.MEETINGS_DB_PATH) return process.env.MEETINGS_DB_PATH;

  const localSharePath = path.join(os.homedir(), '.local/share/app.ikenga/ikenga.db');
  if (fs.existsSync(localSharePath)) {
    return localSharePath;
  }

  const dotIkengaPath = path.join(os.homedir(), '.ikenga/ikenga.db');
  if (fs.existsSync(dotIkengaPath)) {
    return dotIkengaPath;
  }

  return localSharePath;
}

/**
 * Normalizes SQLite rows: converts `null` values to `undefined` so that
 * Zod schemas with `.optional()` parse without throwing invalid_type errors.
 */
export function normalizeRow<T>(row: any): T {
  if (!row || typeof row !== 'object') return row;
  const out: any = Array.isArray(row) ? [] : {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null) {
      out[k] = undefined;
    } else if (typeof v === 'object') {
      out[k] = normalizeRow(v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * The tables this pkg is allowed to touch.
 *
 * Mirrors `permissions["sqlite.tables"]` in the com.ikenga.meetings manifest.
 * That manifest scope is enforced by the shell for the IFRAME path
 * (`host.dbQuery` / `host.dbExec` check it in pkg-iframe-host.tsx) — but a pkg's
 * BACKEND process has no scoped accessor available to it, so opening the
 * database with better-sqlite3 means holding a connection with full read/write
 * over every table in `ikenga.db`: tasks, email, finance, everything.
 *
 * That is a real widening of trust and it should not be incidental. This guard
 * re-imposes the manifest scope in code, so a bug — or a prompt injection
 * reaching a tool argument — cannot reach beyond the meetings domain. It is not
 * a substitute for host-side enforcement; it is the best a pkg can do for itself
 * until a scoped backend accessor exists.
 */
export const ALLOWED_TABLES = [
  'meetings',
  'meeting_speakers',
  'meeting_transcripts',
  'meeting_action_items',
  'meeting_summaries',
] as const;

/** Every table name a statement references, lowercased. */
export function tablesReferenced(sql: string): string[] {
  const found = new Set<string>();
  const re = /\b(?:from|join|into|update|table)\s+["'`\[]?([A-Za-z_][A-Za-z0-9_]*)["'`\]]?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    if (m[1]) found.add(m[1].toLowerCase());
  }
  return [...found];
}

/** Throw unless every table a statement touches is in the pkg's scope. */
export function assertInScope(sql: string): void {
  const allowed = new Set<string>(ALLOWED_TABLES);
  const out = tablesReferenced(sql).filter((t) => !allowed.has(t));
  if (out.length > 0) {
    throw new Error(
      `meetings pkg may not touch table(s): ${out.join(', ')}. ` +
        `Allowed: ${ALLOWED_TABLES.join(', ')}.`
    );
  }
}

export class BetterSqliteExecutor implements SqlExecutor {
  public readonly db: Database.Database;
  /** True only for a database this pkg created for itself (tests). */
  private readonly ownsSchema: boolean;

  constructor(dbPathOrInstance: string | Database.Database = resolveDatabasePath()) {
    const livePath = resolveDatabasePath();
    this.ownsSchema =
      typeof dbPathOrInstance === 'string'
        ? dbPathOrInstance === ':memory:' || path.resolve(dbPathOrInstance) !== path.resolve(livePath)
        : false;

    if (typeof dbPathOrInstance === 'string') {
      if (dbPathOrInstance !== ':memory:') {
        const dir = path.dirname(dbPathOrInstance);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new Database(dbPathOrInstance);
    } else {
      this.db = dbPathOrInstance;
    }

    try {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');
      this.db.pragma('synchronous = NORMAL');
    } catch {
      // Pragmas may not apply to all database configurations
    }

    // Schema is owned by the shell's migration runner (0063_meetings_domain,
    // recorded in `_pa_migrations`), NOT by this pkg.
    //
    // Creating tables here would put DDL into the user's canonical database
    // from a pkg process, outside the migration ledger. If this inline schema
    // ever drifted from the migration, the divergence would be silent and
    // unattributable. So the tables are only created for a database this pkg
    // owns outright — an in-memory or explicitly-pathed test database — and
    // never for the live one.
    if (this.ownsSchema) {
      this.initSchema();
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meetings (
        id               TEXT PRIMARY KEY,
        title            TEXT NOT NULL,
        platform         TEXT NOT NULL,
        url              TEXT,
        status           TEXT NOT NULL,
        start_time       TEXT NOT NULL,
        end_time         TEXT,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        video_path       TEXT,
        audio_path       TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS meeting_speakers (
        id             TEXT PRIMARY KEY,
        meeting_id     TEXT NOT NULL,
        name           TEXT NOT NULL,
        avatar_url     TEXT,
        contact_id     TEXT,
        speaker_source TEXT NOT NULL DEFAULT 'dom_cue'
      );

      CREATE TABLE IF NOT EXISTS meeting_transcripts (
        id             TEXT PRIMARY KEY,
        meeting_id     TEXT NOT NULL,
        speaker_id     TEXT,
        speaker_name   TEXT,
        speaker_source TEXT,
        start_ms       INTEGER NOT NULL,
        end_ms         INTEGER NOT NULL,
        text           TEXT NOT NULL,
        confidence     REAL NOT NULL DEFAULT 1.0,
        words_json     TEXT
      );

      CREATE TABLE IF NOT EXISTS meeting_action_items (
        id         TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        title      TEXT NOT NULL,
        assignee   TEXT,
        due_date   TEXT,
        status     TEXT NOT NULL DEFAULT 'pending',
        task_id    TEXT
      );

      CREATE TABLE IF NOT EXISTS meeting_summaries (
        id                 TEXT PRIMARY KEY,
        meeting_id         TEXT NOT NULL,
        executive_summary  TEXT NOT NULL,
        key_decisions_json TEXT NOT NULL DEFAULT '[]',
        topics_json        TEXT NOT NULL DEFAULT '[]',
        created_at         TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
      CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings(created_at);
      CREATE INDEX IF NOT EXISTS idx_meeting_speakers_meeting_id ON meeting_speakers(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_meeting_id ON meeting_transcripts(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_start_ms ON meeting_transcripts(meeting_id, start_ms);
      CREATE INDEX IF NOT EXISTS idx_meeting_action_items_meeting_id ON meeting_action_items(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_meeting_summaries_meeting_id ON meeting_summaries(meeting_id);
    `);
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    assertInScope(sql);
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map((r) => normalizeRow<T>(r));
  }

  async exec(sql: string, params: unknown[] = []): Promise<void | unknown> {
    assertInScope(sql);
    if (params && params.length > 0) {
      const stmt = this.db.prepare(sql);
      return stmt.run(...params);
    }
    return this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

export class InMemorySqlExecutor implements SqlExecutor {
  private meetingsMap = new Map<string, any>();
  private transcriptsMap = new Map<string, any[]>();
  private speakersMap = new Map<string, any[]>();
  private summariesMap = new Map<string, any>();
  private actionsMap = new Map<string, any[]>();

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    let results: any[] = [];
    if (sql.includes('SELECT * FROM meetings WHERE id = ?')) {
      const id = String(params[0]);
      const found = this.meetingsMap.get(id);
      results = found ? [found] : [];
    } else if (sql.includes('SELECT * FROM meetings')) {
      results = Array.from(this.meetingsMap.values());
    } else if (sql.includes('SELECT * FROM meeting_transcripts WHERE text LIKE ?')) {
      const all: any[] = [];
      for (const list of this.transcriptsMap.values()) {
        all.push(...list);
      }
      const rawPattern = String(params[0] ?? '').replace(/%/g, '').toLowerCase();
      results = all.filter((r) => r.text?.toLowerCase().includes(rawPattern));
    } else if (sql.includes('SELECT * FROM meeting_transcripts WHERE meeting_id = ?')) {
      const id = String(params[0]);
      results = this.transcriptsMap.get(id) ?? [];
    } else if (sql.includes('SELECT * FROM meeting_speakers WHERE meeting_id = ?')) {
      const id = String(params[0]);
      results = this.speakersMap.get(id) ?? [];
    } else if (sql.includes('SELECT * FROM meeting_summaries WHERE meeting_id = ?')) {
      const id = String(params[0]);
      const found = this.summariesMap.get(id);
      results = found ? [found] : [];
    } else if (sql.includes('SELECT * FROM meeting_action_items WHERE meeting_id = ?')) {
      const id = String(params[0]);
      results = this.actionsMap.get(id) ?? [];
    }
    return results.map((r) => normalizeRow<T>(r));
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    if (sql.includes('INSERT INTO meetings')) {
      const [id, title, platform, url, status, start_time, end_time, duration_seconds, video_path, audio_path, created_at, updated_at] = params;
      this.meetingsMap.set(String(id), {
        id, title, platform, url, status, start_time, end_time, duration_seconds, video_path, audio_path, created_at, updated_at
      });
    } else if (sql.includes('UPDATE meetings SET')) {
      const id = String(params[params.length - 1]);
      const existing = this.meetingsMap.get(id);
      if (existing) {
        existing.status = params[0];
        existing.updated_at = params[1];
        if (params.length > 3) {
          existing.end_time = params[2];
        }
      }
    } else if (sql.includes('INSERT INTO meeting_speakers')) {
      const [id, meeting_id, name, avatar_url, contact_id, speaker_source] = params;
      const list = this.speakersMap.get(String(meeting_id)) ?? [];
      list.push({ id, meeting_id, name, avatar_url, contact_id, speaker_source });
      this.speakersMap.set(String(meeting_id), list);
    } else if (sql.includes('INSERT INTO meeting_transcripts')) {
      const [id, meeting_id, speaker_id, speaker_name, speaker_source, start_ms, end_ms, text, confidence, words_json] = params;
      const list = this.transcriptsMap.get(String(meeting_id)) ?? [];
      list.push({ id, meeting_id, speaker_id, speaker_name, speaker_source, start_ms, end_ms, text, confidence, words_json });
      this.transcriptsMap.set(String(meeting_id), list);
    } else if (sql.includes('INSERT INTO meeting_summaries')) {
      const [id, meeting_id, executive_summary, key_decisions_json, topics_json, created_at] = params;
      this.summariesMap.set(String(meeting_id), {
        id, meeting_id, executive_summary, key_decisions_json, topics_json, created_at
      });
    } else if (sql.includes('INSERT INTO meeting_action_items')) {
      const [id, meeting_id, title, assignee, due_date, status, task_id] = params;
      const list = this.actionsMap.get(String(meeting_id)) ?? [];
      list.push({ id, meeting_id, title, assignee, due_date, status, task_id });
      this.actionsMap.set(String(meeting_id), list);
    }
  }
}
