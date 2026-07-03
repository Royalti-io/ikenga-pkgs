
// ── pkg-specific bridge extension: com.ikenga.agent-ops (WP-19) ─────────────
// CONCATENATION FRAGMENT — appended verbatim after bridge.js (the core) by the
// vendor step. It relies on the core's module-scoped `app` binding and the
// `LOG_TAG` import at the top of the composed file; it is NOT a standalone
// module and must never be imported on its own. Keeps agent-ops' cron
// control-plane verbs (host.agentOps.*) working after the bridge core was shared.

/**
 * List all configured cron jobs + their runtime state via the shell's
 * host.agentOps.listJobs verb (WP-09 adds this host-side; we call it here).
 *
 * Returns the structuredContent payload directly:
 *   { ok: true,  daemon_up, daemon_pid, jobs: RawJob[] }
 * | { ok: false, error: string }
 *
 * Throws if the bridge is not connected (caller should handle).
 */
export async function hostAgentOpsListJobs() {
  if (!app) throw new Error(`[${LOG_TAG}] bridge not connected — agentOps.listJobs unavailable`);
  const res = await app.callServerTool({
    name: 'host.agentOps.listJobs',
    arguments: {},
  });
  const sc = res?.structuredContent;
  if (!sc) {
    throw new Error(res?.content?.[0]?.text ?? 'host.agentOps.listJobs returned no structuredContent');
  }
  // ok:false is a valid application-level response (daemon down, etc.); return it
  // so the query layer can handle gracefully rather than throwing.
  return sc;
}

/**
 * Trigger an immediate out-of-schedule run for a job via the shell's
 * host.agentOps.runNow verb (WP-09 host side, WP-12 wires the call).
 *
 * Returns the structuredContent payload directly:
 *   { ok: true,  status: 200, message: string }
 * | { ok: false, code: string, status: number, error: string }
 *
 * Throws if the bridge is not connected (caller should handle).
 *
 * @param {string} jobId
 */
export async function hostAgentOpsRunNow(jobId) {
  if (!app) throw new Error(`[${LOG_TAG}] bridge not connected — agentOps.runNow unavailable`);
  const res = await app.callServerTool({
    name: 'host.agentOps.runNow',
    arguments: { jobId },
  });
  return res?.structuredContent ?? null;
}

/**
 * Enable or disable a job via the shell's host.agentOps.setEnabled verb
 * (WP-09 host side, WP-12 wires the call).
 *
 * Returns the structuredContent payload directly:
 *   { ok: true,  jobId: string, enabled: boolean }
 * | { ok: false, code: string, error: string }
 *
 * Throws if the bridge is not connected (caller should handle).
 *
 * @param {string} jobId
 * @param {boolean} enabled
 */
export async function hostAgentOpsSetEnabled(jobId, enabled) {
  if (!app) throw new Error(`[${LOG_TAG}] bridge not connected — agentOps.setEnabled unavailable`);
  const res = await app.callServerTool({
    name: 'host.agentOps.setEnabled',
    arguments: { jobId, enabled },
  });
  return res?.structuredContent ?? null;
}

/**
 * Create or update a cron job via the shell's host.agentOps.upsertJob verb (WP-14).
 *
 * Sends a full AgentOpsJobInput; the shell writes the job definition to config
 * and notifies the daemon. Returns the structuredContent payload directly:
 *   { ok: true,  jobId: string, created: boolean }
 * | { ok: false, code: string, error: string }
 *
 * Throws if the bridge is not connected (caller should handle).
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   schedule: string,
 *   command: string,
 *   timezone?: string,
 *   enabled?: boolean,
 *   mode?: 'agent'|'script',
 *   model?: string,
 *   agent?: string,
 *   schedule_dialect?: '5f'|'6f',
 *   timeout_ms?: number,
 * }} AgentOpsJobInput
 *
 * @param {AgentOpsJobInput} job
 */
export async function hostAgentOpsUpsertJob(job) {
  if (!app) throw new Error(`[${LOG_TAG}] bridge not connected — agentOps.upsertJob unavailable`);
  const res = await app.callServerTool({
    name: 'host.agentOps.upsertJob',
    arguments: { job },
  });
  return res?.structuredContent ?? null;
}

/**
 * Delete a cron job via the shell's host.agentOps.deleteJob verb (WP-14).
 *
 * Returns the structuredContent payload directly:
 *   { ok: true,  jobId: string }
 * | { ok: false, code: string, error: string }
 *
 * Throws if the bridge is not connected (caller should handle).
 *
 * @param {string} jobId
 */
export async function hostAgentOpsDeleteJob(jobId) {
  if (!app) throw new Error(`[${LOG_TAG}] bridge not connected — agentOps.deleteJob unavailable`);
  const res = await app.callServerTool({
    name: 'host.agentOps.deleteJob',
    arguments: { jobId },
  });
  return res?.structuredContent ?? null;
}

/**
 * Tail the output of a currently-running (or recently-completed) job via the
 * shell's host.agentOps.tailRun verb (WP-13).
 *
 * Returns the structuredContent payload directly:
 *   { ok: true,  running: boolean, status: 'running'|'done'|null,
 *     startedAtMs: number|null, mode: 'agent'|'script'|null,
 *     chunk: string, nextOffset: number, eof: boolean }
 * | { ok: false, code: string, status: number|null, error: string }
 *
 * Returns null if the bridge is not connected (caller must guard).
 *
 * @param {string} jobId
 * @param {number} [offset]
 * @returns {Promise<object|null>}
 */
export async function hostAgentOpsTailRun(jobId, offset) {
  if (!app) throw new Error(`[${LOG_TAG}] bridge not connected — agentOps.tailRun unavailable`);
  const res = await app.callServerTool({
    name: 'host.agentOps.tailRun',
    arguments: { jobId, offset },
  });
  return res?.structuredContent ?? null;
}
