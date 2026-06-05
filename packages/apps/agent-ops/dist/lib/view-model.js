/**
 * G-VIEW — the frozen read-model for the agent-ops observability pkg (WP-07 gate).
 *
 * This is the contract WP-08 (data layer), WP-10/11/13 (views) and the shell-native
 * /cron + /agent-runs routes all pin to. Changing it after consumers exist forces a
 * multi-WP re-sync — so it is FROZEN here (G-VIEW). JSDoc typedefs (no .ts build; the
 * pkg is no-build, matching the tasks pkg). Naming: snake_case verbatim from the DB /
 * config, mirroring the tasks-pkg `Task` typedef precedent — NO camelCase remap.
 *
 * Sources (recon-verified, file-cited in 04 Round 3/4):
 *   RunView            ← cron_job_runs (migration 0031, STRICT)
 *   AgentRunView       ← agent_runs    (migration 0025, STRICT)
 *   JobView            ← JobDefinition (royalti-co scripts/cron/drafts/job-config.ts)
 *                        + runtime state (jobs-state.json / CronJob.state)
 *   ExternalSchedulerView ← static external-schedulers declaration (G-09)
 *
 * Mismatch resolutions baked into this contract (from the Round-3/4 recon):
 *   M1 cost_usd is TEXT in 0031 but a number in UsageMetrics → RunView.cost_usd is
 *      `number | null` (WP-08 parses the TEXT column with parseFloat; null if absent/NaN).
 *   M2 status enum diverges (cron_job_runs writer uses "ok"|"error"; JobDefinition.last_status
 *      uses "ok"|"failed"|"timeout"|"skipped") → this contract NORMALIZES to RunStatus below.
 *      WP-08 maps raw DB status → RunStatus at read time; unknown strings → "error".
 *   M3/M4 no cache_creation_tokens column exists → RunView omits it (only cache_read_tokens).
 *   M7 agent_runs carries NO cost/token columns → AgentRunView has no usage fields; cost for an
 *      agent run is only available by correlating to a cron_job_runs row (session_id), surfaced
 *      on RunView, not AgentRunView.
 */

// ---------- enums (the normalized application-level contract) ----------

/** @typedef {'ok'|'error'|'fail'|'timeout'|'skipped'|'running'} RunStatus
 *  Normalized run outcome. WP-08 maps raw cron_job_runs.status / agent_runs.status into this.
 *  ('error' and 'fail' are both kept: 'error' = writer's term, 'fail' = display term; treat as synonyms.) */

/** @typedef {'ok'|'running'|'failing'|'disabled'|'pending'|'external'} JobHealth
 *  Computed roll-up the Schedule/Failures views badge on. Derived by WP-08 from enabled +
 *  last_status + consecutive_errors (failing = 1+ recent fail; disabled = !enabled; pending = never run). */

/** @typedef {'agent'|'script'} JobMode
 *  'agent' fires a billable `claude -p` run (run-now must confirm w/ cost — G-13); 'script' is a free local command. */

/** @typedef {'rex-vps'|'systemd'|'crontab'|'other'} ExternalKind */

// ---------- RunView ← cron_job_runs (0031) ----------

/**
 * One run-history row. Source: ikenga.db cron_job_runs (migration 0031, STRICT).
 * @typedef {Object} RunView
 * @property {string}        id                 cron_job_runs.id (PK, randomUUID)
 * @property {string}        job_id             cron_job_runs.job_id (namespace:slug)
 * @property {string}        agent              cron_job_runs.agent
 * @property {RunStatus}     status             NORMALIZED from cron_job_runs.status (M2)
 * @property {string|null}   error              cron_job_runs.error
 * @property {string|null}   summary            cron_job_runs.summary
 * @property {number|null}   duration_ms        cron_job_runs.duration_ms (drives the bar HEIGHT — G-15)
 * @property {number|null}   cost_usd           PARSED from TEXT cron_job_runs.cost_usd (M1: parseFloat, null if NaN)
 * @property {number}        input_tokens       cron_job_runs.input_tokens (DEFAULT 0)
 * @property {number}        output_tokens      cron_job_runs.output_tokens (DEFAULT 0)
 * @property {number}        cache_read_tokens  cron_job_runs.cache_read_tokens (DEFAULT 0; no cache_creation col — M3)
 * @property {number}        num_turns          cron_job_runs.num_turns (DEFAULT 0)
 * @property {string|null}   session_id         cron_job_runs.session_id (correlates to agent_runs)
 * @property {string|null}   report_id          cron_job_runs.report_id
 * @property {string|null}   created_at         cron_job_runs.created_at (ISO-8601 TEXT)
 */

// ---------- AgentRunView ← agent_runs (0025) ----------

/**
 * One agent-run row (the /agent-runs view). Source: ikenga.db agent_runs (migration 0025, STRICT).
 * NB (M7): agent_runs has NO cost/token columns — usage lives only on the correlated RunView.
 * @typedef {Object} AgentRunView
 * @property {string}        id                 agent_runs.id (PK)
 * @property {string}        agent_name         agent_runs.agent_name
 * @property {string|null}   command            agent_runs.command
 * @property {RunStatus}     status             NORMALIZED from agent_runs.status (default 'running')
 * @property {string|null}   output_summary     agent_runs.output_summary
 * @property {string|null}   triggered_by       agent_runs.triggered_by (default 'cron')
 * @property {string|null}   error_message      agent_runs.error_message
 * @property {string|null}   started_at         agent_runs.started_at (ISO TEXT)
 * @property {string|null}   completed_at       agent_runs.completed_at (ISO TEXT)
 * @property {string|null}   created_at         agent_runs.created_at (ISO TEXT)
 * @property {string|null}   claude_session_id  agent_runs.claude_session_id
 * @property {string|null}   working_dir        agent_runs.working_dir
 * @property {string|null}   last_activity_at   agent_runs.last_activity_at (drives the Live view freshness)
 */

// ---------- JobView ← JobDefinition + runtime state ----------

/**
 * A schedule row: the static JobDefinition (config) joined with executor-written runtime state.
 * Config source: royalti-co scripts/cron/drafts/job-config.ts. State source: jobs-state.json.
 * @typedef {Object} JobView
 * @property {string}        id                 JobDefinition.id (namespace:slug)
 * @property {string}        label              JobDefinition.label
 * @property {string}        namespace          derived: id.split(':')[0] (drives "By domain" grouping)
 * @property {string}        schedule           JobDefinition.schedule (raw cron expr)
 * @property {'5f'|'6f'}     schedule_dialect   JobDefinition.schedule_dialect
 * @property {string}        timezone           JobDefinition.timezone (IANA — drives the tz indicator, G-18)
 * @property {boolean}       enabled            JobDefinition.enabled
 * @property {JobMode}       mode               'agent' (default) | 'script' (JobDefinition.mode === 'script'). Gates run-now confirm (G-13)
 * @property {string|null}   model              JobDefinition.model ('sonnet'|'opus'|'haiku'|null)
 * @property {string|null}   _disabled_reason   JobDefinition._disabledReason (why a disabled row is off)
 * @property {JobHealth}     health             COMPUTED roll-up (WP-08): enabled + last_status + consecutive_errors
 * @property {number|null}   next_run_at_ms     runtime state nextRunAtMs (drives countdown + timeline placement)
 * @property {number|null}   last_run_at_ms     runtime state lastRunAtMs ("last ran" — G-16)
 * @property {RunStatus|null} last_status       runtime state lastStatus (normalized)
 * @property {number}        consecutive_errors runtime state consecutiveErrors (≥2 → failure alert — G-13/Failures view)
 * @property {number|null}   last_duration_ms   runtime state lastDurationMs
 * @property {number|null}   total_cost_usd     runtime state totalCostUsd (lifetime)
 * @property {number|null}   cost_24h_usd       COMPUTED (WP-08): sum cost_usd of this job's cron_job_runs in last 24h (G-16)
 * @property {RunView[]}     last_runs          last N RunView rows (the sparkline; bar height = duration_ms — G-15)
 */

// ---------- ExternalSchedulerView ← static declaration (G-09) ----------

/**
 * A read-only row for a scheduler the daemon can't fire or observe (G-09): the systemd
 * domain-warmup timer, the Rex-VPS db-backup crontab. NO run history, NO controls.
 * @typedef {Object} ExternalSchedulerView
 * @property {string}        id                 e.g. "ops:db-backup-4hourly"
 * @property {string}        label              human label
 * @property {string}        namespace          id.split(':')[0]
 * @property {ExternalKind}  kind               'rex-vps' | 'systemd' | 'crontab' | 'other'
 * @property {string}        schedule           raw expr / OnCalendar string (display only)
 * @property {string}        managed_at         where it actually runs (e.g. "Rex VPS · /home/rex/db-backup/")
 * @property {string|null}   note               why it's external (maps to JobDefinition._disabledReason)
 */

/** @typedef {Object} ScheduleData  the full payload the Schedule view consumes
 * @property {boolean}                 daemon_up
 * @property {number|null}             daemon_pid
 * @property {JobView[]}               jobs
 * @property {ExternalSchedulerView[]} external
 * @property {{enabled:number,disabled:number,failing:number,next_label:string,next_in_ms:number|null,agent_spend_24h_usd:number}} summary
 */

// ---------- fixture (mock contract #P2-1) — lets WP-10/11/13 build before WP-08 ----------
// 3 jobs (agent ok / script running / agent failing) + 1 disabled + 1 external; ikenga.db-shaped.

export const FIXTURE = /** @type {ScheduleData} */ ({
  daemon_up: true,
  daemon_pid: 798467,
  summary: { enabled: 39, disabled: 6, failing: 5, next_label: 'pa:email-triage', next_in_ms: 192000, agent_spend_24h_usd: 1.84 },
  jobs: [
    {
      id: 'pa:email-triage', label: 'Triage inbox → tasks', namespace: 'pa',
      schedule: '5 8,12,17 * * *', schedule_dialect: '5f', timezone: 'Africa/Lagos',
      enabled: true, mode: 'agent', model: 'sonnet', _disabled_reason: null,
      health: 'ok', next_run_at_ms: 1780000192000, last_run_at_ms: 1779999760000,
      last_status: 'ok', consecutive_errors: 0, last_duration_ms: 3200,
      total_cost_usd: 4.91, cost_24h_usd: 0.31,
      last_runs: [
        { id: 'r1', job_id: 'pa:email-triage', agent: 'pa', status: 'ok', error: null, summary: null, duration_ms: 3200, cost_usd: 0.04, input_tokens: 1200, output_tokens: 400, cache_read_tokens: 800, num_turns: 3, session_id: 's1', report_id: null, created_at: '2026-05-29T07:05:00Z' },
        { id: 'r2', job_id: 'pa:email-triage', agent: 'pa', status: 'ok', error: null, summary: null, duration_ms: 4100, cost_usd: 0.05, input_tokens: 1400, output_tokens: 500, cache_read_tokens: 900, num_turns: 3, session_id: 's2', report_id: null, created_at: '2026-05-29T03:05:00Z' }
      ]
    },
    {
      id: 'cfo:stripe-check', label: 'Stripe balance + disputes', namespace: 'cfo',
      schedule: '*/30 * * * *', schedule_dialect: '5f', timezone: 'Africa/Lagos',
      enabled: true, mode: 'script', model: null, _disabled_reason: null,
      health: 'running', next_run_at_ms: 1780001520000, last_run_at_ms: 1779999900000,
      last_status: 'running', consecutive_errors: 0, last_duration_ms: 1100,
      total_cost_usd: null, cost_24h_usd: null,
      last_runs: [
        { id: 'r3', job_id: 'cfo:stripe-check', agent: 'cfo', status: 'ok', error: null, summary: null, duration_ms: 1100, cost_usd: null, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, num_turns: 0, session_id: null, report_id: null, created_at: '2026-05-29T07:30:00Z' }
      ]
    },
    {
      id: 'sales:sequence-advancer', label: 'Advance outreach sequences', namespace: 'sales',
      schedule: '0 */2 * * *', schedule_dialect: '5f', timezone: 'Africa/Lagos',
      enabled: true, mode: 'agent', model: 'sonnet', _disabled_reason: null,
      health: 'failing', next_run_at_ms: 1780005880000, last_run_at_ms: 1779998800000,
      last_status: 'fail', consecutive_errors: 12, last_duration_ms: 400,
      total_cost_usd: 0, cost_24h_usd: 0,
      last_runs: [
        { id: 'r4', job_id: 'sales:sequence-advancer', agent: 'sales', status: 'fail', error: 'ikenga-actions binary not found', summary: null, duration_ms: 400, cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, num_turns: 0, session_id: null, report_id: null, created_at: '2026-05-29T06:00:00Z' }
      ]
    },
    {
      id: 'sales:directory-crawl', label: 'Directory crawl', namespace: 'sales',
      schedule: '0 6 * * 1', schedule_dialect: '5f', timezone: 'Africa/Lagos',
      enabled: false, mode: 'agent', model: null,
      _disabled_reason: 'Requires /directory-crawl command implementation — .company/sales/plans/04',
      health: 'disabled', next_run_at_ms: null, last_run_at_ms: null,
      last_status: null, consecutive_errors: 0, last_duration_ms: null,
      total_cost_usd: null, cost_24h_usd: null, last_runs: []
    },
    {
      id: 'fundraising:research', label: 'Investor research', namespace: 'fundraising',
      schedule: '0 11 * * 1-5', schedule_dialect: '5f', timezone: 'Africa/Lagos',
      enabled: true, mode: 'agent', model: 'sonnet', _disabled_reason: null,
      health: 'pending', next_run_at_ms: 1780010080000, last_run_at_ms: null,
      last_status: null, consecutive_errors: 0, last_duration_ms: null,
      total_cost_usd: null, cost_24h_usd: null, last_runs: []
    }
  ],
  external: [
    { id: 'ops:db-backup-4hourly', label: 'DB backup (4-hourly)', namespace: 'ops', kind: 'rex-vps', schedule: '0 */4 * * *', managed_at: 'Rex VPS · /home/rex/db-backup/', note: 'Runs on Rex VPS crontab' },
    { id: 'sales:domain-warmup', label: 'Domain warmup', namespace: 'sales', kind: 'systemd', schedule: 'OnCalendar=hourly', managed_at: 'systemd user timer · domain-warmup.timer', note: 'Moved out of crontab' }
  ]
});

/** Runtime validator for one JobView (used by the DoD "fixture row validates" check). */
export function isJobView(o) {
  return !!o && typeof o.id === 'string' && typeof o.label === 'string'
    && typeof o.namespace === 'string' && typeof o.enabled === 'boolean'
    && (o.mode === 'agent' || o.mode === 'script')
    && Array.isArray(o.last_runs);
}

/** Runtime validator for one RunView. */
export function isRunView(o) {
  return !!o && typeof o.id === 'string' && typeof o.job_id === 'string'
    && typeof o.status === 'string'
    && (o.duration_ms === null || typeof o.duration_ms === 'number')
    && (o.cost_usd === null || typeof o.cost_usd === 'number');
}
