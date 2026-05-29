// queries.js — Bridge I/O layer for the agent-ops data layer (WP-08).
//
// Calls bridge.js (hostDbQuery, hostAgentOpsListJobs) and delegates all
// shaping to shape.js (pure, bridge-free, headlessly testable).
//
// WP-10/11/13 consumers: import loadScheduleData, loadRunsForJob,
// loadAgentRuns. WP-08 verification: import shape fns from shape.js directly.

import { hostDbQuery, hostAgentOpsListJobs } from './bridge.js';
import { shapeScheduleData, shapeAgentRunView } from './shape.js';

// Re-export pure shapers so WP-10/11 can import from one place if desired.
export {
  normalizeStatus,
  shapeRunView,
  computeHealth,
  shapeJobView,
  shapeScheduleData,
  shapeAgentRunView,
  EXTERNAL_SCHEDULERS,
} from './shape.js';

// ── loadScheduleData ─────────────────────────────────────────────────────────

/**
 * Load the full ScheduleData payload for the Schedule view.
 *
 * 1. Calls host.agentOps.listJobs (WP-09 host verb) to get job config + state.
 * 2. Queries cron_job_runs for recent run history (last 600 rows ~ ~12 per job).
 * 3. Shapes everything via shapeScheduleData (pure).
 *
 * Never throws to the caller — on any error returns a safe daemon-down payload.
 *
 * @returns {Promise<import('./view-model.js').ScheduleData>}
 */
export async function loadScheduleData() {
  let listJobsRes;
  let runRows;

  try {
    [listJobsRes, runRows] = await Promise.all([
      hostAgentOpsListJobs(),
      hostDbQuery(
        'SELECT * FROM cron_job_runs ORDER BY created_at DESC LIMIT 600',
        [],
      ),
    ]);
  } catch (err) {
    console.warn('[agent-ops] loadScheduleData: bridge call failed', err);
    // Return a safe daemon-down skeleton so the view can render gracefully.
    return shapeScheduleData(
      { ok: false, daemon_up: false, daemon_pid: null, jobs: [], error: String(err) },
      [],
    );
  }

  try {
    return shapeScheduleData(listJobsRes, runRows);
  } catch (err) {
    console.warn('[agent-ops] loadScheduleData: shaping failed', err);
    return shapeScheduleData(
      { ok: false, daemon_up: false, daemon_pid: null, jobs: [], error: String(err) },
      [],
    );
  }
}

// ── loadRunsForJob ────────────────────────────────────────────────────────────

/**
 * Load run history for a single job (WP-11 run-detail panel).
 *
 * @param {string} jobId
 * @param {number} [limit=50]
 * @returns {Promise<import('./view-model.js').RunView[]>}
 */
export async function loadRunsForJob(jobId, limit = 50) {
  const { shapeRunView } = await import('./shape.js');
  const rows = await hostDbQuery(
    'SELECT * FROM cron_job_runs WHERE job_id = ? ORDER BY created_at DESC LIMIT ?',
    [jobId, limit],
  );
  return rows.map(shapeRunView);
}

// ── loadAgentRuns ─────────────────────────────────────────────────────────────

/**
 * Load recent agent_runs rows (WP-11 Live view).
 *
 * @param {number} [limit=50]
 * @returns {Promise<import('./view-model.js').AgentRunView[]>}
 */
export async function loadAgentRuns(limit = 50) {
  const rows = await hostDbQuery(
    'SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT ?',
    [limit],
  );
  return rows.map(shapeAgentRunView);
}

// ── loadRecentRuns ────────────────────────────────────────────────────────────

/**
 * Load recent cron_job_runs across ALL jobs (WP-11 Runs + Failures views).
 * Returns rows newest-first, shaped as RunView[].
 *
 * @param {number} [limit=80]
 * @returns {Promise<import('./view-model.js').RunView[]>}
 */
export async function loadRecentRuns(limit = 80) {
  const { shapeRunView } = await import('./shape.js');
  const rows = await hostDbQuery(
    'SELECT * FROM cron_job_runs ORDER BY created_at DESC LIMIT ?',
    [limit],
  );
  return rows.map(shapeRunView);
}
