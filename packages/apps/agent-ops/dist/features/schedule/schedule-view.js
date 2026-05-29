// Agent Ops — Schedule view (+ Runs/Failures/Live placeholders).
//
// G-VIEW contract: all types pin to dist/lib/view-model.js (FROZEN). This
// file renders FIXTURE from view-model.js for WP-07. The swap to live pa.db
// reads happens in WP-08 at the clearly marked line below.
//
// Side-menu (Ngwa-style: Views + Filters, published via host.pkg.setMenu).
// Filters dim on Runs/Failures/Live (list-only, mirrors tasks-pkg filtersInert).
//
// Layout mirrors tasks-view.js structure verbatim where the patterns are
// identical: VIEW_ITEMS / FILTER_ITEMS / buildMenu / publish useEffect /
// activeFeature dispatch useEffect.

import { html, cn, Icon, Button, useState, useMemo, useEffect } from '../../lib/ui.js';
import { isStandalone, setMenu } from '../../lib/bridge.js';
import { FIXTURE, isJobView } from '../../lib/view-model.js';
import { loadScheduleData } from '../../lib/queries.js';
import { RunsView } from '../runs/runs-view.js';
import { FailuresView } from '../failures/failures-view.js';

// ── side-menu model ──────────────────────────────────────────────────────────
// Views section.
const VIEW_ITEMS = [
  { id: 'v:schedule',  label: 'Schedule',  icon: 'clock' },
  { id: 'v:runs',      label: 'Runs',      icon: 'list' },
  { id: 'v:failures',  label: 'Failures',  icon: 'alert-triangle' },
  { id: 'v:live',      label: 'Live',      icon: 'radio' },
];

// Filter section (dims on non-schedule views).
const FILTER_ITEMS = [
  { id: 'f:all',      label: 'All jobs',             icon: 'list',          section: 'Filter' },
  { id: 'f:enabled',  label: 'Enabled',              icon: 'check-circle',  section: 'Filter' },
  { id: 'f:disabled', label: 'Disabled',             icon: 'x-circle',      section: 'Filter' },
  { id: 'f:ext',      label: 'Externally managed',   icon: 'git-branch',    section: 'Filter' },
];

/**
 * Build the flat side-menu item list — mirrors buildTasksMenu exactly.
 * @param {'schedule'|'runs'|'failures'|'live'} view
 * @param {string|null} activeFilter
 * @param {number|null} failureBadge
 * @param {number|null} liveBadge
 */
function buildAgentOpsMenu(view, activeFilter, failureBadge, liveBadge) {
  const filtersInert = view !== 'schedule';
  const viewRows = VIEW_ITEMS.map((it) => ({
    ...it,
    section: 'View',
    active: `v:${view}` === it.id,
    badge: it.id === 'v:failures' && failureBadge ? failureBadge : undefined,
    count: it.id === 'v:live' && liveBadge ? liveBadge : undefined,
  }));
  const filterRows = FILTER_ITEMS.map((it) => ({
    ...it,
    disabled: filtersInert,
    active: !filtersInert && activeFilter === it.id,
  }));
  return [...viewRows, ...filterRows];
}

// ── view type ────────────────────────────────────────────────────────────────
/** @typedef {'schedule'|'runs'|'failures'|'live'} AgentOpsView */

const VIEW_STORAGE_KEY = 'ikenga-agentops-view';

/** @returns {AgentOpsView} */
function loadView() {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    if (v === 'schedule' || v === 'runs' || v === 'failures' || v === 'live') {
      return /** @type {AgentOpsView} */ (v);
    }
  } catch {
    /* localStorage unavailable (sandboxed iframe) */
  }
  return 'schedule';
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a millisecond countdown into a human label.
 * @param {number|null} ms
 */
function fmtCountdown(ms) {
  if (ms == null || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * Format a "last ran N ago" string from a ms timestamp.
 * @param {number|null} ms
 */
function fmtAgo(ms) {
  if (ms == null) return 'never run';
  const delta = Date.now() - ms;
  const s = Math.round(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/**
 * Format a duration in ms.
 * @param {number|null} ms
 */
function fmtDur(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format a cost.
 * @param {number|null} usd
 */
function fmtCost(usd) {
  if (usd == null) return '—';
  return `$${usd.toFixed(2)}`;
}

/** Build the sparkline bar array from RunView[].
 * @param {import('../../lib/view-model.js').RunView[]} runs
 * @param {number|null} maxDur
 */
function buildBars(runs, maxDur) {
  if (!runs || runs.length === 0) return null;
  const max = maxDur ?? Math.max(...runs.map((r) => r.duration_ms ?? 0), 1);
  return runs.map((r) => {
    const pct = max > 0 ? Math.round(((r.duration_ms ?? 0) / max) * 100) : 18;
    const cls = r.status === 'fail' || r.status === 'error' ? 'f'
              : r.status === 'running' ? 's'
              : !r.duration_ms ? 'n'
              : '';
    return { pct: Math.max(pct, 6), cls };
  });
}

/** Derive the health badge class + label.
 * @param {import('../../lib/view-model.js').JobView} job
 */
function healthBadge(job) {
  switch (job.health) {
    case 'ok':       return { cls: 'b-ok',      label: 'ok' };
    case 'running':  return { cls: 'b-run',     label: 'running' };
    case 'failing':  return { cls: 'b-fail',    label: 'fail' };
    case 'disabled': return { cls: 'b-off',     label: 'disabled' };
    case 'pending':  return { cls: 'b-pending', label: 'pending first run' };
    case 'external': return { cls: 'b-ext',     label: 'externally managed' };
    default:         return { cls: 'b-ok',      label: job.health ?? '—' };
  }
}

// ── Timeline component ───────────────────────────────────────────────────────

/**
 * Namespace-bucketed 12-hour timeline (G-12 / G-19).
 * Derived from D-01 mock — static from FIXTURE for WP-07.
 * @param {{ jobs: import('../../lib/view-model.js').JobView[] }} props
 */
function Timeline({ jobs }) {
  const [openNs, setOpenNs] = useState(/** @type {Set<string>} */ (new Set()));

  // Group jobs by namespace, compute lane items.
  const now = Date.now();
  const horizon = now + 12 * 60 * 60 * 1000; // 12h from now

  /** @type {Map<string, import('../../lib/view-model.js').JobView[]>} */
  const byNs = useMemo(() => {
    const m = new Map();
    for (const j of jobs) {
      if (!j.enabled) continue; // skip disabled in timeline
      const ns = j.namespace;
      if (!m.has(ns)) m.set(ns, []);
      m.get(ns).push(j);
    }
    return m;
  }, [jobs]);

  const namespaces = Array.from(byNs.keys());

  /** Convert a next_run_at_ms to a left% position on the 12h axis. */
  function toLeft(ms) {
    if (ms == null) return null;
    const pct = ((ms - now) / (horizon - now)) * 100;
    return Math.max(1, Math.min(99, Math.round(pct)));
  }

  function toggleNs(ns) {
    setOpenNs((prev) => {
      const next = new Set(prev);
      if (next.has(ns)) next.delete(ns);
      else next.add(ns);
      return next;
    });
  }

  if (namespaces.length === 0) {
    return html`<div class="ao-empty-box"><span>No scheduled jobs in the next 12 hours.</span></div>`;
  }

  return html`
    <div class="ao-timeline">
      <div class="ao-tl-axis">
        <span>now</span>
        <span>+2h</span>
        <span>+4h</span>
        <span>+6h</span>
        <span>+8h</span>
        <span>+10h</span>
        <span class="tz">+12h · WAT</span>
      </div>
      <div class="ao-tl-now"></div>
      ${namespaces.map((ns) => {
        const nsJobs = byNs.get(ns) ?? [];
        const isOpen = openNs.has(ns);
        return html`
          <div class="ao-tl-row" key=${ns} data-ns=${ns}>
            <span
              class="ao-tl-label"
              role="button"
              tabIndex=${0}
              onClick=${() => toggleNs(ns)}
              onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') toggleNs(ns); }}
            >
              <span class="chev">${isOpen ? '▾' : '▸'}</span>
              ${ns}
              <span class="cnt">·${nsJobs.length}</span>
            </span>
            <div class="ao-tl-lane">
              ${nsJobs.slice(0, 4).map((j) => {
                const left = toLeft(j.next_run_at_ms);
                if (left == null) return null;
                const delta = j.next_run_at_ms - now;
                const isSoon = delta < 10 * 60 * 1000; // < 10 min
                const isWarn = j.health === 'failing';
                const cls = isWarn ? 'warn' : isSoon ? 'soon' : 'later';
                const label = isSoon ? fmtCountdown(delta) : new Date(j.next_run_at_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return html`
                  <div
                    key=${j.id}
                    class=${cn('ao-tl-fire', cls)}
                    style=${{ left: `${left}%` }}
                    title=${`${j.id} · ${label}`}
                  >
                    ${label}${isWarn ? ' ⚠' : ''}
                  </div>
                `;
              })}
            </div>
          </div>
          ${isOpen && html`
            <div class="ao-tl-sub open" key=${`sub-${ns}`}>
              ${nsJobs.map((j) => {
                const left = toLeft(j.next_run_at_ms);
                if (left == null) return null;
                const delta = j.next_run_at_ms - now;
                const isSoon = delta < 10 * 60 * 1000;
                const cls = j.health === 'failing' ? 'warn' : isSoon ? 'soon' : 'later';
                const label = isSoon ? fmtCountdown(delta) : new Date(j.next_run_at_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return html`
                  <div class="ao-tl-row" key=${`sub-${j.id}`}>
                    <span class="ao-tl-label">${j.label}</span>
                    <div class="ao-tl-lane">
                      <div
                        class=${cn('ao-tl-fire', cls)}
                        style=${{ left: `${left}%` }}
                        title=${j.id}
                      >
                        ${label}
                      </div>
                    </div>
                  </div>
                `;
              })}
            </div>
          `}
        `;
      })}
    </div>
  `;
}

// ── Run-now confirm modal (G-13) ─────────────────────────────────────────────

/**
 * @param {{
 *   job: import('../../lib/view-model.js').JobView|null,
 *   onCancel: () => void,
 *   onConfirm: (job: import('../../lib/view-model.js').JobView) => void,
 * }} props
 */
function RunNowModal({ job, onCancel, onConfirm }) {
  if (!job) return null;
  const isBillable = job.mode === 'agent';
  const lastCost = job.last_runs?.[0]?.cost_usd ?? null;

  // Close on scrim click or Escape.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return html`
    <div
      class="ao-scrim open"
      onClick=${(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ao-modal-title"
    >
      <div class="ao-modal">
        <h3 id="ao-modal-title">
          Run <span style=${{ fontFamily: 'var(--font-mono)' }}>${job.id}</span> now?
        </h3>
        <p>
          ${isBillable
            ? 'This is an AGENT job — it fires a billable claude -p run immediately, out of schedule.'
            : 'This is a SCRIPT job — local shell command, no API cost.'}
        </p>
        ${isBillable && html`
          <div class="costline">
            <span>estimated cost</span>
            <b>
              ${lastCost != null ? `~$${lastCost.toFixed(2)}` : '~$?'}
              ${job.model ? ` · ${job.model}` : ''}
              ${job.last_runs?.[0]?.num_turns ? ` · ~${job.last_runs[0].num_turns} turns` : ''}
            </b>
          </div>
        `}
        <div class="row">
          <button class="ao-btn sz-sm v-outline" onClick=${onCancel}>Cancel</button>
          <button
            class=${cn('ao-btn', 'sz-sm', 'run', isBillable && 'billable')}
            onClick=${() => onConfirm(job)}
          >
            ${isBillable ? 'Confirm billable run' : 'Run now'}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ── Job table row ────────────────────────────────────────────────────────────

/**
 * @param {{
 *   job: import('../../lib/view-model.js').JobView,
 *   daemonUp: boolean,
 *   onRunNow: (job: import('../../lib/view-model.js').JobView) => void,
 * }} props
 */
function JobRow({ job, daemonUp, onRunNow }) {
  const badge = healthBadge(job);
  const bars = buildBars(job.last_runs, null);
  const nextLabel = job.next_run_at_ms != null
    ? fmtCountdown(job.next_run_at_ms - Date.now())
    : '—';

  return html`
    <tr>
      <td>
        <button
          class=${cn('ao-tog', !job.enabled && 'off')}
          role="switch"
          aria-checked=${String(job.enabled)}
          aria-label=${`${job.id} ${job.enabled ? 'enabled' : 'disabled'}`}
          disabled=${!daemonUp || true}
          title="Toggle requires WP-09"
        ></button>
      </td>
      <td>
        <div class="ao-jid">
          <span class="ao-jns">${job.namespace}:</span>${job.id.replace(`${job.namespace}:`, '')}
          <span class=${cn('ao-mode', job.mode)}>${job.mode}</span>
        </div>
        <div class="ao-label">${job.label}</div>
      </td>
      <td class="ao-next">${job.schedule}</td>
      <td class="ao-next">
        ${job.next_run_at_ms != null
          ? html`<span class="cd">${nextLabel}</span>`
          : html`<span style=${{ color: 'var(--fg-faint, var(--fg-muted))' }}>—</span>`}
      </td>
      <td class="ao-ago">
        ${job.last_run_at_ms != null
          ? html`${fmtAgo(job.last_run_at_ms)} ${job.last_duration_ms != null ? html`<span class="dur">· ${fmtDur(job.last_duration_ms)}</span>` : ''}`
          : html`<span style=${{ color: 'var(--fg-faint, var(--fg-muted))' }}>never run</span>`}
      </td>
      <td>
        ${bars
          ? html`<div class="ao-bars" title="height=duration, color=status">
              ${bars.map((b, i) => html`<div key=${i} class=${cn('ao-bar', b.cls)} style=${{ height: `${b.pct}%` }}></div>`)}
            </div>`
          : html`<span class="ao-emptybars">${job.last_runs.length === 0 ? 'no run history yet' : '—'}</span>`}
      </td>
      <td>
        <span class=${cn('ao-badge', badge.cls)}>
          <span class="d"></span>
          ${badge.label}
        </span>
        ${job.consecutive_errors >= 2 && html`
          <div class="ao-alert">
            ▲ ${job.consecutive_errors}× · "${job.last_runs?.[0]?.error ?? 'error'}"
          </div>
        `}
      </td>
      <td class=${cn('ao-cost', job.cost_24h_usd == null && 'none')}>
        ${job.cost_24h_usd != null
          ? fmtCost(job.cost_24h_usd)
          : job.mode === 'script' ? '— script' : '—'}
      </td>
      <td>
        <div class="ao-ctrls">
          ${job.enabled && html`
            <button
              class=${cn('ao-btn', 'sz-sm', 'run', job.mode === 'agent' && 'billable')}
              disabled=${!daemonUp}
              title=${!daemonUp ? 'Daemon down — run-now disabled' : undefined}
              onClick=${() => daemonUp && onRunNow(job)}
            >▶ run</button>
          `}
          ${!job.enabled && html`
            <button
              class="ao-btn sz-sm"
              disabled=${!daemonUp || true}
              title="Enable requires WP-09"
            >enable</button>
          `}
          <button class="ao-btn sz-sm" title="View logs — WP-11">log</button>
        </div>
      </td>
    </tr>
  `;
}

// ── External job row ─────────────────────────────────────────────────────────

/**
 * @param {{ ext: import('../../lib/view-model.js').ExternalSchedulerView }} props
 */
function ExtRow({ ext }) {
  return html`
    <tr class="ext">
      <td><span class="ao-ext-tag">EXT</span></td>
      <td>
        <div class="ao-jid">
          <span class="ao-jns">${ext.namespace}:</span>${ext.id.replace(`${ext.namespace}:`, '')}
        </div>
        <div class="ao-label">${ext.managed_at}</div>
      </td>
      <td class="ao-next">${ext.schedule}</td>
      <td class="ao-next" style=${{ color: 'var(--fg-faint, var(--fg-muted))' }}>— off-host</td>
      <td class="ao-ago" style=${{ color: 'var(--fg-faint, var(--fg-muted))' }}>—</td>
      <td><span class="ao-emptybars">not observable here</span></td>
      <td>
        <span class=${cn('ao-badge', 'b-ext')}>
          <span class="d"></span>externally managed
        </span>
      </td>
      <td class="ao-cost none">—</td>
      <td>
        <div class="ao-ctrls" style=${{ opacity: 1 }}>
          <span style=${{ fontSize: '10.5px', color: 'var(--fg-faint, var(--fg-muted))' }}>read-only</span>
        </div>
      </td>
    </tr>
  `;
}

// ── Schedule view ────────────────────────────────────────────────────────────

/**
 * Schedule view — KPI strip + 12h timeline + job table.
 * Renders FIXTURE for WP-07. WP-08 replaces FIXTURE with live pa.db reads.
 *
 * @param {{ daemonUp: boolean, daemonPid: number|null, data: import('../../lib/view-model.js').ScheduleData, activeFilter: string, onRunNow: (job: any) => void }} props
 */
function ScheduleContent({ daemonUp, daemonPid, data, activeFilter, onRunNow }) {
  const { jobs, external, summary } = data;

  // Apply filter from activeFilter.
  const filteredJobs = useMemo(() => {
    if (activeFilter === 'f:enabled') return jobs.filter((j) => j.enabled);
    if (activeFilter === 'f:disabled') return jobs.filter((j) => !j.enabled);
    // 'f:ext' shows the external table section only — all daemon jobs still shown
    return jobs;
  }, [jobs, activeFilter]);

  const showExt = activeFilter === 'f:all' || activeFilter === 'f:ext' || !activeFilter;
  const showTimeline = activeFilter !== 'f:disabled' && activeFilter !== 'f:ext';

  const nextLabel = summary.next_label
    ? `${fmtCountdown(summary.next_in_ms ?? null)} · ${summary.next_label}`
    : '—';

  return html`
    <div class="ao-body">
      <div class="ao-kpis">
        <div class="ao-kpi ok">
          <div class="n">${summary.enabled}</div>
          <div class="l">enabled</div>
        </div>
        <div class="ao-kpi">
          <div class="n">${summary.disabled}</div>
          <div class="l">disabled</div>
        </div>
        <div class=${cn('ao-kpi', summary.failing > 0 ? 'bad' : 'ok')}>
          <div class="n">${summary.failing}</div>
          <div class="l">failing</div>
        </div>
        <div class="ao-kpi ok">
          <div class="n">${nextLabel}</div>
          <div class="l">next</div>
        </div>
        <div class=${cn('ao-kpi', summary.agent_spend_24h_usd > 2 ? 'warn' : 'ok')}>
          <div class="n">\$${summary.agent_spend_24h_usd.toFixed(2)}</div>
          <div class="l">agent spend · 24h</div>
        </div>
      </div>

      ${showTimeline && html`
        <div class="ao-section-h">
          <h2>Next 12 hours</h2>
          <span class="rule"></span>
          <span class="meta">grouped by namespace · click a lane to expand</span>
        </div>
        <${Timeline} jobs=${jobs} />
      `}

      <div class="ao-section-h">
        <h2>All jobs · ${jobs.length + external.length}</h2>
        <span class="rule"></span>
        <span class="meta">filter via the side-menu · click a header to sort</span>
      </div>
      <table class="ao-table">
        <thead>
          <tr>
            <th style=${{ width: '30px' }}></th>
            <th>job</th>
            <th>schedule</th>
            <th>next fire</th>
            <th>last ran</th>
            <th>last 12 · ⬍ dur</th>
            <th>status</th>
            <th style=${{ textAlign: 'right' }}>24h cost</th>
            <th style=${{ textAlign: 'right' }}>controls</th>
          </tr>
        </thead>
        <tbody>
          ${filteredJobs.map((job) => html`
            <${JobRow}
              key=${job.id}
              job=${job}
              daemonUp=${daemonUp}
              onRunNow=${onRunNow}
            />
          `)}
          ${showExt && external.length > 0 && html`
            <tr class="ao-grp">
              <td colspan="9">
                Externally managed · read-only · ${external.length} · not fired or observed by this daemon
              </td>
            </tr>
            ${external.map((ext) => html`<${ExtRow} key=${ext.id} ext=${ext} />`)}
          `}
        </tbody>
      </table>

      <div class="ao-legend">
        <span><i style=${{ background: 'var(--systemic)' }}></i> ok</span>
        <span><i style=${{ background: 'var(--achievement)' }}></i> slow/warn</span>
        <span><i style=${{ background: 'var(--danger)' }}></i> fail</span>
        <span style=${{ fontFamily: 'var(--font-mono)' }}>⬍ height = duration</span>
        <span><i style=${{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}></i> external (G-09)</span>
        <span>
          <span class="ao-mode agent" style=${{ margin: 0 }}>agent</span> billable ·${' '}
          <span class="ao-mode script" style=${{ margin: 0 }}>script</span> free
        </span>
      </div>
    </div>
  `;
}

// ── Placeholder views ────────────────────────────────────────────────────────
// RunsPlaceholder + FailuresPlaceholder removed — WP-11 ships the real views.

function LivePlaceholder() {
  return html`
    <div class="ao-placeholder">
      <${Icon} name="radio" size=${32} />
      <div class="label">Live · WP-13</div>
    </div>
  `;
}

// ── Root export ──────────────────────────────────────────────────────────────

/** @param {{ activeFeature?: string|null, bridgeReady?: boolean }} props */
export function ScheduleView({ activeFeature, bridgeReady = true } = {}) {
  const [view, setView] = useState(loadView);
  const [activeFilter, setActiveFilter] = useState('f:all');

  // WP-08: live data load. Initial paint uses FIXTURE (immediate, no flash).
  // Once the bridge is available, loadScheduleData() fetches from pa.db via
  // host.agentOps.listJobs + host.dbQuery. Standalone dev keeps FIXTURE.
  /** @type {[import('../../lib/view-model.js').ScheduleData, Function]} */
  const [data, setData] = useState(FIXTURE);
  const [dataLoading, setDataLoading] = useState(!isStandalone());

  useEffect(() => {
    if (isStandalone()) {
      // No bridge in standalone dev — keep FIXTURE so the view renders.
      return;
    }
    let cancelled = false;
    setDataLoading(true);
    loadScheduleData()
      .then((sd) => {
        if (!cancelled) {
          setData(sd);
          setDataLoading(false);
        }
      })
      .catch((err) => {
        // loadScheduleData never throws, but guard defensively.
        console.warn('[agent-ops] ScheduleView: unexpected loadScheduleData error', err);
        if (!cancelled) setDataLoading(false);
      });
    return () => { cancelled = true; };
  // Reload when bridgeReady flips true (app.js tells us bridge is up).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeReady]);

  // Dev-time shape validation (dropped in prod builds — there are none since
  // this is a no-build pkg, but the cost is negligible).
  if (data.jobs.length > 0 && !isJobView(data.jobs[0])) {
    console.warn('[agent-ops] data.jobs[0] failed isJobView validation');
  }

  const [runNowJob, setRunNowJob] = useState(/** @type {import('../../lib/view-model.js').JobView|null} */ (null));

  /** @param {AgentOpsView} v */
  function changeView(v) {
    setView(v);
    try { localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* ignore */ }
  }

  // Shell side-menu selection → view + filter dispatch.
  // id taxonomy:
  //   v:schedule | v:runs | v:failures | v:live  — switch the mounted view
  //   f:all | f:enabled | f:disabled | f:ext     — filter the job table (schedule-only)
  useEffect(() => {
    if (!activeFeature) return;

    if (activeFeature.startsWith('v:')) {
      const v = activeFeature.slice(2);
      if (v === 'schedule' || v === 'runs' || v === 'failures' || v === 'live') {
        changeView(/** @type {AgentOpsView} */ (v));
      }
      return;
    }

    if (activeFeature.startsWith('f:')) {
      setView('schedule');
      setActiveFilter(activeFeature);
      return;
    }
  }, [activeFeature]);

  // Publish the shell side-menu. Derives failure badge from FIXTURE.failing.
  // Re-sends whenever view, activeFilter, or failing count changes.
  useEffect(() => {
    if (isStandalone()) return;
    const failureBadge = data.summary.failing > 0 ? data.summary.failing : null;
    setMenu(buildAgentOpsMenu(view, activeFilter, failureBadge, null))
      .catch((e) => console.warn('[agent-ops] setMenu failed', e));
  }, [view, activeFilter, data.summary.failing]);

  const daemonUp = data.daemon_up;

  function handleRunNow(job) {
    setRunNowJob(job);
  }
  function handleRunConfirm(job) {
    setRunNowJob(null);
    // WP-09: dispatch run-now via host tool (host.agentOpsRunNow or hostSendToActiveSession)
    console.info('[agent-ops] run-now confirmed for', job.id, '(WP-09: not yet wired)');
  }

  return html`
    <div class=${cn('ao-screen', !daemonUp && 'is-down')}>
      <div class="ao-panebar">
        <h1>Schedule</h1>
        <span class="sub">next 12h · all ${data.jobs.length + data.external.length} jobs</span>
        <span class="ao-spacer"></span>
        ${dataLoading && html`<span class="ao-loading" title="loading live data from ikenga.db">loading live…</span>`}
        <span class=${cn('ao-pill', daemonUp ? 'up' : 'down')}>
          <span class="ao-dot"></span>
          ${daemonUp
            ? `daemon up · PID ${data.daemon_pid ?? '?'}`
            : 'daemon down · run-now disabled'}
        </span>
      </div>

      ${!daemonUp && html`
        <div class="ao-downbanner">
          ⚠ The always-on daemon isn't responding. Schedule + history are last-known;
          run-now and enable/disable are disabled until the watchdog respawns it (≤5 min).
        </div>
      `}

      ${view === 'schedule' && html`
        <${ScheduleContent}
          daemonUp=${daemonUp}
          daemonPid=${data.daemon_pid}
          data=${data}
          activeFilter=${activeFilter}
          onRunNow=${handleRunNow}
        />
      `}
      ${view === 'runs'     && html`<${RunsView} bridgeReady=${bridgeReady} />`}
      ${view === 'failures' && html`<${FailuresView} bridgeReady=${bridgeReady} />`}
      ${view === 'live'     && html`<${LivePlaceholder} />`}

      <${RunNowModal}
        job=${runNowJob}
        onCancel=${() => setRunNowJob(null)}
        onConfirm=${handleRunConfirm}
      />
    </div>
  `;
}
