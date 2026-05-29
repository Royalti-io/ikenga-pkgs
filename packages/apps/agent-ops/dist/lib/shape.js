// shape.js — PURE shaping functions for the agent-ops data layer (WP-08).
//
// No bridge import — these are headlessly testable with real DB/config data.
// Consumers: queries.js (I/O layer), wp08-verify harness, WP-10/11.
//
// Contract: all output types pin to G-VIEW in dist/lib/view-model.js (FROZEN).
// Mismatch resolutions (M1–M7) are applied here as specified in view-model.js.

// ── Static external schedulers declaration (G-09) ──────────────────────────
// The three Rex VPS db-backup jobs are disabled in jobs.json with
// _disabledReason: "Runs on Rex VPS crontab — see /home/rex/db-backup/"
// The sales:domain-warmup timer runs as a systemd user timer.
//
/** @type {import('./view-model.js').ExternalSchedulerView[]} */
export const EXTERNAL_SCHEDULERS = [
  {
    id: 'ops:db-backup-4hourly',
    label: 'DB Backup (4-hourly)',
    namespace: 'ops',
    kind: /** @type {import('./view-model.js').ExternalKind} */ ('rex-vps'),
    schedule: '0 */4 * * *',
    managed_at: 'Rex VPS · /home/rex/db-backup/',
    note: 'Runs on Rex VPS crontab — see /home/rex/db-backup/',
  },
  {
    id: 'ops:db-backup-daily',
    label: 'DB Backup (daily)',
    namespace: 'ops',
    kind: /** @type {import('./view-model.js').ExternalKind} */ ('rex-vps'),
    schedule: '0 2 * * *',
    managed_at: 'Rex VPS · /home/rex/db-backup/',
    note: 'Runs on Rex VPS crontab — see /home/rex/db-backup/',
  },
  {
    id: 'ops:db-backup-weekly',
    label: 'DB Backup (weekly)',
    namespace: 'ops',
    kind: /** @type {import('./view-model.js').ExternalKind} */ ('rex-vps'),
    schedule: '0 3 * * 0',
    managed_at: 'Rex VPS · /home/rex/db-backup/',
    note: 'Runs on Rex VPS crontab — see /home/rex/db-backup/',
  },
  {
    id: 'sales:domain-warmup',
    label: 'Domain Warmup',
    namespace: 'sales',
    kind: /** @type {import('./view-model.js').ExternalKind} */ ('systemd'),
    schedule: 'OnCalendar=hourly',
    managed_at: 'systemd user timer · domain-warmup.timer',
    note: 'Moved out of crontab — managed by systemd',
  },
];

// Set of external scheduler IDs — used to skip them in the managed-jobs list.
const EXTERNAL_IDS = new Set(EXTERNAL_SCHEDULERS.map((e) => e.id));

// ── normalizeStatus ─────────────────────────────────────────────────────────

/** Valid RunStatus values per G-VIEW.
 * @type {readonly string[]}
 */
const VALID_RUN_STATUSES = ['ok', 'error', 'fail', 'timeout', 'skipped', 'running'];

/**
 * Normalize a raw status string from cron_job_runs / agent_runs to RunStatus.
 * M2: 'error' is kept (writer's term); 'failed'/'fail' both map to 'fail';
 * 'timeout' passthrough; unknown strings → 'error'.
 *
 * @param {string|null|undefined} raw
 * @returns {import('./view-model.js').RunStatus}
 */
export function normalizeStatus(raw) {
  if (!raw) return 'error';
  const s = raw.toLowerCase().trim();
  if (VALID_RUN_STATUSES.includes(s)) return /** @type {any} */ (s);
  if (s === 'failed') return 'fail';
  if (s === 'timed_out' || s === 'timed-out') return 'timeout';
  // unknown → error (M2)
  return 'error';
}

// ── shapeRunView ────────────────────────────────────────────────────────────

/**
 * Shape one cron_job_runs DB row into a RunView.
 * M1: cost_usd is TEXT in DB → parseFloat; null if absent/NaN/empty.
 * M3: no cache_creation_tokens column → omit (only cache_read_tokens).
 * Default token fields to 0.
 *
 * @param {Record<string, any>} dbRow
 * @returns {import('./view-model.js').RunView}
 */
export function shapeRunView(dbRow) {
  const rawCost = dbRow.cost_usd;
  let cost_usd = null;
  if (rawCost != null && rawCost !== '') {
    const parsed = parseFloat(rawCost);
    cost_usd = isNaN(parsed) ? null : parsed;
  }

  return {
    id: String(dbRow.id),
    job_id: String(dbRow.job_id),
    agent: String(dbRow.agent ?? ''),
    status: normalizeStatus(dbRow.status),
    error: dbRow.error ?? null,
    summary: dbRow.summary ?? null,
    duration_ms: dbRow.duration_ms ?? null,
    cost_usd,
    input_tokens: Number(dbRow.input_tokens ?? 0),
    output_tokens: Number(dbRow.output_tokens ?? 0),
    cache_read_tokens: Number(dbRow.cache_read_tokens ?? 0),
    num_turns: Number(dbRow.num_turns ?? 0),
    session_id: dbRow.session_id ?? null,
    report_id: dbRow.report_id ?? null,
    created_at: dbRow.created_at ?? null,
  };
}

// ── computeHealth ───────────────────────────────────────────────────────────

/**
 * Compute the JobHealth roll-up from raw job config + state.
 * Rules (in priority order):
 *   disabled  → !enabled
 *   failing   → consecutiveErrors >= 2
 *   running   → lastStatus === 'running'
 *   pending   → no state / never ran (state null or lastRunAtMs null/undefined)
 *   ok        → otherwise
 *
 * @param {Record<string, any>} rawJob
 * @returns {import('./view-model.js').JobHealth}
 */
export function computeHealth(rawJob) {
  if (!rawJob.enabled) return 'disabled';
  const st = rawJob.state;
  if (!st || st.lastRunAtMs == null) return 'pending';
  if ((st.consecutiveErrors ?? 0) >= 2) return 'failing';
  if (st.lastStatus === 'running') return 'running';
  return 'ok';
}

// ── shapeJobView ────────────────────────────────────────────────────────────

const MS_24H = 24 * 60 * 60 * 1000;

/**
 * Shape a RawJob (config + state) and its cron_job_runs rows into a JobView.
 * 'mode' defaults to 'agent' if absent from config (most jobs are agent-mode).
 *
 * @param {Record<string, any>} rawJob  — RawJob from host.agentOps.listJobs
 * @param {import('./view-model.js').RunView[]} runViewsForJob  — already shaped, newest first
 * @returns {import('./view-model.js').JobView}
 */
export function shapeJobView(rawJob, runViewsForJob) {
  const st = rawJob.state ?? null;

  // cap last_runs to 12 (newest first already)
  const last_runs = runViewsForJob.slice(0, 12);

  // cost_24h_usd: sum cost_usd of runs within the last 24h
  const now = Date.now();
  const cutoff = now - MS_24H;
  let cost_24h_usd = null;
  for (const r of last_runs) {
    if (!r.created_at) continue;
    const ts = new Date(r.created_at).getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    if (r.cost_usd == null) continue;
    cost_24h_usd = (cost_24h_usd ?? 0) + r.cost_usd;
  }

  // Determine mode: 'script' | 'agent'. Default to 'agent'.
  const mode = rawJob.mode === 'script' ? 'script' : 'agent';

  // Normalize last_status from state
  const last_status = st?.lastStatus ? normalizeStatus(st.lastStatus) : null;

  return {
    id: String(rawJob.id),
    label: String(rawJob.label ?? rawJob.id),
    namespace: String(rawJob.id).split(':')[0],
    schedule: String(rawJob.schedule ?? ''),
    schedule_dialect: rawJob.schedule_dialect ?? '5f',
    timezone: String(rawJob.timezone ?? 'UTC'),
    enabled: Boolean(rawJob.enabled),
    mode,
    model: rawJob.model ?? null,
    _disabled_reason: rawJob._disabledReason ?? null,
    health: computeHealth(rawJob),
    next_run_at_ms: st?.nextRunAtMs ?? null,
    last_run_at_ms: st?.lastRunAtMs ?? null,
    last_status,
    consecutive_errors: st?.consecutiveErrors ?? 0,
    last_duration_ms: st?.lastDurationMs ?? null,
    total_cost_usd: st?.totalCostUsd ?? null,
    cost_24h_usd,
    last_runs,
  };
}

// ── shapeScheduleData ───────────────────────────────────────────────────────

/**
 * Build the full ScheduleData payload from a listJobs response and all run rows.
 *
 * @param {{ ok: boolean, daemon_up?: boolean, daemon_pid?: number|null, jobs?: any[], error?: string }} listJobsRes
 * @param {Array<Record<string, any>>} allRunRows  — raw DB rows from cron_job_runs (any order)
 * @returns {import('./view-model.js').ScheduleData}
 */
export function shapeScheduleData(listJobsRes, allRunRows) {
  const daemon_up = listJobsRes.ok ? Boolean(listJobsRes.daemon_up) : false;
  const daemon_pid = listJobsRes.daemon_pid ?? null;
  const rawJobs = listJobsRes.jobs ?? [];

  // Group allRunRows by job_id, shape each to RunView, then sort newest first.
  /** @type {Map<string, import('./view-model.js').RunView[]>} */
  const runsByJobId = new Map();
  for (const row of allRunRows) {
    const jobId = row.job_id;
    if (!jobId) continue;
    if (!runsByJobId.has(jobId)) runsByJobId.set(jobId, []);
    runsByJobId.get(jobId).push(shapeRunView(row));
  }
  // Sort each group newest first (by created_at DESC)
  for (const [, runs] of runsByJobId) {
    runs.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
  }

  // Build jobs[], skipping jobs that are in the external set
  // (those appear in the `external` array instead).
  const jobs = rawJobs
    .filter((rj) => !EXTERNAL_IDS.has(rj.id))
    .map((rj) => shapeJobView(rj, runsByJobId.get(rj.id) ?? []));

  // Summary
  const enabled = jobs.filter((j) => j.enabled).length;
  const disabled = jobs.filter((j) => !j.enabled).length;
  const failing = jobs.filter((j) => j.health === 'failing').length;

  // next job to fire: earliest next_run_at_ms among enabled jobs
  const now = Date.now();
  let next_label = '';
  let next_in_ms = null;
  for (const j of jobs) {
    if (!j.enabled || j.next_run_at_ms == null) continue;
    const remaining = j.next_run_at_ms - now;
    if (next_in_ms === null || remaining < next_in_ms) {
      next_in_ms = remaining;
      next_label = j.label;
    }
  }

  // agent_spend_24h_usd: sum of cost_24h_usd across all agent-mode jobs
  let agent_spend_24h_usd = 0;
  for (const j of jobs) {
    if (j.mode === 'agent' && j.cost_24h_usd != null) {
      agent_spend_24h_usd += j.cost_24h_usd;
    }
  }

  return {
    daemon_up,
    daemon_pid,
    jobs,
    external: EXTERNAL_SCHEDULERS,
    summary: { enabled, disabled, failing, next_label, next_in_ms, agent_spend_24h_usd },
  };
}

// ── shapeAgentRunView ───────────────────────────────────────────────────────

/**
 * Shape one agent_runs DB row into an AgentRunView.
 * M7: agent_runs has no cost/token columns.
 *
 * @param {Record<string, any>} dbRow
 * @returns {import('./view-model.js').AgentRunView}
 */
export function shapeAgentRunView(dbRow) {
  return {
    id: String(dbRow.id),
    agent_name: String(dbRow.agent_name ?? ''),
    command: dbRow.command ?? null,
    status: normalizeStatus(dbRow.status ?? 'running'),
    output_summary: dbRow.output_summary ?? null,
    triggered_by: dbRow.triggered_by ?? null,
    error_message: dbRow.error_message ?? null,
    started_at: dbRow.started_at ?? null,
    completed_at: dbRow.completed_at ?? null,
    created_at: dbRow.created_at ?? null,
    claude_session_id: dbRow.claude_session_id ?? null,
    working_dir: dbRow.working_dir ?? null,
    last_activity_at: dbRow.last_activity_at ?? null,
  };
}
