// Strategy main view — OKRs (board default + list toggle) / Cycles / Reviews.
//
// Composition follows plans/atelier-design-system/parts/screens/strategy.md §§1–4:
//   Views: ?view=0 OKRs (board default + list toggle) | ?view=1 Cycles | ?view=2 Reviews
//
//   Kit parts consumed (from app-kit-css.js):
//   - .frame / .frame-head / .frame-body-flush (part 30 pkg-pane-frame)
//   - .kb-board / .kb-col / .kb-card / .kb-mini-avatar / .kb-add (part 28 kanban)
//   - .okr-card-prog / .okr-kr / .okr-kr-row / .okr-bar(.is-mid|.is-low) / .okr-overall .ring
//     (OKR extension — strategy-board-only, owned by the kanban part)
//   - .kb-col-agg (count + avg %) — NOT .kb-col-meta on this board (E-07 aggregate)
//   - .pane-split / .pl-list / .pl-list-head / .pl-sec / .pl-row(.is-selected) /
//     .pl-row-* / .pl-detail / .pl-detail-* / .pl-facts / .pl-fact-* / .pl-next /
//     .pl-next-* / .pl-timeline / .pl-tl-* (part 20 list + detail panel)
//   - .nav-group[data-kind] / .nav-item / .nav-item.is-on / .nav-item.is-hot (part 22)
//   - .seg.nav-view-seg / .seg button.is-on (part 14 segmented-tabs, list-kanban-switch)
//   - .atelier-state.is-{loading,empty,error,streaming} / .atelier-spin (part 26 feedback-state)
//   - .stage-chip / .next-chip / .ux-dot (part 11 badge-tag-chip)
//   - .btn / .btn-sm / .btn.affirmative (part 10 buttons)
//
//   Domain-local (strategy.css .st-* + small shared residue):
//   - .st-mv-wrap / .fc-kpis / .fc-kpi* (Cycles + Reviews KPI cells)
//   - .st-cycle-row / .st-cycle-head / .st-cycle-name / .st-cycle-meta / .st-prog (Cycles view)
//   - .st-mv-table / .st-mv-badge / .st-status-pill (Reviews table)
//   - .ux-dot(.ux-confirm|.ux-silent|.ux-approve) / .next-chip / .stage-chip (shared dots/chips)
//
// Data: host.dbQuery + host.dbExec via AppBridge. TanStack Query for caching.
// Migration: 0054_strategy_domain.sql — strategy_objectives, strategy_key_results, strategy_cycles.
// Area enum (board columns): Company → Growth → Product → Finance.
//
// Until 0054 lands + has rows, the board renders from real strategic_initiatives
// (grouped by ties_to_goal for the area) and the Reviews view from real review_items.

import {
  html, cn,
  useState, useEffect, useMemo, useCallback,
  useQuery, useMutation, useQueryClient,
} from '../../lib/ui.js';
import { hostDbQuery, hostDbExec, setMenu, isStandalone } from '../../lib/bridge.js';
// dispatch-wire recipe: detail "Approve & run"/"Confirm & run" seed a next-action
// turn into the active Chi (host.sendToActiveSession) — replaces the no-op stub.
import { dispatchItemAction } from '../../lib/dispatch.js';
// facet-wire recipe: sidebar filter facets (f:*) narrow the OKR board/list.
import { applyFacet, RESET_FACET } from '../../lib/facet-filter.js';
// operator-identity recipe: hostContext.operator threaded down from app.js —
// "mine"/is-agent checks and the ux_mode gate below fail safe when unknown.
import { isMine, isOtherOwner, initialOf } from '../../lib/operator.js';
// create-wire recipe: dead "+ / New objective" buttons dispatch a creation brief
// to the Chi (R-03: an objective is agent-shaped, never a client-side husk INSERT).
import { buildCreateBrief, dispatchCreate } from '../../lib/create-dispatch.js';

// ─── Area enum (OKR board columns) ──────────────────────────────────────────────
// Strategy areas — Company → Growth → Product → Finance. Per the screen doc §1,
// area dot colours: Company --primary · Growth --achievement · Product --systemic ·
// Finance --live. Dot colours are passed inline on .kb-col-dot (kanban convention),
// not hardcoded in CSS.

const AREAS = ['Company', 'Growth', 'Product', 'Finance'];

const AREA_DOT = {
  Company: 'var(--primary)',
  Growth: 'var(--achievement)',
  Product: 'var(--systemic)',
  Finance: 'var(--live)',
};

/** Tolerant grouping — rows with a non-enum area render as their own visible
 *  column (raw value as label) instead of silently vanishing. The wave-2 lesson:
 *  any objective whose area is outside the known enum must still be seen.
 *  Same pattern as content-view.js stagesWithExtras. */
function stagesWithExtras(grouped) {
  const extras = Object.keys(grouped)
    .filter((s) => !AREAS.includes(s) && grouped[s].length > 0)
    .sort();
  return [...AREAS, ...extras];
}

/** Per-KR bar fill modifier: default (no class) ≥66% (--achievement on-track),
 *  .is-mid 33–65% (--systemic), .is-low <33% (--danger). The .pct text always
 *  accompanies the bar — colour is never the sole carrier of at-risk status. */
function barMod(pct) {
  if (pct >= 66) return '';
  if (pct >= 33) return 'is-mid';
  return 'is-low';
}

/** S-08: bar band for a single KR. When the row carries authored is_low/is_mid
 *  flags (real strategy_key_results), honour them — the strategist's at-risk call
 *  can diverge from a naive pct threshold. Only when both flags are absent (null)
 *  do we derive the band from pct via barMod. */
function krBarMod(kr) {
  if (kr.is_low === 1 || kr.is_low === true) return 'is-low';
  if (kr.is_mid === 1 || kr.is_mid === true) return 'is-mid';
  if (kr.is_low != null || kr.is_mid != null) return ''; // flags present, both 0 → on-track
  return barMod(kr.pct);
}

// ─── Fixture data (canonical — mirrors strategy.md §1 O-01..O-08) ───────────────
// Used as primary data source standalone, and as the fallback until 0054 applies
// with real rows. Each objective carries 1–2 KRs (.okr-kr rows) + an overall %.

const OBJECTIVES_FIXTURE = [
  {
    id: 'O-01', title: 'Reach $1.2M ARR by Q4', area: 'Company', cycle: '2026 cycle',
    overall_pct: 64, owner: 'nedjamez', ux_mode: 'confirm', next_action: 'Review weekly metric',
    when: 'Q4', xdomain: 'Finance',
    krs: [
      { label: 'ARR to $1.2M', pct: 64 },
      { label: 'Net retention ≥110%', pct: 58 },
    ],
  },
  {
    id: 'O-02', title: 'Close the seed round', area: 'Company', cycle: 'fundraising',
    overall_pct: 80, owner: 'nedjamez', ux_mode: 'approve', next_action: 'Countersign the SAFE',
    when: 'May',
    krs: [
      { label: '$1.5M committed', pct: 80 },
      { label: 'Lead signed', pct: 100 },
    ],
  },
  {
    id: 'O-03', title: '3 lighthouse label logos', area: 'Growth', cycle: 'GTM',
    overall_pct: 33, owner: 'cmo-agent', ux_mode: 'confirm', next_action: 'Draft outreach sequence',
    when: 'Q3', at_risk: true, xdomain: 'Sales',
    krs: [
      { label: 'Signed logos 1/3', pct: 33 },
      { label: 'Case studies 0/3', pct: 0 },
    ],
  },
  {
    id: 'O-04', title: 'Inbound pipeline $400k', area: 'Growth', cycle: 'demand',
    overall_pct: 55, owner: 'cmo-agent', ux_mode: 'silent', next_action: 'Refresh forecast (auto)',
    when: 'Q3', xdomain: 'Sales',
    krs: [
      { label: 'Pipeline $220k', pct: 55 },
      { label: 'Demo→win 22%', pct: 73 },
    ],
  },
  {
    id: 'O-05', title: 'Ship Atelier P2 (skills)', area: 'Product', cycle: 'roadmap',
    overall_pct: 45, owner: 'nedjamez', ux_mode: 'confirm', next_action: 'Lock research + strategy designs',
    when: 'Jun',
    krs: [
      { label: 'Domains drawn 6/8', pct: 75 },
      { label: 'Renderer', pct: 10 },
    ],
  },
  {
    id: 'O-06', title: 'DDEX delivery GA', area: 'Product', cycle: 'launch',
    overall_pct: 70, owner: 'product-agent', ux_mode: 'approve', next_action: 'Approve GA checklist',
    when: 'Jun', xdomain: 'Product',
    krs: [
      { label: 'ERN 4.3 pipeline', pct: 70 },
      { label: '3 DSP partners', pct: 66 },
    ],
  },
  {
    id: 'O-07', title: 'Runway ≥ 12 months', area: 'Finance', cycle: 'health',
    overall_pct: 47, owner: 'cfo-agent', ux_mode: 'silent', next_action: 'Nightly reconcile (auto)',
    when: 'ongoing', at_risk: true, xdomain: 'Finance',
    krs: [
      { label: 'Runway 5.7→12mo', pct: 47 },
      { label: 'Burn −15%', pct: 60 },
    ],
  },
  {
    id: 'O-08', title: 'Clean multi-entity books', area: 'Finance', cycle: 'ops',
    overall_pct: 88, owner: 'cfo-agent', ux_mode: 'confirm', next_action: 'Resolve 2 unmatched txns',
    when: 'May', xdomain: 'Finance',
    krs: [
      { label: 'Reconciled 88%', pct: 88 },
      { label: 'Audit-ready', pct: 75 },
    ],
  },
];

// Cycles (4) — Cycles view fixture
const CYCLES_FIXTURE = [
  { id: 'cy-q2-26', name: 'Q2 2026', range: 'Apr – Jun 2026', objectives: 6, krs: 18, avg_pct: 62, status: 'current', status_label: 'current · on track', status_cls: 'ok', cur: true },
  { id: 'cy-q1-26', name: 'Q1 2026', range: 'Jan – Mar 2026', objectives: 5, krs: 15, avg_pct: 88, status: 'closed', status_label: 'closed · achieved', status_cls: 'done', cur: false },
  { id: 'cy-q4-25', name: 'Q4 2025', range: 'Oct – Dec 2025', objectives: 5, krs: 14, avg_pct: 74, status: 'closed', status_label: 'closed', status_cls: 'done', cur: false },
  { id: 'cy-q3-26', name: 'Q3 2026', range: 'Jul – Sep 2026', objectives: 0, krs: 0, avg_pct: 0, status: 'planning', status_label: 'planning · draft', status_cls: 'muted', cur: false },
];

// Reviews (5) — Reviews view fixture
const REVIEWS_FIXTURE = [
  { id: 'rv-01', title: 'Weekly ops review',      cadence: 'weekly',  cadence_cls: '',     date: 'Mon, Apr 28', owner: 'nedjamez',       status: 'done',      status_cls: 'done'  },
  { id: 'rv-02', title: 'Monthly board update',   cadence: 'monthly', cadence_cls: 'gold', date: 'Apr 30',      owner: 'nedjamez',       status: 'draft',     status_cls: 'warn'  },
  { id: 'rv-03', title: 'Q2 mid-cycle OKR check', cadence: 'cycle',   cadence_cls: '',     date: 'May 15',      owner: 'strategy-agent', status: 'scheduled', status_cls: 'muted' },
  { id: 'rv-04', title: 'Q1 retrospective',       cadence: 'cycle',   cadence_cls: '',     date: 'Apr 2',       owner: 'nedjamez',       status: 'done',      status_cls: 'done'  },
  { id: 'rv-05', title: 'Growth weekly',          cadence: 'weekly',  cadence_cls: '',     date: 'Mon, Apr 28', owner: 'cmo-agent',      status: 'done',      status_cls: 'done'  },
];

// ─── Real-data mappers (until 0054 lands with rows) ─────────────────────────────

/** Map a strategic_initiatives row → an OKR fixture-shaped objective.
 *  area is derived from ties_to_goal (board grouping per the screen doc §4 step 4).
 *  CAVEAT: strategic_initiatives.ties_to_goal is an INTEGER 0/1 flag (0030 schema),
 *  not an area name — a bare flag value carries no grouping signal and must never
 *  become a board column name, so flag-like values fall through to 'Company'.
 *  No strategy_key_results table yet → KR bars come from the overall status only. */
function initiativeToObjective(r, i, operatorId) {
  const rawGoal = (r.ties_to_goal ?? r.area ?? '').toString().trim();
  const goalText = /^(?:0|1|true|false)$/i.test(rawGoal) ? '' : rawGoal;
  const area = AREAS.find((a) => goalText.toLowerCase().includes(a.toLowerCase())) || goalText || 'Company';
  // S-07: prefer the REAL progress_pct column (0030 strategic_initiatives). Only
  // fall back to a coarse status-string proxy when it is null — 0030 defaults it
  // to 0, so a genuine 0 is honoured as 0%, not overwritten by the proxy.
  const status = (r.status ?? '').toString().toLowerCase();
  const proxyPct = status.includes('done') || status.includes('complete') ? 100
    : status.includes('progress') || status.includes('active') ? 50
    : status.includes('block') || status.includes('risk') ? 25
    : 40;
  const pct = r.progress_pct != null ? r.progress_pct : proxyPct;
  // rawOwner (not display-defaulted) feeds the ux_mode gate below — an absent
  // DB owner must never borrow the display fallback's "assume it's you" to
  // earn 'silent'. ownerAgent (display-defaulted) is what the board/rows show.
  const rawOwner = r.owner_agent ?? r.owner ?? null;
  const ownerAgent = (rawOwner ?? operatorId ?? '').toString();
  // FAIL-SAFE: 'silent' is only earned when the row's owner is POSITIVELY
  // recorded as the CURRENT known operator — an absent owner or an unknown
  // operator always falls to 'confirm', never auto-run.
  const ux_mode = isMine(rawOwner, operatorId) ? 'silent' : 'confirm';
  return {
    id: r.id ?? `SI-${i}`,
    title: r.name ?? r.title ?? '(untitled)',
    area,
    cycle: r.quarter ?? 'cycle',
    overall_pct: pct,
    owner: ownerAgent,
    ux_mode,
    next_action: r.success_criteria ?? r.key_deliverables ?? null,
    when: r.quarter ?? '',
    at_risk: pct < 50,
    krs: [{ label: r.name ?? r.title ?? 'Progress', pct }],
    // S-01 provenance: this row is DERIVED from strategic_initiatives (the
    // fallback), so the board must render it read-only — the areaChange mutation
    // writes strategy_objectives, which has no matching row, and would no-op.
    _provenance: 'fallback',
  };
}

/** Map a review_items row → a Reviews-view fixture-shaped review. */
function reviewItemToReview(r, i, operatorId) {
  const status = (r.status ?? '').toString().toLowerCase();
  const status_cls = status.includes('done') || status.includes('complete') || status.includes('approv') ? 'done'
    : status.includes('draft') || status.includes('pending') ? 'warn'
    : status.includes('schedul') ? 'muted'
    : 'ok';
  const pr = (r.priority ?? '').toString().toLowerCase();
  return {
    id: r.id ?? `rv-${i}`,
    title: r.title ?? '(untitled)',
    cadence: r.content_type ?? 'cycle',
    cadence_cls: pr === 'high' || pr === 'critical' ? 'gold' : '',
    date: r.reviewed_at ? r.reviewed_at.substring(0, 10) : '—',
    owner: r.created_by ?? operatorId ?? null,
    status: r.status ?? 'open',
    status_cls,
  };
}

// ─── Query keys ───────────────────────────────────────────────────────────────

const QK = {
  objectives: ['strategy', 'objectives'],
  cycles:     ['strategy', 'cycles'],
  reviews:    ['strategy', 'reviews'],
};

// ─── Data fetchers ──────────────────────────────────────────────────────────────

/** Ensure 0054 migration is applied (strategy_objectives table exists). IF NOT
 *  EXISTS is safe on re-run; the shell migration runner also applies 0054 at boot,
 *  this is belt-and-braces so the pane renders against real tables from day one. */
async function ensureMigration() {
  try {
    await hostDbExec(
      `CREATE TABLE IF NOT EXISTS strategy_objectives (
        id TEXT PRIMARY KEY,
        title TEXT,
        area TEXT,
        cycle_id TEXT,
        overall_pct INTEGER,
        owner TEXT,
        ux_mode TEXT,
        next_action TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      ) STRICT`
    );
    await hostDbExec(
      `CREATE TABLE IF NOT EXISTS strategy_key_results (
        id TEXT PRIMARY KEY,
        objective_id TEXT,
        label TEXT,
        pct INTEGER,
        is_low INTEGER DEFAULT 0,
        is_mid INTEGER DEFAULT 0
      ) STRICT`
    );
    await hostDbExec(
      `CREATE TABLE IF NOT EXISTS strategy_cycles (
        id TEXT PRIMARY KEY,
        name TEXT,
        start_date TEXT,
        end_date TEXT,
        status TEXT,
        objective_count INTEGER,
        kr_count INTEGER,
        avg_pct INTEGER
      ) STRICT`
    );
  } catch (e) {
    console.warn('[strategy] ensureMigration:', e?.message ?? e);
  }
}

/** Fixtures are neither the real objectives table nor the initiatives fallback —
 *  tag them so the board treats them as read-only (no host to persist a drag to). */
function fixtureObjectives() {
  return OBJECTIVES_FIXTURE.map((o) => ({ ...o, _provenance: 'fixture' }));
}

async function fetchObjectives(operatorId) {
  if (isStandalone()) return fixtureObjectives();
  try {
    await ensureMigration();
    // 1. Prefer real strategy_objectives + their key results (post-0054, once seeded).
    const objRows = await hostDbQuery(
      `SELECT id, title, area, cycle_id, overall_pct, owner, ux_mode, next_action
       FROM strategy_objectives
       ORDER BY area, title`
    );
    if (objRows.length > 0) {
      let krByObj = {};
      try {
        const krRows = await hostDbQuery(
          `SELECT id, objective_id, label, pct, is_low, is_mid FROM strategy_key_results`
        );
        for (const k of krRows) {
          // S-08: carry the authored is_low/is_mid bar flags through so the card
          // can honour them instead of recomputing the band purely from pct.
          (krByObj[k.objective_id] ??= []).push({
            label: k.label, pct: k.pct ?? 0, is_low: k.is_low, is_mid: k.is_mid,
          });
        }
      } catch { /* no KRs yet */ }
      return objRows.map((r) => ({
        id: r.id,
        title: r.title ?? '(untitled)',
        area: AREAS.find((a) => (r.area ?? '').toLowerCase().includes(a.toLowerCase())) || r.area || 'Company',
        cycle: r.cycle_id ?? 'cycle',
        overall_pct: r.overall_pct ?? 0,
        owner: r.owner ?? operatorId ?? null,
        ux_mode: r.ux_mode ?? 'confirm',
        next_action: r.next_action ?? null,
        when: r.cycle_id ?? '',
        at_risk: (r.overall_pct ?? 0) < 50,
        krs: krByObj[r.id] ?? [{ label: r.title ?? 'Progress', pct: r.overall_pct ?? 0 }],
        // S-01 provenance: a real strategy_objectives row — drag persists via the
        // areaChange mutation, so the board keeps it draggable.
        _provenance: 'objectives',
      }));
    }

    // 2. Provisional fallback: real strategic_initiatives grouped by ties_to_goal.
    console.warn('[strategy] strategy_objectives is empty — falling back to strategic_initiatives derivation. Seed strategy_objectives to dismiss this warning.');
    try {
      const siRows = await hostDbQuery(
        `SELECT id, quarter, name, description, status, owner_agent, supporting_agents,
                ties_to_goal, success_criteria, key_deliverables, progress_pct
         FROM strategic_initiatives
         ORDER BY status, name
         LIMIT 24`
      );
      if (siRows.length > 0) return siRows.map((r, i) => initiativeToObjective(r, i, operatorId));
    } catch {
      // strategic_initiatives also missing — fall through to fixture
    }

    return fixtureObjectives();
  } catch {
    return fixtureObjectives();
  }
}

async function fetchCycles() {
  if (isStandalone()) return CYCLES_FIXTURE;
  try {
    const rows = await hostDbQuery(
      `SELECT id, name, start_date, end_date, status, objective_count, kr_count, avg_pct
       FROM strategy_cycles
       ORDER BY end_date DESC`
    );
    if (rows.length > 0) {
      return rows.map((r) => {
        const status = (r.status ?? '').toString().toLowerCase();
        const status_cls = status.includes('current') ? 'ok'
          : status.includes('closed') || status.includes('achiev') ? 'done'
          : 'muted';
        return {
          id: r.id,
          name: r.name ?? '(cycle)',
          range: [r.start_date, r.end_date].filter(Boolean).join(' – '),
          objectives: r.objective_count ?? 0,
          krs: r.kr_count ?? 0,
          avg_pct: r.avg_pct ?? 0,
          status,
          status_label: status,
          status_cls,
          cur: status.includes('current'),
        };
      });
    }
    return CYCLES_FIXTURE;
  } catch {
    return CYCLES_FIXTURE;
  }
}

async function fetchReviews(operatorId) {
  if (isStandalone()) return REVIEWS_FIXTURE;
  try {
    const rows = await hostDbQuery(
      `SELECT id, content_type, title, summary, source_table, source_id, status,
              reviewed_at, review_notes, priority, created_by
       FROM review_items
       WHERE content_type = 'strategy'
       ORDER BY reviewed_at DESC
       LIMIT 20`
    );
    if (rows.length > 0) return rows.map((r, i) => reviewItemToReview(r, i, operatorId));
    // No strategy-scoped review_items — fall back to fixtures.
    return REVIEWS_FIXTURE;
  } catch {
    return REVIEWS_FIXTURE;
  }
}

// ─── facet-wire (RECIPE 2) ────────────────────────────────────────────────────
// Domain predicate map — each expression MIRRORS its badge-count expression in
// buildStrategyMenu so a facet's slice always matches the count on its row.
// 'f:all' is the reset (RESET_FACET default in facet-filter.js) → intentionally
// absent here so applyFacet returns every objective.
//
// operatorId-parameterized so 'f:mine' fails safe (matches nothing) when the
// operator is unknown — see lib/operator.js.
function strategyFacetPredicates(operatorId) {
  return {
    'f:mine':          (o) => isMine(o.owner, operatorId),
    'f:at-risk':       (o) => o.at_risk || (o.overall_pct ?? 100) < 50,
    'f:agent-tracked': (o) => isOtherOwner(o.owner, operatorId),
    ...Object.fromEntries(AREAS.map((a) => [`f:area:${a}`, (o) => o.area === a])),
  };
}

// ─── Menu builder ─────────────────────────────────────────────────────────────

/**
 * Build the sidebar menu items for setMenu.
 *   activeView: 0 = OKRs | 1 = Cycles | 2 = Reviews
 *   pipeMode: 'board' | 'list' (only relevant when activeView === 0)
 *   objectives: objectives array (for counts)
 *   operatorId: current known operator id (null when unknown — see lib/operator.js)
 *
 * PINNED WIRING CONTRACT (recipe step 7 + the pinned contract):
 *   - View group items publish their `id` back as royaltiSuite.activeFeature.
 *   - The seg control item uses kind:'seg' with option ids that ARE the
 *     activeFeature values published back ('seg:board' / 'seg:list').
 *   - The sanitizer (shell f700813) silently drops anything else.
 *   - The seg is injected ONLY when activeView === 0 (guarded below).
 *   - Filter groups get disabled:true (→ .nav-group.is-dim) when activeView !== 0.
 */
function buildStrategyMenu(activeView, pipeMode, objectives, activeFacet, operatorId) {
  const totalCount = objectives.length;
  const mine = objectives.filter((o) => isMine(o.owner, operatorId));
  // At risk: <50% overall (the screen-doc count-2 idiom: O-03 + O-07).
  const atRisk = objectives.filter((o) => o.at_risk || (o.overall_pct ?? 100) < 50);
  // Agent-tracked: owned by anyone other than the current known operator.
  const agentTracked = objectives.filter((o) => isOtherOwner(o.owner, operatorId));
  // A facet only highlights on the OKRs view (facets dim/inert off it).
  const facetActive = (id) => activeView === 0 && activeFacet === id;

  const viewItems = [
    {
      id: 'v:okrs',
      label: 'OKRs',
      icon: 'target',
      section: 'View',
      active: activeView === 0,
      badge: totalCount > 0 ? totalCount : undefined,
    },
    {
      id: 'v:cycles',
      label: 'Cycles',
      icon: 'calendar',
      section: 'View',
      active: activeView === 1,
    },
    {
      id: 'v:reviews',
      label: 'Reviews',
      icon: 'check-circle',
      section: 'View',
      active: activeView === 2,
    },
  ];

  // Seg control: board/list toggle — injected when activeView === 0 ONLY (guard).
  // Strategy defaults to board (pipeMode = 'board'). Option ids ARE the
  // activeFeature values the shell publishes back.
  const segItem = activeView === 0
    ? [{
        id: 'seg:board-list',
        kind: 'seg',
        section: 'View',
        options: [
          { id: 'seg:board', label: 'Board', active: pipeMode === 'board' },
          { id: 'seg:list',  label: 'List',  active: pipeMode === 'list' },
        ],
      }]
    : [];

  // Default (unlabelled) filter group — dims when not on OKRs.
  const filterItems = [
    {
      id: 'f:all',
      label: 'All objectives',
      icon: 'inbox',
      section: undefined,
      active: facetActive('f:all'),
      badge: totalCount,
      disabled: activeView !== 0,
    },
    {
      id: 'f:mine',
      label: 'Mine',
      icon: 'user',
      section: undefined,
      active: facetActive('f:mine'),
      badge: mine.length || undefined,
      disabled: activeView !== 0,
    },
    {
      id: 'f:at-risk',
      label: 'At risk',
      icon: 'alert-circle',
      section: undefined,
      active: facetActive('f:at-risk'),
      hot: atRisk.length > 0,
      badge: atRisk.length > 0 ? atRisk.length : undefined,
      disabled: activeView !== 0,
    },
    {
      id: 'f:agent-tracked',
      label: 'Agent-tracked',
      icon: 'cpu',
      section: undefined,
      active: facetActive('f:agent-tracked'),
      badge: agentTracked.length || undefined,
      disabled: activeView !== 0,
    },
  ];

  // By-area filter group — dims when not on OKRs.
  const areaItems = AREAS.map((a) => ({
    id: `f:area:${a}`,
    label: a,
    section: 'By area',
    active: facetActive(`f:area:${a}`),
    badge: objectives.filter((o) => o.area === a).length || undefined,
    disabled: activeView !== 0,
  }));

  return [...viewItems, ...segItem, ...filterItems, ...areaItems];
}

// ─── Sub-components ──────────────────────────────────────────────────────────────

/** Owner mini-avatar for OKR board cards. */
function KbAvatar({ owner, operatorId, operatorLabel }) {
  const isAgent = isOtherOwner(owner, operatorId);
  const initial = !owner ? initialOf(operatorLabel)
    : isMine(owner, operatorId) ? initialOf(operatorLabel)
    : owner === 'cmo-agent' ? 'C'
    : owner === 'cfo-agent' ? 'C'
    : owner === 'product-agent' ? 'P'
    : owner === 'strategy-agent' ? 'S'
    : initialOf(owner);
  return html`<span class=${cn('kb-mini-avatar', isAgent && 'is-agent')} aria-label=${owner ?? ''}>${initial}</span>`;
}

/** OKR progress extension inside a .kb-card — KR bars + overall mini-ring. */
function OkrCardProg({ objective }) {
  const krs = objective.krs ?? [];
  return html`
    <div class="okr-card-prog">
      ${krs.map((kr, i) => html`
        <div class="okr-kr" key=${i}>
          <div class="okr-kr-row">
            <span>${kr.label}</span>
            <span class="pct">${kr.pct}%</span>
          </div>
          <div class=${cn('okr-bar', krBarMod(kr))}>
            <span style=${{ width: `${Math.max(0, Math.min(100, kr.pct))}%` }}></span>
          </div>
        </div>
      `)}
    </div>
  `;
}

/** Column count + average-progress aggregate, computed from the DATA MODEL.
 *  S-05: replaces the old E-07 observer that regex-scraped rendered .okr-overall
 *  text — the numbers now come straight from the objectives, never the DOM. */
function colAgg(cards) {
  if (!cards.length) return html`<b>0</b>`;
  const avg = Math.round(cards.reduce((s, o) => s + (o.overall_pct ?? 0), 0) / cards.length);
  return html`<b>${cards.length}</b> · ${avg}% avg`;
}

/** OKR board mode — area columns with .kb-col-agg aggregate heads + okr cards. */
function OkrBoard({ objectives, onAreaChange, onCreate, operatorId, operatorLabel }) {
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const grouped = useMemo(() => {
    const map = {};
    for (const a of AREAS) map[a] = [];
    for (const o of objectives) {
      if (map[o.area]) map[o.area].push(o);
      else map[o.area] = [o];
    }
    return map;
  }, [objectives]);

  // S-01: only real strategy_objectives rows are draggable — the areaChange
  // mutation writes strategy_objectives, so dragging a strategic_initiatives-
  // derived (or fixture) card would silently no-op and snap back. When NO card is
  // draggable the board is read-only; surface that instead of a dead affordance.
  const isDraggable = (o) => o._provenance === 'objectives';
  const readOnly = objectives.length > 0 && !objectives.some(isDraggable);

  function onDragStart(o) { if (isDraggable(o)) setDragging(o); }
  function onDragOver(e, a) { if (!dragging) return; e.preventDefault(); setDropTarget(a); }
  function onDrop(e, a) {
    e.preventDefault();
    if (dragging && dragging.area !== a) onAreaChange(dragging, a);
    setDragging(null);
    setDropTarget(null);
  }
  function onDragEnd() { setDragging(null); setDropTarget(null); }

  return html`
    <div class="kb-board" role="region" aria-label=${readOnly ? 'OKR board (read-only)' : 'OKR board'} style=${readOnly ? { position: 'relative' } : undefined}>
      ${readOnly ? html`
        <div style=${{ position:'absolute', top:'6px', right:'12px', fontSize:'0.68rem', color:'var(--fg-muted)', fontStyle:'italic', pointerEvents:'none' }}
             title="Seeded from initiatives — read-only. Seed strategy_objectives to enable drag.">
          seeded from initiatives · read-only
        </div>
      ` : null}
      ${stagesWithExtras(grouped).map((a) => {
        const cards = grouped[a] ?? [];
        return html`
          <div
            key=${a}
            class=${cn('kb-col', dropTarget === a && 'is-drop-target')}
            data-stage=${a}
            onDragOver=${(e) => onDragOver(e, a)}
            onDrop=${(e) => onDrop(e, a)}
            role="region"
            aria-label=${'Stage: ' + a}
          >
            <div class="kb-col-head">
              <span class="kb-col-name">
                <span class="kb-col-dot" style=${{ background: AREA_DOT[a] ?? 'var(--fg-faint)' }} aria-hidden="true"></span>
                ${a}
              </span>
              <!-- .kb-col-agg (NOT .kb-col-meta) — count + avg %, from the data model (S-05) -->
              <span class="kb-col-agg">${colAgg(cards)}</span>
            </div>
            <div class="kb-col-body">
              ${cards.map((o) => {
                const drag = isDraggable(o);
                return html`
                <div
                  key=${o.id}
                  class=${cn('kb-card', dragging?.id === o.id && 'is-dragging')}
                  draggable=${drag}
                  onDragStart=${() => onDragStart(o)}
                  onDragEnd=${onDragEnd}
                  tabIndex=${0}
                  title=${drag ? undefined : 'Seeded from initiatives — read-only'}
                  style=${drag ? undefined : { cursor: 'default' }}
                >
                  <div class="kb-card-title">${o.title}</div>
                  <div class="kb-card-sub">${o.area}${o.cycle ? ` · ${o.cycle}` : ''}</div>
                  <${OkrCardProg} objective=${o} />
                  <div class="kb-card-foot" style=${{ marginTop: 'var(--space-2)' }}>
                    <span class="okr-overall">
                      <span class="ring" style=${{ '--p': o.overall_pct }} aria-hidden="true"></span>
                      ${o.overall_pct}%
                    </span>
                    <span class="kb-card-owner">
                      <span class=${cn('ux-dot', `ux-${o.ux_mode ?? 'silent'}`)} title=${o.ux_mode ?? 'silent'}></span>
                      <${KbAvatar} owner=${o.owner} operatorId=${operatorId} operatorLabel=${operatorLabel} />
                    </span>
                  </div>
                </div>
              `;
              })}
              <button
                class="kb-add btn-icon"
                type="button"
                aria-label=${'Add objective to ' + a}
                onClick=${() => onCreate?.(a)}
              >+ add</button>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

// dispatch-wire (RECIPE 1) — map an objective into the recipe-shared descriptor,
// then seed a next-action turn into the active Chi. Replaces the old no-op stub
// (which flipped ux_mode='silent' to hide the button without dispatching anything —
// no-op theater that lied about the row's state). There is no headless domain-run
// verb today, so both modes seed a framed turn (see lib/dispatch.js APPROVE-RUN GAP).
function objectiveToDispatchItem(objective) {
  return {
    kind: 'objective',
    title: objective.title,
    stage: objective.area,
    nextAction: objective.next_action,
    facts: [
      ['Cycle', objective.cycle],
      ['Owner', objective.owner],
      ['Progress', objective.overall_pct != null ? `${objective.overall_pct}%` : null],
    ],
  };
}

function handleAction(objective) {
  const mode = objective.ux_mode === 'approve' ? 'approve' : 'confirm';
  dispatchItemAction(objectiveToDispatchItem(objective), mode, 'com.ikenga.strategy').catch(() => {});
}

/** Single objective row in list mode (.pl-row). */
function ObjRow({ objective, isSelected, onClick, operatorId }) {
  const isAgent = isOtherOwner(objective.owner, operatorId);
  return html`
    <div
      class=${cn('pl-row', isSelected && 'is-selected')}
      role="row"
      tabIndex=${0}
      onClick=${onClick}
      onKeyDown=${(e) => e.key === 'Enter' && onClick()}
    >
      <div class="pl-row-accent" aria-hidden="true"></div>
      <div class="pl-row-body">
        <div class="pl-row-title">${objective.title}</div>
        <div class="pl-row-sub">
          <span>${objective.area}${objective.cycle ? ` · ${objective.cycle}` : ''}</span>
          <span>·</span>
          <span>${isAgent ? html`⚭ ${objective.owner}` : objective.owner}</span>
        </div>
        ${objective.next_action ? html`
          <div class="pl-row-sub">
            <span class="next-chip">
              <span class=${cn('ux-dot', `ux-${objective.ux_mode ?? 'silent'}`)}></span>
              ${objective.next_action}
            </span>
          </div>
        ` : null}
      </div>
      <div class="pl-row-right">
        <span class="pl-row-amt">${objective.overall_pct}%</span>
        ${objective.when ? html`<span class="pl-row-when">${objective.when}</span>` : null}
      </div>
    </div>
  `;
}

/** Objective detail pane (list mode, .pl-detail). */
function ObjDetail({ objective }) {
  // dispatch-wire — local feedback: flips true on click so the operator sees the
  // hand-off landed and the same click can't double-seed the session. Resets when
  // the selected objective changes.
  const [sent, setSent] = useState(false);
  useEffect(() => { setSent(false); }, [objective?.id]);

  if (!objective) {
    return html`<div class="pl-detail" style=${{ display:'flex', alignItems:'center', justifyContent:'center', color:'var(--fg-muted)', fontSize:'0.85rem' }}>
      Select an objective
    </div>`;
  }

  const hasApprove = objective.ux_mode === 'approve';
  const hasConfirm = objective.ux_mode === 'confirm';
  const showButton = hasApprove || hasConfirm;
  const onAct = () => { handleAction(objective); setSent(true); };

  return html`
    <div class="pl-detail">
      <div class="pl-detail-wrap">
        <div class="pl-detail-eyebrow">
          <span class="stage-chip">${objective.area}</span>
          <span class="next-chip">
            <span class=${cn('ux-dot', `ux-${objective.ux_mode ?? 'silent'}`)}></span>
            ux_mode · ${objective.ux_mode ?? 'silent'}
          </span>
        </div>
        <div class="pl-detail-title">${objective.title}</div>
        <div class="pl-detail-co">${objective.area}${objective.cycle ? ` · ${objective.cycle}` : ''}${objective.owner ? ` · ${objective.owner}` : ''}</div>

        <div class="pl-facts">
          <div><div class="pl-fact-k">Area</div><div class="pl-fact-v">${objective.area}</div></div>
          <div><div class="pl-fact-k">Progress</div><div class="pl-fact-v">${objective.overall_pct}%</div></div>
          <div><div class="pl-fact-k">Owner</div><div class="pl-fact-v">${objective.owner ?? '—'}</div></div>
        </div>

        ${objective.next_action ? html`
          <div class="pl-next">
            <div class="pl-next-head">
              <span class=${cn('ux-dot', `ux-${objective.ux_mode ?? 'silent'}`)}></span>
              Next action
            </div>
            <div class="pl-next-body">${objective.next_action}</div>
            ${showButton ? html`
              <button
                class=${cn('btn', hasApprove ? 'affirmative' : '')}
                type="button"
                disabled=${sent}
                onClick=${onAct}
              >
                ${sent ? 'Sent to your Chi' : hasApprove ? 'Approve & run' : 'Confirm & run'}
              </button>
            ` : null}
          </div>
        ` : null}

        <div class="pl-next-head" style=${{ marginBottom: 'var(--space-3)' }}>Activity</div>
        <div class="pl-timeline" role="list">
          <div class="pl-tl-row" role="listitem">
            <span class="pl-tl-dot" aria-hidden="true"></span>
            <div>
              <div>Metric synced from ${objective.xdomain ?? 'source'} domain</div>
              <div class="pl-tl-when">1d ago</div>
            </div>
          </div>
          <div class="pl-tl-row" role="listitem">
            <span class="pl-tl-dot" aria-hidden="true"></span>
            <div>
              <div>KR re-baselined at board</div>
              <div class="pl-tl-when">2w ago</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/** OKR list mode — .pane-split (380px 1fr): grouped list + detail panel. */
function OkrList({ objectives, selectedObjective, onSelectObjective, operatorId }) {
  const grouped = useMemo(() => {
    const map = {};
    for (const a of AREAS) map[a] = [];
    for (const o of objectives) {
      if (map[o.area]) map[o.area].push(o);
      else map[o.area] = [o];
    }
    return map;
  }, [objectives]);

  return html`
    <div class="pane-split" style=${{ display:'grid', gridTemplateColumns:'380px 1fr', height:'100%' }}>
      <div class="pl-list" style=${{ overflowY:'auto' }} role="grid" aria-label="Objectives list">
        <div class="pl-list-head">
          <span class="pl-list-title">Strategy</span>
          <span class="pl-list-meta">${objectives.length} open</span>
        </div>
        ${stagesWithExtras(grouped).map((a) => grouped[a]?.length > 0 ? html`
          <div key=${a}>
            <div class="pl-sec"><span>${a}</span><span>${grouped[a].length}</span></div>
            ${grouped[a].map((o) => html`
              <${ObjRow}
                key=${o.id}
                objective=${o}
                isSelected=${selectedObjective?.id === o.id}
                onClick=${() => onSelectObjective(o)}
                operatorId=${operatorId}
              />
            `)}
          </div>
        ` : null)}
      </div>
      <${ObjDetail} objective=${selectedObjective} />
    </div>
  `;
}

/** Cycles view (.st-*) — KPI cells + cycle cards. */
function CyclesView({ cycles }) {
  const current = cycles.find((c) => c.cur) ?? cycles[0] ?? {};
  const objectivesTotal = current.objectives ?? 0;
  const daysLeft = 37; // derived in fixture; real value from cycle end_date when seeded

  return html`
    <div class="st-mv-wrap">
      <div class="fc-kpis">
        <div class="fc-kpi">
          <div class="fc-kpi-k">Current cycle</div>
          <div class="fc-kpi-v">${current.name ?? '—'}</div>
          <div class="fc-kpi-sub">${current.range ?? ''}</div>
        </div>
        <div class="fc-kpi">
          <div class="fc-kpi-k">Objectives</div>
          <div class="fc-kpi-v">${objectivesTotal}</div>
          <div class="fc-kpi-sub">across ${AREAS.length} areas</div>
        </div>
        <div class="fc-kpi">
          <div class="fc-kpi-k">Avg progress</div>
          <div class="fc-kpi-v" style=${{ color:'var(--live)' }}>${current.avg_pct ?? 0}%</div>
          <div class="fc-kpi-sub">on track</div>
        </div>
        <div class="fc-kpi">
          <div class="fc-kpi-k">Days left</div>
          <div class="fc-kpi-v">${daysLeft}</div>
          <div class="fc-kpi-sub">to cycle close</div>
        </div>
      </div>

      <div class="st-fc-card-h">Planning cycles <span class="st-sub">quarter · progress</span></div>
      ${cycles.map((c) => html`
        <div class=${cn('st-cycle-row', c.cur && 'cur')} key=${c.id}>
          <div class="st-cycle-head">
            <span class="st-cycle-name">${c.name}</span>
            <span class=${cn('st-status-pill', c.status_cls)}>${c.status_label}</span>
          </div>
          <div class="st-cycle-meta">${c.range}${c.objectives ? ` · ${c.objectives} objectives` : ''}${c.krs ? ` · ${c.krs} KRs` : ''}</div>
          <div class="st-prog"><div class="st-prog-fill" style=${{ width: `${c.avg_pct}%` }}></div></div>
        </div>
      `)}
    </div>
  `;
}

/** Reviews view (.st-*) — KPI cells + review cadence table. */
function ReviewsView({ reviews }) {
  const openItems = reviews.filter((r) => (r.status_cls === 'warn' || r.status_cls === 'muted')).length;
  const next = reviews.find((r) => r.status_cls === 'muted' || r.status_cls === 'warn') ?? reviews[0] ?? {};

  return html`
    <div class="st-mv-wrap">
      <div class="fc-kpis">
        <div class="fc-kpi">
          <div class="fc-kpi-k">Next review</div>
          <div class="fc-kpi-v">${next.date ?? '—'}</div>
          <div class="fc-kpi-sub">${next.title ?? ''}</div>
        </div>
        <div class="fc-kpi">
          <div class="fc-kpi-k">This cycle</div>
          <div class="fc-kpi-v">${reviews.length}</div>
          <div class="fc-kpi-sub">reviews held</div>
        </div>
        <div class="fc-kpi">
          <div class="fc-kpi-k">Action items</div>
          <div class="fc-kpi-v" style=${{ color:'var(--primary)' }}>${openItems}</div>
          <div class="fc-kpi-sub">open</div>
        </div>
        <div class="fc-kpi">
          <div class="fc-kpi-k">On-time rate</div>
          <div class="fc-kpi-v">94%</div>
          <div class="fc-kpi-sub">last 2 quarters</div>
        </div>
      </div>

      <div class="st-fc-card-h">Review cadence <span class="st-sub">type · when · status</span></div>
      <div class="st-fc-card flush">
        <table class="st-mv-table" role="grid" aria-label="Review cadence">
          <thead>
            <tr>
              <th>Review</th><th>Cadence</th><th>Date</th><th>Owner</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${reviews.map((r) => html`
              <tr key=${r.id}>
                <td class="lead">${r.title}</td>
                <td><span class=${cn('st-mv-badge', r.cadence_cls)}>${r.cadence}</span></td>
                <td>${r.date}</td>
                <td>${r.owner}</td>
                <td><span class=${cn('st-status-pill', r.status_cls)}>${r.status}</span></td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Loading / empty / error / streaming states ────────────────────────────────

function LoadingState() {
  return html`
    <div class="atelier-state is-loading" id="view-stage">
      <span class="atelier-spin" aria-hidden="true"></span>
      <span>Loading strategy…</span>
    </div>
  `;
}

function EmptyState({ onCreate }) {
  return html`
    <div class="atelier-state is-empty" id="view-stage">
      <span>Nothing here yet — when strategy work arrives, or your Chi drafts something, it lands in this pane</span>
      <button class="btn btn-sm" type="button" style=${{ marginTop:'8px' }} onClick=${() => onCreate?.()}>New objective</button>
    </div>
  `;
}

function ErrorState({ error, onRetry }) {
  return html`
    <div class="atelier-state is-error" id="view-stage">
      <span>Failed to load strategy</span>
      <span style=${{ fontSize:'0.72rem', color:'var(--fg-muted)', marginTop:'4px' }}>${error}</span>
      <button class="btn btn-sm" type="button" style=${{ marginTop:'8px' }} onClick=${onRetry}>Retry</button>
    </div>
  `;
}

function StreamingState() {
  return html`
    <div class="atelier-state is-streaming" id="view-stage">
      <span class="atelier-prog" role="status" aria-live="polite">Strategy agent running…</span>
    </div>
  `;
}

// ─── StrategyView root ──────────────────────────────────────────────────────────

export function StrategyView({ activeFeature, operatorId, operatorLabel }) {
  // View state: 0=OKRs | 1=Cycles | 2=Reviews. Deep link via ?view=.
  const [activeView, setActiveView] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('view');
    const v = parseInt(p ?? '0', 10);
    return [0, 1, 2].includes(v) ? v : 0;
  });
  // OKRs defaults to board (per the screen doc §2 — board is the default).
  const [pipeMode, setPipeMode] = useState('board'); // 'board' | 'list'
  const [selectedObjective, setSelectedObjective] = useState(null);
  // facet-wire — last-applied sidebar filter facet. 'f:all' (RESET_FACET) is the
  // reset/"all" affordance (no predicate → applyFacet returns every objective).
  const [activeFacet, setActiveFacet] = useState(RESET_FACET);
  const qc = useQueryClient();

  // ── Data queries ────────────────────────────────────────────────────────────
  const objectivesQ = useQuery({ queryKey: QK.objectives, queryFn: () => fetchObjectives(operatorId) });
  const cyclesQ = useQuery({ queryKey: QK.cycles, queryFn: fetchCycles, enabled: activeView === 1 });
  const reviewsQ = useQuery({
    queryKey: QK.reviews,
    queryFn: () => fetchReviews(operatorId),
    enabled: activeView === 2,
  });

  const objectives = objectivesQ.data ?? [];
  // facet-wire — the visible slice: full list narrowed by the active facet. Feeds
  // the board, list AND the empty-state check. Badges stay live because
  // buildStrategyMenu counts the FULL `objectives`, not this slice.
  const visibleObjectives = useMemo(
    () => applyFacet(objectives, activeFacet, strategyFacetPredicates(operatorId)),
    [objectives, activeFacet, operatorId],
  );

  // ── db-updated refresh (recipe step 6 — refresh on event, not full remount) ──
  useEffect(() => {
    function onDbUpdated() {
      qc.invalidateQueries({ queryKey: ['strategy'] });
    }
    window.addEventListener('db-updated', onDbUpdated);
    return () => window.removeEventListener('db-updated', onDbUpdated);
  }, [qc]);

  // ── activeFeature → view + mode switching (side-menu item clicks) ───────────
  // PINNED WIRING CONTRACT: shell relays side-menu clicks via the host-context
  // re-emit carrying the BARE context with royaltiSuite.activeFeature = the
  // clicked item's id. Seg option ids ('seg:board'/'seg:list') ARE the
  // activeFeature values published back. There is NO 'pkg-menu-click' message
  // and NO menu DOM injection — consume only via this effect keyed on [activeFeature].
  useEffect(() => {
    if (!activeFeature) return;
    if (activeFeature === 'v:okrs') setActiveView(0);
    else if (activeFeature === 'v:cycles') setActiveView(1);
    else if (activeFeature === 'v:reviews') setActiveView(2);
    else if (activeFeature === 'seg:board') setPipeMode('board');
    else if (activeFeature === 'seg:list') setPipeMode('list');
    // Filter facets (f:*) — LIST-ONLY: force the OKRs view so a facet the user
    // can't see can't be silently applied, then record it. 'f:all' resets; every
    // other id narrows via applyFacet. (facet-wire Move 2.)
    else if (activeFeature.startsWith('f:')) {
      setActiveView(0);
      setActiveFacet(activeFeature);
    }
  }, [activeFeature]);

  // ── Pre-select hero objective O-01 in list mode ──────────────────────────────
  useEffect(() => {
    if (objectives.length > 0 && !selectedObjective && activeView === 0 && pipeMode === 'list') {
      const hero = objectives.find((o) => o.id === 'O-01') ?? objectives[0];
      setSelectedObjective(hero);
    }
  }, [objectives, activeView, pipeMode]);

  // ── setMenu publish (recipe step 7 — keyed on view/mode/objectives) ──────────
  useEffect(() => {
    if (isStandalone()) return;
    const items = buildStrategyMenu(activeView, pipeMode, objectives, activeFacet, operatorId);
    setMenu(items).catch(() => {/* ignore */});
  }, [activeView, pipeMode, objectives, activeFacet, operatorId]);

  // ── Area change mutation (board drag — schema TBD soft link) ─────────────────
  const areaChange = useMutation({
    mutationFn: async ({ objective, newArea }) => {
      if (isStandalone()) return;
      // Once strategy_objectives is seeded, update area there; otherwise no-op
      // (board column for strategic_initiatives derives from ties_to_goal).
      await hostDbExec(
        `UPDATE strategy_objectives SET area = ? WHERE id = ?`,
        [newArea, objective.id]
      ).catch(() => {});
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.objectives }),
  });

  // ── Dispatch-mode creation (create-wire recipe) ─────────────────────────────
  // R-03: an objective is agent-shaped — it needs KRs, an owner, a ux_mode and a
  // cycle plus enrichment the user hasn't typed, so creation dispatches a
  // structured brief to the active Chi rather than a client-side husk INSERT.
  // `area` is the board column's pre-filled context; undefined for the
  // empty-state "New objective" which seeds a full brief.
  const createObjective = useCallback((area) => {
    const brief = buildCreateBrief({
      entity: 'strategy objective',
      table: 'strategy_objectives',
      seed: area ? { area } : {},
      instruction:
        'Set the title, cycle, owner, ux_mode, key results and overall progress'
        + (area ? `, and file it under the ${area} area` : '')
        + '. Ask me for anything you still need, then add it (and its key results) '
        + 'to the strategy_objectives / strategy_key_results tables.',
    });
    void dispatchCreate(brief, 'com.ikenga.strategy');
  }, []);

  // ── Head label ────────────────────────────────────────────────────────────────
  const headLabel = activeView === 0
    ? `Strategy · ${objectives.length} open`
    : activeView === 1 ? 'Cycles'
    : 'Reviews';

  // ── Render ──────────────────────────────────────────────────────────────────
  let body;

  if (activeView === 0) {
    if (objectivesQ.isLoading) {
      body = html`<${LoadingState} />`;
    } else if (objectivesQ.isError) {
      body = html`<${ErrorState} error=${objectivesQ.error?.message ?? 'unknown'} onRetry=${() => objectivesQ.refetch()} />`;
    } else if (visibleObjectives.length === 0) {
      body = html`<${EmptyState} onCreate=${createObjective} />`;
    } else if (pipeMode === 'board') {
      body = html`<${OkrBoard}
        objectives=${visibleObjectives}
        onAreaChange=${(objective, newArea) => areaChange.mutate({ objective, newArea })}
        onCreate=${createObjective}
        operatorId=${operatorId}
        operatorLabel=${operatorLabel}
      />`;
    } else {
      body = html`<${OkrList}
        objectives=${visibleObjectives}
        selectedObjective=${selectedObjective}
        onSelectObjective=${setSelectedObjective}
        operatorId=${operatorId}
      />`;
    }
  } else if (activeView === 1) {
    if (cyclesQ.isLoading) {
      body = html`<${LoadingState} />`;
    } else {
      body = html`<${CyclesView} cycles=${cyclesQ.data ?? CYCLES_FIXTURE} />`;
    }
  } else {
    if (reviewsQ.isLoading) {
      body = html`<${LoadingState} />`;
    } else {
      body = html`<${ReviewsView} reviews=${reviewsQ.data ?? REVIEWS_FIXTURE} />`;
    }
  }

  return html`
    <div class="frame" style=${{ height:'100%', display:'flex', flexDirection:'column' }}>
      <div class="frame-head" style=${{ display:'flex', alignItems:'center', gap:'8px' }}>
        <!-- Strategy domain icon: three-level funnel (SVG lines) -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
        </svg>
        <span>${headLabel}</span>
      </div>
      <div class="frame-body-flush" id="view-stage" style=${{ flex:1, overflow:'hidden' }}>
        ${body}
      </div>
    </div>
  `;
}
