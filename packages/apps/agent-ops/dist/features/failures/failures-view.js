// WP-11 — Failures view: alert cards for jobs with consecutive_errors >= 2
// + recent failed/error/timeout/skipped runs list with drill-down.
//
// Two sections:
//   1. Alert cards  — jobs with consecutive_errors >= 2 (the "failure alert" DoD)
//   2. Failed runs  — recent cron_job_runs filtered to error|fail|timeout|skipped
//
// Skipped rows (status === 'skipped', forbid-overlap) are rendered explicitly
// with the "skipped — overlap" label via RunListItem's is-skipped path.
//
// Shares RunListItem + RunDetail + statusBadge from runs-view.js.

import { html, cn, Icon, useState, useEffect } from '../../lib/ui.js';
import { isStandalone } from '../../lib/bridge.js';
import { loadScheduleData, loadRecentRuns } from '../../lib/queries.js';
import { RunListItem, RunDetail } from '../runs/runs-view.js';

// ── tiny local formatters ────────────────────────────────────────────────────

/** @param {number|null} ms */
function fmtAgoMs(ms) {
  if (ms == null) return 'never';
  const delta = Date.now() - ms;
  const s = Math.round(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/** @param {string|null} iso */
function fmtAgoIso(iso) {
  if (!iso) return 'never';
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return iso;
  return fmtAgoMs(ts);
}

// ── FailureAlertCard ─────────────────────────────────────────────────────────

/**
 * Alert card for a single failing job (consecutive_errors >= 2).
 *
 * @param {{ job: import('../../lib/view-model.js').JobView }} props
 */
function FailureAlertCard({ job }) {
  const [ns, slug] = job.id.includes(':')
    ? job.id.split(/:(.+)/)
    : ['', job.id];

  // Last error from most recent run.
  const lastError = job.last_runs?.[0]?.error ?? null;
  const lastRunAt = job.last_run_at_ms != null
    ? fmtAgoMs(job.last_run_at_ms)
    : 'never';

  return html`
    <div class="ao-fail-card">
      <div class="fc-top">
        <div class="fc-job">
          <span class="fc-ns">${ns ? `${ns}:` : ''}</span>${slug}
        </div>
        <span class="fc-count">▲ ${job.consecutive_errors}×</span>
      </div>
      <div class="fc-label">${job.label}</div>
      ${lastError && html`
        <div class="fc-error">${lastError}</div>
      `}
      <div class="fc-last">last run: ${lastRunAt}</div>
    </div>
  `;
}

// ── FailuresView ─────────────────────────────────────────────────────────────

/** Status values that belong in the Failures view. */
const FAILURE_STATUSES = new Set(['error', 'fail', 'timeout', 'skipped']);

/**
 * Failures view — alert cards for failing jobs + failed-run drill-down list.
 *
 * @param {{ bridgeReady?: boolean }} props
 */
export function FailuresView({ bridgeReady = true } = {}) {
  /** @type {[import('../../lib/view-model.js').JobView[], Function]} */
  const [failingJobs, setFailingJobs] = useState(
    /** @type {import('../../lib/view-model.js').JobView[]} */ ([]),
  );
  /** @type {[import('../../lib/view-model.js').RunView[], Function]} */
  const [failedRuns, setFailedRuns] = useState(
    /** @type {import('../../lib/view-model.js').RunView[]} */ ([]),
  );
  const [loading, setLoading] = useState(!isStandalone());
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [selectedId, setSelectedId] = useState(/** @type {string|null} */ (null));

  useEffect(() => {
    if (isStandalone()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([loadScheduleData(), loadRecentRuns(80)])
      .then(([scheduleData, recentRuns]) => {
        if (cancelled) return;

        // Jobs with consecutive_errors >= 2 (the failure-alert threshold from G-VIEW).
        const failing = scheduleData.jobs.filter((j) => j.consecutive_errors >= 2);

        // Runs with a failure status — includes skipped (forbid-overlap).
        const failed = recentRuns.filter((r) => FAILURE_STATUSES.has(r.status));

        setFailingJobs(failing);
        setFailedRuns(failed);
        setLoading(false);

        // Auto-select first failed run.
        if (failed.length > 0) setSelectedId(failed[0].id);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [bridgeReady]);

  const selectedRun = failedRuns.find((r) => r.id === selectedId) ?? null;

  if (loading) {
    return html`
      <div class="ao-fail-screen">
        <div class="ao-fail-loading">
          <${Icon} name="loader" size=${16} className="ao-spin" />
          Loading failures…
        </div>
      </div>
    `;
  }

  if (error) {
    return html`
      <div class="ao-fail-screen">
        <div class="ao-error">
          <${Icon} name="alert-circle" size=${16} />
          Failed to load: ${error}
        </div>
      </div>
    `;
  }

  // All-healthy state — no failing jobs AND no failed runs.
  if (failingJobs.length === 0 && failedRuns.length === 0) {
    return html`
      <div class="ao-fail-screen">
        <div class="ao-fail-header">
          <h1>Failures</h1>
          <span class="sub">all clear</span>
        </div>
        <div class="ao-fail-healthy">
          <${Icon} name="check-circle" size=${32} />
          <div class="msg">No failing jobs — all healthy</div>
          <div class="sub">Jobs with 2+ consecutive errors appear here as alert cards.</div>
        </div>
      </div>
    `;
  }

  const skippedCount = failedRuns.filter((r) => r.status === 'skipped').length;
  const subLabel = [
    failingJobs.length > 0 && `${failingJobs.length} failing job${failingJobs.length > 1 ? 's' : ''}`,
    failedRuns.length > 0 && `${failedRuns.length} failed run${failedRuns.length > 1 ? 's' : ''}`,
    skippedCount > 0 && `${skippedCount} skipped`,
  ].filter(Boolean).join(' · ');

  return html`
    <div class="ao-fail-screen">
      <div class="ao-fail-header">
        <h1>Failures</h1>
        <span class="sub">${subLabel}</span>
      </div>

      <div class="ao-fail-body">
        ${failingJobs.length > 0 && html`
          <div class="ao-section-h" style=${{ marginTop: '8px' }}>
            <h2>Failing jobs · ${failingJobs.length}</h2>
            <span class="rule"></span>
            <span class="meta">2+ consecutive errors → alert card</span>
          </div>
          <div class="ao-fail-cards">
            ${failingJobs.map((job) => html`
              <${FailureAlertCard} key=${job.id} job=${job} />
            `)}
          </div>
        `}

        ${failedRuns.length > 0 && html`
          <div class="ao-section-h">
            <h2>Failed runs · ${failedRuns.length}</h2>
            <span class="rule"></span>
            <span class="meta">error · fail · timeout · skipped · click to drill down</span>
          </div>

          <div style=${{ display: 'flex', gap: '0', minHeight: 0 }}>
            <div class="ao-fail-runs-list" style=${{ flex: '0 0 340px', alignSelf: 'flex-start' }}>
              ${failedRuns.map((run) => html`
                <${RunListItem}
                  key=${run.id}
                  run=${run}
                  selected=${run.id === selectedId}
                  onClick=${() => setSelectedId(run.id === selectedId ? null : run.id)}
                />
              `)}
            </div>

            <div style=${{ flex: 1, padding: '0 0 0 16px', minWidth: 0 }}>
              ${selectedRun
                ? html`<${RunDetail} run=${selectedRun} />`
                : html`
                    <div class="ao-fail-empty" style=${{ padding: '3rem 1rem' }}>
                      <${Icon} name="alert-triangle" size=${24} />
                      <div>Select a failed run to inspect it</div>
                    </div>
                  `
              }
            </div>
          </div>
        `}

        ${failedRuns.length === 0 && failingJobs.length > 0 && html`
          <div class="ao-fail-empty">
            <${Icon} name="check" size=${22} />
            <div>No failed runs in the last 80 rows.</div>
            <div class="sub">Only the alert cards above had consecutive errors.</div>
          </div>
        `}
      </div>
    </div>
  `;
}
