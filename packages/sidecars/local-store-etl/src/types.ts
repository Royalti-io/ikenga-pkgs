/**
 * types.ts — shared types for the local-store-etl sidecar.
 */

// ── JSON-RPC envelope (ikenga sidecar stdio protocol) ────────────────────────

export interface RpcRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

export interface RpcResponse<T = unknown> {
  id: string | number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

// ── ETL commands ─────────────────────────────────────────────────────────────

/** Params for the `run` command (routed from iyke POST /etl). */
export interface RunParams {
  /** `"fixture"` loads synthetic test data; `"live"` (Wave 4) hits Supabase. */
  mode: 'fixture' | 'live';
  /** Optional list of table names to restrict the run to. Empty = all tables. */
  tables?: string[];
  /** Absolute path to the pa.db file to write into. */
  db_path: string;
  /** When true, perform a dry-run (validate only, no writes). */
  dry_run?: boolean;
}

/** Per-table result entry. */
export interface TableResult {
  table: string;
  rows_inserted: number;
  rows_skipped: number;
  checksum_sha256: string;
}

/** Response payload for the `run` command. */
export interface RunResult {
  mode: RunParams['mode'];
  tables: TableResult[];
  elapsed_ms: number;
  is_no_op: boolean;
}

// ── Fixture row shape ─────────────────────────────────────────────────────────

/** A single fixture row: column name → serialisable value. */
export type FixtureRow = Record<string, string | number | boolean | null>;

/** Fixture dataset: table name → rows to upsert. */
export type FixtureDataset = Record<string, FixtureRow[]>;
