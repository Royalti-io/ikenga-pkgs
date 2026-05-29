// WP-11 — Runs view: chronological list of recent cron_job_runs across all jobs.
// Drill-down: clicking a row expands a right-side detail panel showing
// summary, error (pre block), duration, attempt/turns, tokens, session_id.
//
// Exports: RunsView (root component), RunDetail (shared with failures-view.js),
// RunListItem (shared with failures-view.js), statusBadge (pure helper).
//
// No import from schedule-view.js — formatters are duplicated here to avoid
// coupling to the WP-10 file. Kept tiny (< 10 lines each).

import { html, cn, Icon, useState, useEffect } from '../../lib/ui.js';
import { isStandalone } from '../../lib/bridge.js';
import { loadRecentRuns } from '../../lib/queries.js';

// ── tiny local formatters (mirrors schedule-view.js — do NOT import from there) ──

/** @param {number|null} ms */
function fmtAgoMs(ms) {
  if (ms == null) return '—';
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
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return iso;
  return fmtAgoMs(ts);
}

/** @param {number|null} ms */
function fmtDur(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** @param {number|null} usd */
function fmtCost(usd) {
  if (usd == null) return '—';
  return `$${usd.toFixed(3)}`;
}

/** @param {number} n */
function fmtNum(n) {
  if (n == null) return '0';
  return n.toLocaleString();
}

// ── statusBadge ──────────────────────────────────────────────────────────────

/**
 * Return badge class + label for a RunStatus.
 * Mirrors the schedule-view healthBadge pattern for the same ao-badge/b-* classes.
 *
 * @param {import('../../lib/view-model.js').RunStatus} status
 * @returns {{ cls: string, label: string }}
 */
export function statusBadge(status) {
  switch (status) {
    case 'ok':      return { cls: 'b-ok',      label: 'ok' };
    case 'error':   return { cls: 'b-fail',     label: 'error' };
    case 'fail':    return { cls: 'b-fail',     label: 'fail' };
    case 'timeout': return { cls: 'b-fail',     label: 'timeout' };
    case 'running': return { cls: 'b-run',      label: 'running' };
    case 'skipped': return { cls: 'b-pending',  label: 'skipped' };
    default:        return { cls: 'b-off',      label: status ?? '—' };
  }
}

// ── RunListItem ──────────────────────────────────────────────────────────────

/**
 * A single row in the Runs list or Failures run list.
 * Shared export — FailuresView imports this to avoid duplication.
 *
 * @param {{
 *   run: import('../../lib/view-model.js').RunView,
 *   selected: boolean,
 *   onClick: () => void,
 * }} props
 */
export function RunListItem({ run, selected, onClick }) {
  const badge = statusBadge(run.status);
  const isSkipped = run.status === 'skipped';
  const [ns, slug] = run.job_id.includes(':')
    ? run.job_id.split(/:(.+)/)        // split on first colon only
    : ['', run.job_id];

  return html`
    <div
      class=${cn('ao-run-row', selected && 'selected', isSkipped && 'is-skipped')}
      role="button"
      tabIndex=${0}
      onClick=${onClick}
      onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <div class="rr-badge-col">
        <span class=${cn('ao-badge', badge.cls)} title=${badge.label}>
          <span class="d"></span>
        </span>
      </div>
      <div class="rr-main">
        <div class="rr-job">
          <span class="rr-ns">${ns ? `${ns}:` : ''}</span>${slug}
          ${isSkipped && html`<span class="ao-skip-label">skipped — overlap</span>`}
        </div>
        <div class="rr-meta">
          <span>${fmtAgoIso(run.created_at)}</span>
          <span class="sep">·</span>
          <span>${fmtDur(run.duration_ms)}</span>
          ${run.num_turns > 0 && html`<span class="sep">·</span><span>${run.num_turns} turns</span>`}
        </div>
      </div>
      <div class=${cn('rr-cost', run.cost_usd == null && 'none')}>
        ${fmtCost(run.cost_usd)}
      </div>
    </div>
  `;
}

// ── RunDetail ────────────────────────────────────────────────────────────────

/**
 * Full drill-down detail panel for a single RunView.
 * Shared export — FailuresView imports this.
 *
 * @param {{ run: import('../../lib/view-model.js').RunView }} props
 */
export function RunDetail({ run }) {
  const badge = statusBadge(run.status);
  const [ns, slug] = run.job_id.includes(':')
    ? run.job_id.split(/:(.+)/)
    : ['', run.job_id];

  const totalTokens = (run.input_tokens ?? 0) + (run.output_tokens ?? 0) + (run.cache_read_tokens ?? 0);

  return html`
    <div class="ao-run-detail">
      <div class="rd-title">
        <span style=${{ color: 'var(--fg-faint, var(--fg-subtle))' }}>${ns ? `${ns}:` : ''}</span>${slug}
      </div>
      <div class="rd-subtitle">
        <span class=${cn('ao-badge', badge.cls)}>
          <span class="d"></span>${badge.label}
        </span>
        ${' '}·${' '}${fmtAgoIso(run.created_at)}
      </div>

      <div class="rd-grid">
        <div class="rd-cell">
          <div class="k">Duration</div>
          <div class="v">${fmtDur(run.duration_ms)}</div>
        </div>
        <div class="rd-cell">
          <div class="k">Cost</div>
          <div class=${cn('v', run.cost_usd != null ? 'cost' : '')}>${fmtCost(run.cost_usd)}</div>
        </div>
        <div class="rd-cell">
          <div class="k">Turns</div>
          <div class="v">${run.num_turns ?? 0}</div>
        </div>
        <div class="rd-cell">
          <div class="k">Agent</div>
          <div class="v">${run.agent || '—'}</div>
        </div>
      </div>

      ${(run.input_tokens > 0 || run.output_tokens > 0 || run.cache_read_tokens > 0) && html`
        <div class="rd-section">
          <div class="rd-section-h">Tokens · ${fmtNum(totalTokens)} total</div>
          <div class="ao-token-row">
            <span class="ao-token-chip"><span class="tck">in</span>${fmtNum(run.input_tokens)}</span>
            <span class="ao-token-chip"><span class="tck">out</span>${fmtNum(run.output_tokens)}</span>
            <span class="ao-token-chip"><span class="tck">cache_read</span>${fmtNum(run.cache_read_tokens)}</span>
          </div>
        </div>
      `}

      ${run.summary && html`
        <div class="rd-section">
          <div class="rd-section-h">Summary</div>
          <pre class="ao-pre">${run.summary}</pre>
        </div>
      `}

      ${run.error && html`
        <div class="rd-section">
          <div class="rd-section-h">Error</div>
          <pre class="ao-pre error">${run.error}</pre>
        </div>
      `}

      ${!run.summary && !run.error && html`
        <div class="rd-section">
          <pre class="ao-pre empty">No summary or error recorded for this run.</pre>
        </div>
      `}

      ${run.session_id && html`
        <div class="rd-section">
          <div class="rd-section-h">Session</div>
          <div style=${{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--fg-muted)', wordBreak: 'break-all' }}>
            ${run.session_id}
          </div>
        </div>
      `}

      ${run.report_id && html`
        <div class="rd-section">
          <div class="rd-section-h">Report</div>
          <div style=${{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--fg-muted)', wordBreak: 'break-all' }}>
            ${run.report_id}
          </div>
        </div>
      `}

      <div class="rd-section">
        <div class="rd-section-h">Run ID</div>
        <div style=${{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--fg-faint, var(--fg-subtle))', wordBreak: 'break-all' }}>
          ${run.id}
        </div>
      </div>
    </div>
  `;
}

// ── RunsView ─────────────────────────────────────────────────────────────────

/**
 * Runs view — chronological list of recent cron_job_runs across all jobs.
 * Left: list of RunListItem rows. Right: RunDetail drill-down.
 *
 * @param {{ bridgeReady?: boolean }} props
 */
export function RunsView({ bridgeReady = true } = {}) {
  /** @type {[import('../../lib/view-model.js').RunView[], Function]} */
  const [runs, setRuns] = useState(/** @type {import('../../lib/view-model.js').RunView[]} */ ([]));
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
    loadRecentRuns(80)
      .then((rows) => {
        if (!cancelled) {
          setRuns(rows);
          setLoading(false);
          // Auto-select the first row for immediate context.
          if (rows.length > 0) setSelectedId(rows[0].id);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [bridgeReady]);

  const selectedRun = runs.find((r) => r.id === selectedId) ?? null;

  if (loading) {
    return html`
      <div class="ao-runs-screen">
        <div class="ao-runs-loading">
          <${Icon} name="loader" size=${16} className="ao-spin" />
          Loading recent runs…
        </div>
      </div>
    `;
  }

  if (error) {
    return html`
      <div class="ao-runs-screen">
        <div class="ao-error">
          <${Icon} name="alert-circle" size=${16} />
          Failed to load runs: ${error}
        </div>
      </div>
    `;
  }

  return html`
    <div class="ao-runs-screen">
      <div class="ao-runs-header">
        <h1>Runs</h1>
        <span class="sub">${runs.length} recent · all jobs · newest first</span>
      </div>

      <div class="ao-runs-body">
        <div class="ao-runs-list">
          ${runs.length === 0 && html`
            <div class="ao-runs-empty">
              <${Icon} name="list" size=${28} />
              <div>No run history yet.</div>
              <div class="sub">Runs appear here once the scheduler fires a job.</div>
            </div>
          `}
          ${runs.map((run) => html`
            <${RunListItem}
              key=${run.id}
              run=${run}
              selected=${run.id === selectedId}
              onClick=${() => setSelectedId(run.id === selectedId ? null : run.id)}
            />
          `)}
        </div>

        <div class=${cn('ao-runs-detail-pane', !selectedRun && 'empty')}>
          ${selectedRun
            ? html`<${RunDetail} run=${selectedRun} />`
            : html`<span style=${{ color: 'var(--fg-muted)', fontSize: '12px' }}>Select a run to see details</span>`
          }
        </div>
      </div>
    </div>
  `;
}
