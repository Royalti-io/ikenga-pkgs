// Sales main view — Pipeline (list + kanban) / Forecast / Won.
//
// Composition follows plans/atelier-design-system/parts/screens/sales.md §§1–4:
//   Views: ?view=0 Pipeline (list default + kanban toggle) | ?view=1 Forecast | ?view=2 Won
//
//   Kit parts consumed:
//   - .frame / .frame-head / .frame-body-flush (part 30 pkg-pane-frame)
//   - .ip-split / .ip-split-list / .ip-split-divider / .ip-split-pane (part 25 inspector-detail)
//   - .split-row / .split-row-* / .split-group / .split-detail / .split-detail-* (list-detail)
//   - .dense-row.dense-row--pipeline / .dense-row-* (part 20 table-dense-row)
//   - .kb-board / .kb-col / .kb-card / .kb-mini-avatar / .kb-add (part 28 kanban)
//   - .nav-group[data-kind] / .nav-item / .nav-item.is-on / .nav-item.is-hot (part 22)
//   - .seg.nav-view-seg / .seg button.is-on (part 14 segmented-tabs, list-kanban-switch)
//   - .atelier-state.is-{loading,empty,error,streaming} / .atelier-spin (part 26 feedback-state)
//   - .stage-chip / .next-chip / .ux-dot / .badge / .tag / .chip (part 11 badge-tag-chip)
//   - .btn / .btn-icon / .btn-sm / .btn.affirmative (part 10 buttons)
//
//   Domain-local (sales.css .sl-*):
//   - .sl-forecast-* / .sl-kpi-* / .sl-funnel-* / .sl-month-* (Forecast view)
//   - .sl-won-* / .sl-won-badge / .sl-won-amt (Won view)
//   - .ux-dot.ux-{confirm,silent,approve} / .next-chip / .stage-chip / .split-* overrides
//
// Data: host.dbQuery + host.dbExec via AppBridge. TanStack Query for caching.
// Migration: 0043_sales_domain.sql — app-layer columns (title, owner, next_action,
//   next_action_mode, win_probability) on sales_deals. Stage enum: lead → qualified →
//   proposal → negotiation → closing → won | lost.

import {
  html, cn, Icon,
  useState, useEffect, useMemo, useCallback,
  useQuery, useMutation, useQueryClient,
} from '../../lib/ui.js';
import { hostDbQuery, hostDbExec, setMenu, isStandalone } from '../../lib/bridge.js';

// ─── Stage enum ───────────────────────────────────────────────────────────────
// Per the R-04 Pipeline-stages convention (06-skill-action-contract.md §Pipeline-stages).
// Defined + documented here as the owning pkg (the domain WP defines the enum in README).
// Terminals: won | lost. Won view = sales_deals WHERE stage = 'won'.

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'closing'];
const TERMINAL_STAGES = ['won', 'lost'];

const STAGE_LABEL = {
  lead: 'Lead',
  qualified: 'Qualified',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closing: 'Closing',
  won: 'Won',
  lost: 'Lost',
};

// ─── Fixture data (canonical — mirrors sales.md §1) ──────────────────────────
// Used as app-layer fallback until 0043 migration applies and real columns exist.
// Mock contract 1: app-layer fallbacks until migration lands. Must flip to real
// columns before sign-off (DoD: "MOCK: contract 1 … must flip to real columns").

const OPEN_DEALS_FIXTURE = [
  { id: 'D-01', title: 'Catalog migration',          company: 'Dapper Music',        stage: 'lead',        value: 30000,  currency: 'USD', owner: 'nedjamez',   next_action: 'Discovery call',                    next_action_mode: 'confirm',  win_probability: 0.15, assigned_to: 'nedjamez',   age_days: 12 },
  { id: 'D-02', title: 'Self-serve → team',           company: 'Tay Iwar',            stage: 'lead',        value: 6000,   currency: 'USD', owner: 'nedjamez',   next_action: 'Qualify fit',                       next_action_mode: 'silent',   win_probability: 0.10, assigned_to: 'nedjamez',   age_days: 5  },
  { id: 'D-03', title: 'Analytics pilot',             company: 'Aristokrat Records',  stage: 'qualified',   value: 18000,  currency: 'USD', owner: 'sales-agent',next_action: 'Schedule demo',                     next_action_mode: 'silent',   win_probability: 0.40, assigned_to: 'sales-agent',age_days: 8  },
  { id: 'D-04', title: 'Pilot → migration',           company: 'Baseline Music',      stage: 'qualified',   value: 12000,  currency: 'USD', owner: 'sales-agent',next_action: 'Send pilot scope',                  next_action_mode: 'confirm',  win_probability: 0.35, assigned_to: 'sales-agent',age_days: 14 },
  { id: 'D-05', title: 'Catalog onboarding',          company: 'Chocolate City',      stage: 'proposal',    value: 48000,  currency: 'USD', owner: 'sales-agent',next_action: 'Send MSA for signature',            next_action_mode: 'approve',  win_probability: 0.60, assigned_to: 'sales-agent',age_days: 21 },
  { id: 'D-06', title: 'Enterprise — multi-label',    company: 'Mavin Records',       stage: 'negotiation', value: 72000,  currency: 'USD', owner: 'nedjamez',   next_action: 'Pricing call Tue 11:00',            next_action_mode: 'confirm',  win_probability: 0.70, assigned_to: 'nedjamez',   age_days: 19 },
  { id: 'D-07', title: 'Reseller agreement',          company: 'Empire Distribution', stage: 'negotiation', value: 200000, currency: 'USD', owner: 'nedjamez',   next_action: 'Legal review of reseller terms',    next_action_mode: 'approve',  win_probability: 0.65, assigned_to: 'nedjamez',   age_days: 34 },
  { id: 'D-08', title: 'Countersign — enterprise',    company: 'Native Records',      stage: 'closing',     value: 120000, currency: 'USD', owner: 'sales-agent',next_action: 'Countersign + provision tenant',    next_action_mode: 'approve',  win_probability: 0.85, assigned_to: 'sales-agent',age_days: 41 },
];

const WON_DEALS_FIXTURE = [
  { id: 'W-01', title: 'Mavin catalog sync',        company: 'Mavin Records',       source: 'referral',   owner: 'nedjamez',    closed: 'Apr 28', value: 54000  },
  { id: 'W-02', title: 'Tooth & Nail migration',    company: 'Tooth & Nail',        source: 'inbound',    owner: 'sales-agent', closed: 'Apr 21', value: 36000  },
  { id: 'W-03', title: 'Indie bundle',              company: 'Indie Co',            source: 'self-serve', owner: 'nedjamez',    closed: 'Apr 14', value: 18000  },
  { id: 'W-04', title: 'Analytics annual',          company: 'Aristokrat Records',  source: 'outbound',   owner: 'sales-agent', closed: 'Apr 9',  value: 42000  },
  { id: 'W-05', title: 'Reseller — West Africa',    company: 'Synco Distribution',  source: 'partner',    owner: 'nedjamez',    closed: 'Mar 30', value: 96000  },
  { id: 'W-06', title: 'Pilot conversion',          company: 'Baseline Music',      source: 'pilot',      owner: 'sales-agent', closed: 'Mar 22', value: 66000  },
];

// ─── Query keys ───────────────────────────────────────────────────────────────

const QK = {
  openDeals:     ['sales', 'deals', 'open'],
  wonDeals:      ['sales', 'deals', 'won'],
  forecasts:     ['sales', 'forecasts'],
  activities:    (dealId) => ['sales', 'activities', dealId],
};

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchOpenDeals() {
  if (isStandalone()) return OPEN_DEALS_FIXTURE;
  try {
    // Try real columns from 0043 migration first (title, owner, next_action, next_action_mode, win_probability).
    const rows = await hostDbQuery(
      `SELECT id, company, contact_name, contact_email, stage, value, currency, score,
              last_contact, assigned_to, notes, source, loss_reason, description,
              title, owner, next_action, next_action_mode, win_probability,
              days_in_stage, stage_entered_date, expected_close_date
       FROM sales_deals
       WHERE stage NOT IN ('won', 'lost')
       ORDER BY last_contact DESC`
    );
    if (!rows.length) return OPEN_DEALS_FIXTURE;
    // Merge fixture app-layer fields as fallback when columns are NULL (pre-migration).
    return rows.map((r, i) => {
      const fix = OPEN_DEALS_FIXTURE[i % OPEN_DEALS_FIXTURE.length];
      return {
        ...r,
        title: r.title ?? r.company,
        owner: r.owner ?? r.assigned_to ?? fix.owner,
        next_action: r.next_action ?? fix.next_action,
        next_action_mode: r.next_action_mode ?? fix.next_action_mode,
        win_probability: r.win_probability ?? fix.win_probability,
        age_days: r.days_in_stage ?? fix.age_days ?? 0,
        value: typeof r.value === 'string' ? parseFloat(r.value) || 0 : (r.value ?? 0),
      };
    });
  } catch {
    // Bridge unavailable or table missing — return fixture.
    return OPEN_DEALS_FIXTURE;
  }
}

async function fetchWonDeals() {
  if (isStandalone()) return WON_DEALS_FIXTURE;
  try {
    const rows = await hostDbQuery(
      `SELECT id, company, contact_name, stage, value, currency, source, assigned_to,
              last_contact, owner, title
       FROM sales_deals
       WHERE stage = 'won'
       ORDER BY last_contact DESC`
    );
    if (!rows.length) return WON_DEALS_FIXTURE;
    return rows.map((r) => ({
      ...r,
      title: r.title ?? r.company,
      owner: r.owner ?? r.assigned_to ?? 'nedjamez',
      closed: r.last_contact ? r.last_contact.substring(0, 10) : '—',
      value: typeof r.value === 'string' ? parseFloat(r.value) || 0 : (r.value ?? 0),
    }));
  } catch {
    return WON_DEALS_FIXTURE;
  }
}

async function fetchActivities(dealId) {
  if (isStandalone() || !dealId) return [];
  try {
    return await hostDbQuery(
      `SELECT id, activity_type, title, description, performed_by, activity_date
       FROM sales_activities
       WHERE deal_id = ?
       ORDER BY activity_date DESC
       LIMIT 3`,
      [dealId]
    );
  } catch {
    return [];
  }
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtCurrency(v) {
  if (!v && v !== 0) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(v) {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}

// ─── Menu builder ─────────────────────────────────────────────────────────────

/**
 * Build the sidebar menu items for setMenu.
 *   activeView: 0 = Pipeline | 1 = Forecast | 2 = Won
 *   pipeMode: 'list' | 'kanban' (only relevant when activeView === 0)
 *   deals: the open deals array (for counts)
 */
function buildSalesMenu(activeView, pipeMode, deals) {
  const openCount = deals.length;
  const myDeals = deals.filter((d) => d.owner === 'nedjamez' || d.assigned_to === 'nedjamez');
  const closingSoon = deals.filter((d) => d.next_action_mode === 'approve');
  const agentRun = deals.filter((d) => (d.owner === 'sales-agent' || d.assigned_to === 'sales-agent'));

  const viewItems = [
    {
      id: 'v:pipeline',
      label: 'Pipeline',
      icon: 'trending-up',
      section: 'View',
      active: activeView === 0,
      badge: openCount > 0 ? openCount : undefined,
    },
    {
      id: 'v:forecast',
      label: 'Forecast',
      icon: 'dollar-sign',
      section: 'View',
      active: activeView === 1,
    },
    {
      id: 'v:won',
      label: 'Won',
      icon: 'check-circle',
      section: 'View',
      active: activeView === 2,
    },
  ];

  // Seg control injected as a synthetic menu item when activeView === 0.
  // The shell side-menu renders items with kind="seg" as an inline segmented control.
  // We encode it as a special item the shell knows about (list-kanban-switch part §2).
  const segItem = activeView === 0
    ? [{
        id: 'seg:list-kanban',
        kind: 'seg',
        section: 'View',
        options: [
          { id: 'list',   label: 'List',   active: pipeMode === 'list' },
          { id: 'kanban', label: 'Kanban', active: pipeMode === 'kanban' },
        ],
      }]
    : [];

  const filterItems = [
    {
      id: 'f:open-pipeline',
      label: 'Open pipeline',
      icon: 'layers',
      section: 'Filters',
      active: true,
      badge: openCount,
      disabled: activeView !== 0,
    },
    {
      id: 'f:my-deals',
      label: 'My deals',
      icon: 'user',
      section: 'Filters',
      active: false,
      badge: myDeals.length || undefined,
      disabled: activeView !== 0,
    },
    {
      id: 'f:closing-soon',
      label: 'Closing soon',
      icon: 'zap',
      section: 'Filters',
      active: false,
      hot: closingSoon.length > 0,
      badge: closingSoon.length > 0 ? closingSoon.length : undefined,
      disabled: activeView !== 0,
    },
    {
      id: 'f:agent-run',
      label: 'Agent-run',
      icon: 'cpu',
      section: 'Filters',
      active: false,
      badge: agentRun.length || undefined,
      disabled: activeView !== 0,
    },
  ];

  const stageItems = STAGES.map((s) => ({
    id: `f:stage:${s}`,
    label: STAGE_LABEL[s],
    section: 'By stage',
    active: false,
    badge: deals.filter((d) => d.stage === s).length || undefined,
    disabled: activeView !== 0,
  }));

  return [...viewItems, ...segItem, ...filterItems, ...stageItems];
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Single deal row in list mode */
function DealRow({ deal, isSelected, onClick }) {
  const isUrgent = (deal.age_days ?? 0) > 30;
  return html`
    <div
      class=${cn('split-row dense-row dense-row--pipeline', isSelected && 'is-selected')}
      role="row"
      tabIndex=${0}
      onClick=${onClick}
      onKeyDown=${(e) => e.key === 'Enter' && onClick()}
    >
      <span class="split-row-accent" aria-hidden="true"></span>
      <div class="split-row-body dense-row-body">
        <div class="split-row-title dense-row-title">${deal.title ?? deal.company}</div>
        <div class="split-row-sub dense-row-sub">
          ${deal.company}
          ${deal.owner ? html` · <span>${deal.owner === 'sales-agent' ? '⚡ sales-agent' : deal.owner}</span>` : null}
        </div>
      </div>
      <div class="dense-row-right" style=${{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'3px' }}>
        <span class="split-row-amt dense-row-amt">${fmtCurrency(deal.value)}</span>
        <span class=${cn('split-row-when dense-row-due', isUrgent && 'is-urgent')}>
          ${deal.age_days != null ? `${deal.age_days}d` : ''}
        </span>
        ${deal.next_action ? html`
          <span class="next-chip">
            <span class=${cn('ux-dot', `ux-${deal.next_action_mode ?? 'silent'}`)}></span>
            ${deal.next_action}
          </span>
        ` : null}
      </div>
    </div>
  `;
}

/** Deal detail pane */
function DealDetail({ deal, activities }) {
  if (!deal) {
    return html`<div class="ip-split-pane split-detail" style=${{ display:'flex', alignItems:'center', justifyContent:'center', color:'var(--fg-muted)', fontSize:'0.85rem' }}>
      Select a deal
    </div>`;
  }

  const hasApprove = deal.next_action_mode === 'approve';
  const hasConfirm = deal.next_action_mode === 'confirm';
  const showButton = hasApprove || hasConfirm;

  return html`
    <div class="ip-split-pane split-detail" style=${{ overflowY:'auto' }}>
      <div class="split-detail-wrap">
        <div class="split-detail-eyebrow">
          <span class="stage-chip">${STAGE_LABEL[deal.stage] ?? deal.stage}</span>
        </div>
        <div class="split-detail-title">${deal.title ?? deal.company}</div>
        <div class="split-detail-sub">${deal.company}${deal.owner ? ` · ${deal.owner}` : ''}</div>

        <div class="split-facts">
          <div><div class="split-fact-k">Value</div><div class="split-fact-v">${fmtCurrency(deal.value)}</div></div>
          <div><div class="split-fact-k">Stage</div><div class="split-fact-v">${STAGE_LABEL[deal.stage] ?? deal.stage}</div></div>
          <div><div class="split-fact-k">Win prob.</div><div class="split-fact-v">${fmtPct(deal.win_probability)}</div></div>
          <div><div class="split-fact-k">Age</div><div class="split-fact-v">${deal.age_days != null ? `${deal.age_days}d` : '—'}</div></div>
        </div>

        ${deal.next_action ? html`
          <div class="split-next">
            <div class="split-next-head">
              <span class=${cn('ux-dot', `ux-${deal.next_action_mode ?? 'silent'}`)}></span>
              Next action
            </div>
            <div class="split-next-body">
              ${deal.next_action}
              ${showButton ? html`
                <div style=${{ marginTop: '10px' }}>
                  <button class=${cn('btn', hasApprove ? 'affirmative' : '')} type="button">
                    ${hasApprove ? 'Approve & run' : 'Confirm & run'}
                  </button>
                </div>
              ` : null}
            </div>
          </div>
        ` : null}

        ${activities && activities.length > 0 ? html`
          <div class="split-detail-eyebrow" style=${{ marginTop:'12px' }}>Activity</div>
          <div class="split-timeline" role="list">
            ${activities.map((a) => html`
              <div class="split-tl-row" role="listitem" key=${a.id}>
                <span class="split-tl-dot" aria-hidden="true"></span>
                <div class="split-tl-body">
                  <div class="split-tl-title">${a.title ?? a.activity_type}</div>
                  <div class="split-tl-when">${a.activity_date ? a.activity_date.substring(0,10) : ''} · ${a.performed_by ?? ''}</div>
                </div>
              </div>
            `)}
          </div>
        ` : null}
      </div>
    </div>
  `;
}

/** Pipeline list mode */
function PipelineList({ deals, selectedDeal, onSelectDeal, activities }) {
  const grouped = useMemo(() => {
    const map = {};
    for (const s of STAGES) map[s] = [];
    for (const d of deals) {
      if (map[d.stage]) map[d.stage].push(d);
      else map[d.stage] = [d];
    }
    return map;
  }, [deals]);

  return html`
    <div class="ip-split" style=${{ height:'100%' }}>
      <div class="ip-split-list" style=${{ overflowY:'auto' }} role="grid" aria-label="Sales pipeline list">
        ${STAGES.map((s) => grouped[s]?.length > 0 ? html`
          <div class="split-group" key=${s}>
            <div class="split-group-head">${STAGE_LABEL[s]} · ${grouped[s].length}</div>
            ${grouped[s].map((d) => html`
              <${DealRow}
                key=${d.id}
                deal=${d}
                isSelected=${selectedDeal?.id === d.id}
                onClick=${() => onSelectDeal(d)}
              />
            `)}
          </div>
        ` : null)}
      </div>
      <div class="ip-split-divider" role="separator" aria-hidden="true"></div>
      <${DealDetail} deal=${selectedDeal} activities=${activities} />
    </div>
  `;
}

/** Kanban mini-avatar */
function KbAvatar({ owner }) {
  const isAgent = owner === 'sales-agent';
  const initial = isAgent ? 'S' : (owner?.[0]?.toUpperCase() ?? 'N');
  return html`<span class=${cn('kb-mini-avatar', isAgent && 'is-agent')} aria-label=${owner ?? ''}>${initial}</span>`;
}

/** Pipeline kanban mode */
function PipelineKanban({ deals, onStageChange }) {
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const grouped = useMemo(() => {
    const map = {};
    for (const s of STAGES) map[s] = [];
    for (const d of deals) {
      if (map[d.stage]) map[d.stage].push(d);
      else map[d.stage] = [d];
    }
    return map;
  }, [deals]);

  function onDragStart(d) { setDragging(d); }
  function onDragOver(e, s) { e.preventDefault(); setDropTarget(s); }
  function onDrop(e, s) {
    e.preventDefault();
    if (dragging && dragging.stage !== s) onStageChange(dragging, s);
    setDragging(null);
    setDropTarget(null);
  }
  function onDragEnd() { setDragging(null); setDropTarget(null); }

  return html`
    <div class="kb-board-wrap">
      <div class="kb-board" role="region" aria-label="Sales pipeline board">
        ${STAGES.map((s) => {
          const stagDeals = grouped[s] ?? [];
          const totalVal = stagDeals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);
          return html`
            <div
              key=${s}
              class=${cn('kb-col', dropTarget === s && 'is-drop-target')}
              data-stage=${s}
              onDragOver=${(e) => onDragOver(e, s)}
              onDrop=${(e) => onDrop(e, s)}
              role="region"
              aria-label=${'Stage: ' + STAGE_LABEL[s]}
            >
              <div class="kb-col-head">
                <span class="kb-col-dot" aria-hidden="true"></span>
                <span class="kb-col-name">${STAGE_LABEL[s]}</span>
                <span class="kb-col-meta">${stagDeals.length} · ${fmtCurrency(totalVal)}</span>
              </div>
              <div class="kb-col-body">
                ${stagDeals.map((d) => html`
                  <div
                    key=${d.id}
                    class=${cn('kb-card', dragging?.id === d.id && 'is-dragging')}
                    draggable="true"
                    onDragStart=${() => onDragStart(d)}
                    onDragEnd=${onDragEnd}
                    tabIndex=${0}
                  >
                    <div class="kb-card-title">${d.title ?? d.company}</div>
                    <div class="kb-card-sub">${d.company}</div>
                    <div class="kb-card-foot">
                      <span class="kb-card-amt">${fmtCurrency(d.value)}</span>
                      <div class="kb-card-owner">
                        <span class=${cn('ux-dot', `ux-${d.next_action_mode ?? 'silent'}`)}></span>
                        <${KbAvatar} owner=${d.owner ?? d.assigned_to} />
                      </div>
                    </div>
                  </div>
                `)}
                <button class="kb-add btn-icon" type="button" aria-label=${'Add deal to ' + STAGE_LABEL[s]}>+</button>
              </div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

/** Forecast view */
function ForecastView({ deals }) {
  const kpis = useMemo(() => {
    const openPipeline = deals.reduce((s, d) => s + (parseFloat(d.value) || 0), 0);
    const weighted = deals.reduce((s, d) => s + ((parseFloat(d.value) || 0) * (d.win_probability ?? 0.5)), 0);
    const commit = deals
      .filter((d) => (d.stage === 'closing' || d.stage === 'negotiation') && (d.win_probability ?? 0) >= 0.70)
      .reduce((s, d) => s + (parseFloat(d.value) || 0), 0);
    return { openPipeline, weighted, commit, target: 300_000 };
  }, [deals]);

  const funnelRows = useMemo(() => {
    const maxVal = Math.max(...STAGES.map((s) => {
      return deals.filter((d) => d.stage === s).reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);
    }), 1);
    return STAGES.map((s) => {
      const total = deals.filter((d) => d.stage === s).reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);
      const wt = deals.filter((d) => d.stage === s).reduce((sum, d) => sum + ((parseFloat(d.value) || 0) * (d.win_probability ?? 0.5)), 0);
      return { stage: s, total, wt, pctTotal: total / maxVal, pctWt: wt / maxVal };
    });
  }, [deals]);

  // Expected close by month (Apr/May/Jun — derived from fixture)
  const months = [
    { label: 'Apr', val: 180000, maxVal: 280000 },
    { label: 'May', val: 280000, maxVal: 280000 },
    { label: 'Jun', val: 46000,  maxVal: 280000 },
  ];
  const maxMonthVal = Math.max(...months.map((m) => m.val), 1);

  return html`
    <div class="sl-forecast-wrap frame-body-flush">
      <div class="sl-forecast-kpis">
        <div class="sl-forecast-kpi">
          <span class="sl-kpi-k">Open pipeline</span>
          <span class="sl-kpi-v">${fmtCurrency(kpis.openPipeline)}</span>
          <span class="sl-kpi-sub">8 active deals</span>
        </div>
        <div class="sl-forecast-kpi">
          <span class="sl-kpi-k">Weighted</span>
          <span class="sl-kpi-v">${fmtCurrency(kpis.weighted)}</span>
          <span class="sl-kpi-sub">by win prob.</span>
        </div>
        <div class="sl-forecast-kpi">
          <span class="sl-kpi-k">Commit</span>
          <span class="sl-kpi-v">${fmtCurrency(kpis.commit)}</span>
          <span class="sl-kpi-sub">closing + neg ≥70%</span>
        </div>
        <div class="sl-forecast-kpi">
          <span class="sl-kpi-k">Quarter target</span>
          <span class="sl-kpi-v">${fmtCurrency(kpis.target)}</span>
          <span class="sl-kpi-sub">Q2 2026</span>
        </div>
      </div>

      <div class="sl-forecast-card">
        <div class="sl-forecast-card-h">Weighted by stage</div>
        ${funnelRows.map((r) => html`
          <div class="sl-funnel-row" key=${r.stage}>
            <span class="sl-funnel-name">${STAGE_LABEL[r.stage]}</span>
            <div class="sl-funnel-bar">
              <div class="sl-funnel-bar-fill" style=${{ width: `${r.pctTotal * 100}%` }}></div>
              <div class="sl-funnel-bar-wt"  style=${{ width: `${r.pctWt * 100}%` }}></div>
            </div>
            <span class="sl-funnel-val">${fmtCurrency(r.total)} · ${fmtCurrency(r.wt)}</span>
          </div>
        `)}
      </div>

      <div class="sl-forecast-card">
        <div class="sl-forecast-card-h">Expected close by month</div>
        <div class="sl-months">
          ${months.map((m) => html`
            <div class="sl-month" key=${m.label}>
              <span class="sl-month-val">${fmtCurrency(m.val)}</span>
              <div class="sl-month-bar-wrap">
                <div class="sl-month-bar" style=${{ height: `${Math.round((m.val / maxMonthVal) * 64)}px` }}></div>
              </div>
              <span class="sl-month-lab">${m.label}</span>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

/** Won view */
function WonView({ wonDeals }) {
  const kpis = useMemo(() => {
    const total = wonDeals.reduce((s, d) => s + (parseFloat(d.value) || 0), 0);
    const avg = wonDeals.length ? total / wonDeals.length : 0;
    return { total, avg, cycle: 34, winRate: 41 };
  }, [wonDeals]);

  return html`
    <div class="sl-won-wrap frame-body-flush">
      <div class="sl-won-kpis">
        <div class="sl-forecast-kpi">
          <span class="sl-kpi-k">Won this quarter</span>
          <span class="sl-kpi-v">${fmtCurrency(kpis.total)}</span>
          <span class="sl-kpi-sub">${wonDeals.length} deals</span>
        </div>
        <div class="sl-forecast-kpi">
          <span class="sl-kpi-k">Avg deal size</span>
          <span class="sl-kpi-v">${fmtCurrency(kpis.avg)}</span>
        </div>
        <div class="sl-forecast-kpi">
          <span class="sl-kpi-k">Avg cycle</span>
          <span class="sl-kpi-v">${kpis.cycle}d</span>
        </div>
        <div class="sl-forecast-kpi">
          <span class="sl-kpi-k">Win rate</span>
          <span class="sl-kpi-v">${kpis.winRate}%</span>
        </div>
      </div>

      <div class="sl-won-table-wrap">
        <table class="sl-won-table" role="grid" aria-label="Won deals">
          <thead>
            <tr>
              <th>Deal</th>
              <th>Company</th>
              <th>Source</th>
              <th>Owner</th>
              <th>Closed</th>
              <th style=${{ textAlign:'right' }}>Value</th>
            </tr>
          </thead>
          <tbody>
            ${wonDeals.map((d) => html`
              <tr key=${d.id}>
                <td>${d.title ?? d.company}</td>
                <td style=${{ color:'var(--fg-muted)' }}>${d.company}</td>
                <td><span class="sl-won-badge">${d.source ?? '—'}</span></td>
                <td style=${{ color:'var(--fg-muted)', fontSize:'0.75rem' }}>${d.owner ?? d.assigned_to ?? '—'}</td>
                <td style=${{ color:'var(--fg-muted)', fontFamily:'var(--font-mono)', fontSize:'0.72rem' }}>${d.closed ?? d.last_contact ?? '—'}</td>
                <td style=${{ textAlign:'right' }}><span class="sl-won-amt">${fmtCurrency(d.value)}</span></td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Loading / empty / error states ──────────────────────────────────────────

function LoadingState() {
  return html`
    <div class="atelier-state is-loading" id="view-stage">
      <span class="atelier-spin" aria-hidden="true"></span>
      <span>Loading deals…</span>
    </div>
  `;
}

function EmptyState() {
  return html`
    <div class="atelier-state is-empty" id="view-stage">
      <span>No deals yet</span>
      <button class="btn btn-sm" type="button" style=${{ marginTop:'8px' }}>New deal</button>
    </div>
  `;
}

function ErrorState({ error }) {
  return html`
    <div class="atelier-state is-error" id="view-stage">
      <span>Failed to load deals</span>
      <span style=${{ fontSize:'0.72rem', color:'var(--fg-muted)', marginTop:'4px' }}>${error}</span>
    </div>
  `;
}

function StreamingState() {
  return html`
    <div class="atelier-state is-streaming" id="view-stage">
      <span class="atelier-prog" role="status" aria-live="polite">Sales agent running…</span>
    </div>
  `;
}

// ─── SalesView root ───────────────────────────────────────────────────────────

export function SalesView({ activeFeature }) {
  // View state: 0=Pipeline | 1=Forecast | 2=Won
  const [activeView, setActiveView] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('view');
    const v = parseInt(p ?? '0', 10);
    return [0, 1, 2].includes(v) ? v : 0;
  });
  const [pipeMode, setPipeMode] = useState('list'); // 'list' | 'kanban'
  const [selectedDeal, setSelectedDeal] = useState(null);
  const qc = useQueryClient();

  // ── Data queries ────────────────────────────────────────────────────────────
  const openDealsQ = useQuery({ queryKey: QK.openDeals, queryFn: fetchOpenDeals });
  const wonDealsQ = useQuery({ queryKey: QK.wonDeals, queryFn: fetchWonDeals, enabled: activeView === 2 });

  const activitiesQ = useQuery({
    queryKey: QK.activities(selectedDeal?.id ?? null),
    queryFn: () => fetchActivities(selectedDeal?.id),
    enabled: !!selectedDeal?.id,
    staleTime: 60_000,
  });

  const deals = openDealsQ.data ?? [];

  // ── db-updated refresh ──────────────────────────────────────────────────────
  useEffect(() => {
    function onDbUpdated() {
      qc.invalidateQueries({ queryKey: ['sales'] });
    }
    window.addEventListener('db-updated', onDbUpdated);
    return () => window.removeEventListener('db-updated', onDbUpdated);
  }, [qc]);

  // ── activeFeature → view switching (side-menu item clicks) ─────────────────
  useEffect(() => {
    if (!activeFeature) return;
    if (activeFeature === 'v:pipeline') setActiveView(0);
    else if (activeFeature === 'v:forecast') setActiveView(1);
    else if (activeFeature === 'v:won') setActiveView(2);
    else if (activeFeature === 'seg:list') setPipeMode('list');
    else if (activeFeature === 'seg:kanban') setPipeMode('kanban');
  }, [activeFeature]);

  // ── Pre-select hero deal (D-05 — Catalog onboarding · Chocolate City) ──────
  useEffect(() => {
    if (deals.length > 0 && !selectedDeal) {
      const hero = deals.find((d) => d.id === 'D-05') ?? deals[0];
      setSelectedDeal(hero);
    }
  }, [deals]);

  // ── setMenu publish ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (isStandalone()) return;
    const items = buildSalesMenu(activeView, pipeMode, deals);
    setMenu(items).catch(() => {/* ignore */});
  }, [activeView, pipeMode, deals]);

  // ── Stage change mutation (kanban drag) ─────────────────────────────────────
  const stageChange = useMutation({
    mutationFn: async ({ deal, newStage }) => {
      if (isStandalone()) return;
      await hostDbExec(
        `UPDATE sales_deals SET stage = ?, updated_at = datetime('now') WHERE id = ?`,
        [newStage, deal.id]
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.openDeals }),
  });

  // ── Head label ──────────────────────────────────────────────────────────────
  const headLabel = activeView === 0 ? `Sales · ${deals.length} open`
    : activeView === 1 ? 'Forecast'
    : 'Won';

  // ── Render ──────────────────────────────────────────────────────────────────
  let body;

  if (activeView === 0) {
    // Pipeline view
    if (openDealsQ.isLoading) {
      body = html`<${LoadingState} />`;
    } else if (openDealsQ.isError) {
      body = html`<${ErrorState} error=${openDealsQ.error?.message ?? 'unknown'} />`;
    } else if (deals.length === 0) {
      body = html`<${EmptyState} />`;
    } else if (pipeMode === 'kanban') {
      body = html`<${PipelineKanban}
        deals=${deals}
        onStageChange=${(deal, newStage) => stageChange.mutate({ deal, newStage })}
      />`;
    } else {
      body = html`<${PipelineList}
        deals=${deals}
        selectedDeal=${selectedDeal}
        onSelectDeal=${setSelectedDeal}
        activities=${activitiesQ.data ?? []}
      />`;
    }
  } else if (activeView === 1) {
    body = html`<${ForecastView} deals=${deals} />`;
  } else {
    // Won view
    if (wonDealsQ.isLoading) {
      body = html`<${LoadingState} />`;
    } else if (wonDealsQ.isError) {
      body = html`<${ErrorState} error=${wonDealsQ.error?.message ?? 'unknown'} />`;
    } else {
      body = html`<${WonView} wonDeals=${wonDealsQ.data ?? WON_DEALS_FIXTURE} />`;
    }
  }

  return html`
    <div class="frame" style=${{ height:'100%', display:'flex', flexDirection:'column' }}>
      <div class="frame-head" style=${{ display:'flex', alignItems:'center', gap:'8px' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
          <polyline points="16 7 22 7 22 13"></polyline>
        </svg>
        <span>${headLabel}</span>
      </div>
      <div class="frame-body-flush" id="view-stage" style=${{ flex:1, overflow:'hidden' }}>
        ${body}
      </div>
    </div>
  `;
}
