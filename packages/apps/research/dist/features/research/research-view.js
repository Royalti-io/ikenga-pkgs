// Research main view — Reports (list+detail) / Sources (monitored register) / Personas (ICP grid).
//
// Composition follows plans/atelier-design-system/parts/screens/research.md §§1–4:
//   Views (shell SIDE-MENU driven — NOT in-pane tabs):
//     ?view=0 Reports (list+detail split) | ?view=1 Sources (dense table) | ?view=2 Personas (2-up grid)
//
//   Kit parts consumed:
//   - .frame / .frame-head / .frame-body-flush (part 30 pkg-pane-frame)
//   - .ip-split / .ip-split-list / .ip-split-divider / .ip-split-pane (part 25 inspector-detail)
//   - .split-list-head / .split-list-title / .split-list-meta / .split-group / .split-group-head
//   - .split-row / .split-row-accent / .split-row-body / .split-row-title / .split-row-sub
//     / .split-row-right / .split-row-amt / .split-row-when / .split-row-when.is-urgent (list-detail)
//   - .split-detail / .split-detail-wrap / .split-detail-eyebrow / .split-detail-title
//     / .split-detail-sub / .split-facts / .split-fact-k / .split-fact-v
//     / .split-next / .split-next-head / .split-next-body / .split-timeline / .split-tl-* (list-detail)
//   - .dense-row.dense-row--pipeline (part 20 table-dense-row — Sources rows ride this shape)
//   - .nav-group[data-kind] / .nav-item / .nav-item.is-on / .nav-item.is-hot / .nav-item-count (part 22)
//   - .atelier-state.is-{loading,empty,error,streaming} / .atelier-spin / .atelier-prog (part 26 feedback-state)
//   - .stage-chip / .next-chip / .ux-dot (part 11 badge-tag-chip)
//   - .btn / .btn-primary / .btn-sm (part 10 buttons)
//
//   Domain-local (research.css .rs-* + screen-scoped residue):
//   - .ux-dot.ux-* mode dot colours · .next-chip / .stage-chip residue
//   - .rs-persona-* (Personas 2-up grid) · .rs-source-* / .rs-source-status / .rs-src-badge (Sources)
//   - .rs-xdomain (cross-domain Hand-to-sales badge) · .rs-prog (persona Fit bar)
//
// Data: host.dbQuery + host.dbExec via AppBridge. TanStack Query for caching.
// Migration: 0053_research_domain.sql — research_notes ext cols + research_sources + sales_deals.research_item_id.
//
// Provisional fallback (until 0053 lands): the pane renders against real
// research_notes; word_count derives from body length; hand-to-sales appends to
// sales_deals.notes (the research_item_id column may not exist yet). research_sources
// reads fall back to the canonical fixture register.

import {
  html, cn,
  useState, useEffect, useMemo,
  useQuery, useMutation, useQueryClient,
} from '../../lib/ui.js';
import { hostDbQuery, hostDbExec, hostSendToActiveSession, hostNavigate, setMenu, isStandalone } from '../../lib/bridge.js';
import { applyFacet, RESET_FACET } from '../../lib/facet-filter.js';

// ─── Type enum ──────────────────────────────────────────────────────────────
// research_notes.entity_type maps to one of these display labels. The Reports
// list groups by type label, tolerant of any non-enum value (renders its own group).

const TYPE_GROUPS = ['persona', 'competitor', 'prospect', 'market'];

const TYPE_LABEL = {
  persona: 'Personas / ICP',
  icp: 'Personas / ICP',
  competitor: 'Competitor intel',
  prospect: 'Prospect dossiers',
  market: 'Market / DDEX',
  ddex: 'Market / DDEX',
};

/** Collapse a raw entity_type to one of the four canonical group keys. */
function typeKey(raw) {
  const s = (raw ?? '').toString().toLowerCase();
  if (s === 'icp' || s.includes('persona')) return 'persona';
  if (s.includes('compet')) return 'competitor';
  if (s.includes('prospect')) return 'prospect';
  if (s === 'ddex' || s.includes('market')) return 'market';
  return s || 'other';
}

/** Tolerant grouping — rows whose type is outside the known enum render as their
 *  own visible group (raw value as label) instead of silently vanishing.
 *  Same pattern as content-view.js / sales-view.js stagesWithExtras. */
function typesWithExtras(grouped) {
  const extras = Object.keys(grouped)
    .filter((t) => !TYPE_GROUPS.includes(t) && (grouped[t]?.length ?? 0) > 0)
    .sort();
  return [...TYPE_GROUPS, ...extras];
}

// ─── Fixture data (canonical — mirrors research.md §1 R-01..R-08) ────────────
// Used as primary data source until 0053 migration applies and real rows exist.

const REPORTS_FIXTURE = [
  { id: 'R-01', title: 'ICP: independent African labels', entity_type: 'persona',    entity_name: 'Persona',         owner: 'nedjamez',       summary: 'Persona · nedjamez', amount: '1.2k words', when: 'Today',   urgent: true,  next_action: 'Validate with 3 customer calls', next_action_mode: 'confirm', next_action_target: null,    word_count: 1200, body: '' },
  { id: 'R-02', title: 'Persona: label finance managers', entity_type: 'persona',    entity_name: 'Persona',         owner: 'nedjamez',       summary: 'Persona · nedjamez', amount: 'outline',    when: 'Next wk', urgent: false, next_action: 'Draft the persona',              next_action_mode: 'confirm', next_action_target: null,    word_count: 0,    body: '' },
  { id: 'R-03', title: 'DistroKid vs Royalti — feature teardown', entity_type: 'competitor', entity_name: 'Competitor', owner: 'research-agent', summary: 'Competitor · ⚙ research-agent', amount: '9 sources', when: '2d', urgent: false, next_action: 'Refresh pricing table (auto)', next_action_mode: 'silent', next_action_target: null, word_count: 0, body: '' },
  { id: 'R-04', title: 'TuneCore positioning shift',      entity_type: 'competitor', entity_name: 'Competitor',      owner: 'research-agent', summary: 'Competitor · ⚙ research-agent', amount: '5 sources', when: '5d', urgent: false, next_action: 'Log to battlecard (auto)', next_action_mode: 'silent', next_action_target: 'battlecard', word_count: 0, body: '' },
  { id: 'R-05', title: 'Prospect dossier: Mavin Records', entity_type: 'prospect',   entity_name: 'Prospect',        owner: 'research-agent', summary: 'Prospect · ⚙ research-agent',   amount: 'dossier',   when: '1d', urgent: false, next_action: 'Hand to sales pipeline', next_action_mode: 'approve', next_action_target: 'sales', entity_id: null, word_count: 0, body: '' },
  { id: 'R-06', title: 'Prospect brief: Chocolate City',  entity_type: 'prospect',   entity_name: 'Prospect',        owner: 'research-agent', summary: 'Prospect · ⚙ research-agent',   amount: 'brief',     when: '2d', urgent: false, next_action: 'Enrich from public filings (auto)', next_action_mode: 'silent', next_action_target: null, word_count: 0, body: '' },
  { id: 'R-07', title: 'DDEX ERN 4.3 — what changed',     entity_type: 'market',     entity_name: 'Market',          owner: 'research-agent', summary: 'Market · ⚙ research-agent',     amount: 'spec digest', when: '3d', urgent: false, next_action: 'Summarize for product', next_action_mode: 'confirm', next_action_target: 'product', word_count: 0, body: '' },
  { id: 'R-08', title: 'Nigerian streaming market 2026',  entity_type: 'market',     entity_name: 'Market',          owner: 'nedjamez',       summary: 'Market · nedjamez',             amount: 'pillar report', when: 'Next wk', urgent: false, next_action: 'Outline the report', next_action_mode: 'confirm', next_action_target: null, word_count: 0, body: '' },
];

// Activity timeline for the selected report (screen residue — agent run log).
const ACTIVITY_FIXTURE = [
  { id: 'A1', text: 'Draft 2 — added payout-cadence pain', when: '2h ago' },
  { id: 'A2', text: 'Pulled 14 support tickets',           when: '1d ago' },
  { id: 'A3', text: 'Kicked off from sales win-loss',      when: '4d ago' },
];

// Monitored-source register (canonical fixture — research.md §1 Sources table).
const SOURCES_FIXTURE = [
  { id: 'S-01', name: 'Spotify for Artists changelog', type: 'Market',     cadence: 'daily',   last_checked: '2h ago',  status: 'fresh'  },
  { id: 'S-02', name: 'DDEX ERN 4.3 spec',             type: 'DDEX',       cadence: 'weekly',  last_checked: '3d ago',  status: 'fresh'  },
  { id: 'S-03', name: 'Believe Digital — pricing',     type: 'Competitor', cadence: 'weekly',  last_checked: '1d ago',  status: 'fresh'  },
  { id: 'S-04', name: 'Mavin Records — press',         type: 'Prospect',   cadence: 'daily',   last_checked: '5h ago',  status: 'signal' },
  { id: 'S-05', name: 'UnitedMasters product blog',    type: 'Competitor', cadence: 'weekly',  last_checked: '9d ago',  status: 'stale'  },
  { id: 'S-06', name: 'Luminate mid-year report',      type: 'Market',     cadence: 'monthly', last_checked: '21d ago', status: 'stale'  },
];

// Personas / ICP grid (canonical fixture — research.md / SECONDARY_B in mockup).
const PERSONAS_FIXTURE = [
  { id: 'PR-1', tag: 'core ICP',   name: 'Independent label',         desc: '10–50 artists, manual splits in spreadsheets, one ops person wearing every hat.', pain: 'splits + payouts',  motion: 'inbound / self-serve',   acv: '$6–48K',   fit: 92 },
  { id: 'PR-2', tag: 'expansion',  name: 'Distributor / aggregator',  desc: 'Multi-label reconciliation across hundreds of catalogs; needs DDEX delivery at scale.', pain: 'inter-entity recon', motion: 'sales-led',           acv: '$96–200K', fit: 78 },
  { id: 'PR-3', tag: 'adjacent',   name: 'Artist-manager',            desc: 'Manages a roster, wants payout transparency and clean statements per artist.', pain: 'statement trust', motion: 'self-serve → team',     acv: '$3–12K',   fit: 64 },
  { id: 'PR-4', tag: 'enterprise', name: 'Enterprise rights-holder',  desc: 'Large catalog owner delivering to every DSP; compliance + audit trail matter most.', pain: 'DDEX at scale', motion: 'partner / RFP',          acv: '$120K+',   fit: 71 },
];

// ─── word_count derivation (provisional until 0053.word_count populated) ─────

function deriveWordCount(row) {
  if (typeof row.word_count === 'number' && row.word_count > 0) return row.word_count;
  const body = (row.body ?? '').toString().trim();
  if (!body) return 0;
  return body.split(/\s+/).filter(Boolean).length;
}

/** Display amount: prefer explicit fixture amount, else source count, else word count. */
function reportAmount(row) {
  if (row.amount) return row.amount;
  const srcCount = sourceCount(row.source_urls);
  if (srcCount > 0) return `${srcCount} sources`;
  const wc = deriveWordCount(row);
  if (wc >= 1000) return `${(wc / 1000).toFixed(1)}k words`;
  if (wc > 0) return `${wc} words`;
  return '—';
}

function sourceCount(sourceUrls) {
  if (!sourceUrls) return 0;
  try {
    const arr = JSON.parse(sourceUrls);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

function isAgentOwner(owner) {
  return typeof owner === 'string' && /-agent$/.test(owner);
}

// ─── Sidebar facet predicates ─────────────────────────────────────────────────
// Domain half of the facet-wire recipe: maps each filter-facet id (the
// PkgMenuItem id the shell echoes back as royaltiSuite.activeFeature) to a
// predicate over a report row. The generic applier lives in lib/facet-filter.js;
// this map is where the domain columns (owner / is_stale / entity_type) live.
// 'f:all' is intentionally ABSENT — RESET_FACET makes applyFacet return every
// row. Keep each predicate in lockstep with its badge count in buildResearchMenu
// (same expression) so the count and the filtered slice never disagree.
const FACET_PREDICATES = {
  'f:mine':         (r) => r.owner === 'nedjamez',
  'f:agent-run':    (r) => isAgentOwner(r.owner),
  'f:fresh':        (r) => r.is_stale === 0 || r.is_stale == null,
  'f:t:persona':    (r) => typeKey(r.entity_type) === 'persona',
  'f:t:competitor': (r) => typeKey(r.entity_type) === 'competitor',
  'f:t:prospect':   (r) => typeKey(r.entity_type) === 'prospect',
  'f:t:market':     (r) => typeKey(r.entity_type) === 'market',
};

// ─── Query keys ───────────────────────────────────────────────────────────────

const QK = {
  reports: ['research', 'reports'],
  sources: ['research', 'sources'],
};

// ─── Data fetchers ────────────────────────────────────────────────────────────

/** Ensure 0053 migration is applied (research_sources exists, ext columns added).
 *  IF NOT EXISTS / ADD COLUMN are safe on re-run; the shell's db.rs runner is the
 *  authoritative path — this is a best-effort bootstrap for dev mounts before the
 *  registered migration lands. */
async function ensureMigration() {
  try {
    await hostDbExec(
      `CREATE TABLE IF NOT EXISTS research_sources (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        cadence TEXT,
        status TEXT,
        last_checked TEXT
      ) STRICT`
    );
  } catch (e) {
    console.warn('[research] ensureMigration:', e?.message ?? e);
  }
}

async function fetchReports() {
  if (isStandalone()) return REPORTS_FIXTURE;
  try {
    await ensureMigration();
    const rows = await hostDbQuery(
      `SELECT id, title, entity_type, entity_name, entity_id, summary, body,
              source_urls, research_depth, tags, fit_score, fit_notes, status,
              researched_by, owner, next_action, next_action_target,
              agent_cycle_id, is_stale, word_count, updated_at
       FROM research_notes
       ORDER BY updated_at DESC`
    );
    if (rows.length > 0) {
      return rows.map((r) => ({
        ...r,
        // owner falls back to researched_by (the explicit "Mine" vs agent split).
        owner: r.owner ?? r.researched_by ?? 'nedjamez',
      }));
    }
    // research_notes empty — fall back to the canonical fixture so the pane still renders.
    console.warn('[research] research_notes is empty — falling back to fixture. Add real notes to dismiss this warning.');
    return REPORTS_FIXTURE;
  } catch {
    return REPORTS_FIXTURE;
  }
}

async function fetchSources() {
  if (isStandalone()) return SOURCES_FIXTURE;
  try {
    await ensureMigration();
    const rows = await hostDbQuery(
      `SELECT id, name, type, cadence, status, last_checked
       FROM research_sources
       ORDER BY status, last_checked`
    );
    if (rows.length > 0) return rows;
    console.warn('[research] research_sources is empty — falling back to fixture register.');
    return SOURCES_FIXTURE;
  } catch {
    // Table may not exist yet (0053 not applied) — fixture register.
    return SOURCES_FIXTURE;
  }
}

// ─── Menu builder ─────────────────────────────────────────────────────────────

/**
 * Build the sidebar menu items for setMenu.
 *   activeView: 0 = Reports | 1 = Sources | 2 = Personas
 *   reports: open reports array (for counts)
 *
 * R23 list-only rule: the "By type" filter group dims (disabled) on Sources /
 * Personas views — facets only apply to the Reports list. The "View" group is
 * never dimmed.
 *
 * PINNED setMenu contract:
 *   - PkgMenuItem  { id, label, icon?, badge?, section?, disabled?, active? }
 *   - the shell relays clicks back via host-context re-emit → royaltiSuite.activeFeature = id.
 */
function buildResearchMenu(activeView, reports, activeFacet) {
  const total = reports.length;
  const mine = reports.filter((r) => r.owner === 'nedjamez').length;
  const agentRun = reports.filter((r) => isAgentOwner(r.owner)).length;
  // "Fresh this week" — fixture has 4; live derives from is_stale=0 (or unknown).
  const fresh = reports.filter((r) => r.is_stale === 0 || r.is_stale == null).length;
  const freshCount = isStandalone() ? 4 : fresh;

  const onList = activeView === 0;
  const filtersDim = !onList; // dim filter facets on non-list views (R23)
  // A facet highlights only while the Reports list is the active view (dimmed
  // facets never highlight — mirrors the shell's own `disabled ? false` rule).
  const facetActive = (id) => onList && activeFacet === id;

  const viewItems = [
    { id: 'v:reports',  label: 'Reports',  icon: 'file-text', section: 'View', active: activeView === 0, badge: total > 0 ? total : undefined },
    { id: 'v:sources',  label: 'Sources',  icon: 'rss',       section: 'View', active: activeView === 1 },
    { id: 'v:personas', label: 'Personas', icon: 'users',     section: 'View', active: activeView === 2 },
  ];

  // "By owner / freshness" combined view group (the SIDEBAR.groups[0] in the mockup —
  // presented without a label, so use a single section header).
  const ownerItems = [
    { id: 'f:all',       label: 'All research',     icon: 'file-text', section: 'Filter', active: facetActive('f:all'),       badge: total,             disabled: filtersDim },
    { id: 'f:mine',      label: 'Mine',             icon: 'user',      section: 'Filter', active: facetActive('f:mine'),      badge: mine || undefined, disabled: filtersDim },
    { id: 'f:fresh',     label: 'Fresh this week',  icon: 'zap',       section: 'Filter', active: facetActive('f:fresh'),     badge: freshCount || undefined, hot: freshCount > 0, disabled: filtersDim },
    { id: 'f:agent-run', label: 'Agent-run',        icon: 'cpu',       section: 'Filter', active: facetActive('f:agent-run'), badge: agentRun || undefined, disabled: filtersDim },
  ];

  // "By type" filter group. Badge counts derive from the FULL report list (not
  // the filtered slice) so they stay live regardless of the active facet.
  const typeItems = [
    { id: 'f:t:persona',    label: 'Personas / ICP', section: 'By type', active: facetActive('f:t:persona'),    badge: reports.filter((r) => typeKey(r.entity_type) === 'persona').length || undefined,    disabled: filtersDim },
    { id: 'f:t:competitor', label: 'Competitor',     section: 'By type', active: facetActive('f:t:competitor'), badge: reports.filter((r) => typeKey(r.entity_type) === 'competitor').length || undefined, disabled: filtersDim },
    { id: 'f:t:prospect',   label: 'Prospect',       section: 'By type', active: facetActive('f:t:prospect'),   badge: reports.filter((r) => typeKey(r.entity_type) === 'prospect').length || undefined,   disabled: filtersDim },
    { id: 'f:t:market',     label: 'Market / DDEX',  section: 'By type', active: facetActive('f:t:market'),     badge: reports.filter((r) => typeKey(r.entity_type) === 'market').length || undefined,     disabled: filtersDim },
  ];

  return [...viewItems, ...ownerItems, ...typeItems];
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** A single report row in the Reports list. */
function ReportRow({ report, isSelected, onSelect }) {
  const agent = isAgentOwner(report.owner);
  return html`
    <div
      class=${cn('split-row', isSelected && 'is-selected')}
      role="row"
      tabIndex=${0}
      onClick=${onSelect}
      onKeyDown=${(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
    >
      <span class="split-row-accent" aria-hidden="true"></span>
      <div class="split-row-body">
        <div class="split-row-title">${report.title}</div>
        <div class="split-row-sub">
          <span>${TYPE_LABEL[typeKey(report.entity_type)]?.split(' ')[0] ?? report.entity_type}</span>
          <span>·</span>
          <span>${agent ? html`⚙ ${report.owner}` : report.owner}</span>
        </div>
        ${report.next_action ? html`
          <div class="split-row-sub">
            <span class="next-chip">
              <span class=${cn('ux-dot', `ux-${report.next_action_mode ?? 'silent'}`)}></span>
              ${report.next_action}
            </span>
          </div>
        ` : null}
      </div>
      <div class="split-row-right">
        <span class="split-row-amt">${reportAmount(report)}</span>
        <span class=${cn('split-row-when', report.urgent && 'is-urgent')}>${report.when ?? ''}</span>
      </div>
    </div>
  `;
}

/** Detail pane for the selected report — pipeline-detail shape (not full inspector). */
function ReportDetail({ report, onHandToSales, handPending }) {
  if (!report) {
    return html`<div class="ip-split-pane split-detail" style=${{ display:'flex', alignItems:'center', justifyContent:'center', color:'var(--fg-muted)', fontSize:'0.85rem' }}>
      Select a report
    </div>`;
  }

  const mode = report.next_action_mode ?? 'silent';
  const agent = isAgentOwner(report.owner);
  const isHandToSales = report.next_action_target === 'sales';
  const wc = deriveWordCount(report);
  const detailMeta = report.amount ?? (wc >= 1000 ? `${(wc / 1000).toFixed(1)}k words` : wc > 0 ? `${wc} words` : '—');
  const showButton = mode === 'confirm' || mode === 'approve';

  return html`
    <div class="ip-split-pane split-detail" style=${{ overflowY:'auto' }}>
      <div class="split-detail-wrap">
        <div class="split-detail-eyebrow">
          <span class="stage-chip">${TYPE_LABEL[typeKey(report.entity_type)] ?? report.entity_type}</span>
          <span class="next-chip">
            <span class=${cn('ux-dot', `ux-${mode}`)}></span>
            ux_mode · ${mode}
          </span>
        </div>
        <div class="split-detail-title">${report.title}</div>
        <div class="split-detail-sub">${report.entity_name ?? '—'}${report.owner ? ` · ${agent ? '⚙ ' : ''}${report.owner}` : ''}</div>

        <div class="split-facts">
          <div><div class="split-fact-k">Type</div><div class="split-fact-v">${TYPE_LABEL[typeKey(report.entity_type)] ?? report.entity_type}</div></div>
          <div><div class="split-fact-k">Detail</div><div class="split-fact-v">${detailMeta}</div></div>
          <div><div class="split-fact-k">Updated</div><div class="split-fact-v">${report.when ?? (report.updated_at ? report.updated_at.substring(0, 10) : '—')}</div></div>
        </div>

        ${report.next_action ? html`
          <div class="split-next">
            <div class="split-next-head">
              <span class=${cn('ux-dot', `ux-${mode}`)}></span>
              Next action
              ${isHandToSales ? html`<span class="rs-xdomain">→ sales</span>` : null}
            </div>
            <div class="split-next-body">
              ${report.next_action}
              ${showButton ? html`
                <div style=${{ marginTop: '10px' }}>
                  <button
                    class=${cn('btn', mode === 'approve' && 'btn-primary', 'btn-sm')}
                    type="button"
                    disabled=${handPending}
                    onClick=${() => isHandToSales ? onHandToSales(report) : handleConfirm(report)}
                  >
                    ${isHandToSales ? (handPending ? 'Handing to sales…' : 'Hand to sales') : (mode === 'approve' ? 'Approve & run' : 'Confirm & run')}
                  </button>
                </div>
              ` : null}
            </div>
          </div>
        ` : null}

        <div class="split-next-head" style=${{ marginTop:'12px', marginBottom:'8px' }}>Activity</div>
        <div class="split-timeline" role="list">
          ${ACTIVITY_FIXTURE.map((a) => html`
            <div class="split-tl-row" role="listitem" key=${a.id}>
              <span class="split-tl-dot" aria-hidden="true"></span>
              <div>
                <div>${a.text}</div>
                <div class="split-tl-when">${a.when}</div>
              </div>
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

/** Confirm/run a non-sales next action — seeds a user turn into the active session. */
function handleConfirm(report) {
  if (isStandalone()) return;
  hostSendToActiveSession(
    `Run the next action for research note "${report.title}": ${report.next_action}`,
    'com.ikenga.research',
  ).catch(() => {});
}

/** Reports view — list+detail split (the primary view). */
function ReportsView({ reports, selected, onSelect, onHandToSales, handPending }) {
  const grouped = useMemo(() => {
    const map = {};
    for (const t of TYPE_GROUPS) map[t] = [];
    for (const r of reports) {
      const k = typeKey(r.entity_type);
      if (map[k]) map[k].push(r);
      else map[k] = [r];
    }
    return map;
  }, [reports]);

  return html`
    <div class="ip-split" style=${{ height:'100%', '--ip-list-w':'380px' }}>
      <div class="ip-split-list" style=${{ overflowY:'auto' }} role="grid" aria-label="Research reports list">
        <div class="split-list-head">
          <span class="split-list-title">Research</span>
          <span class="split-list-meta">${reports.length} open</span>
        </div>
        ${typesWithExtras(grouped).map((t) => (grouped[t]?.length ?? 0) > 0 ? html`
          <div class="split-group" key=${t}>
            <div class="split-group-head">${TYPE_LABEL[t] ?? t} · ${grouped[t].length}</div>
            ${grouped[t].map((r) => html`
              <${ReportRow}
                key=${r.id}
                report=${r}
                isSelected=${selected?.id === r.id}
                onSelect=${() => onSelect(r)}
              />
            `)}
          </div>
        ` : null)}
      </div>
      <div class="ip-split-divider" role="separator" aria-hidden="true"></div>
      <${ReportDetail} report=${selected} onHandToSales=${onHandToSales} handPending=${handPending} />
    </div>
  `;
}

/** Sources view — monitored register, KPI strip + dense table. */
function SourcesView({ sources, onRefresh }) {
  const stats = useMemo(() => {
    const tracked = sources.length;
    const stale = sources.filter((s) => s.status === 'stale').length;
    const signals = sources.filter((s) => s.status === 'signal').length;
    const freshToday = sources.filter((s) => /h ago|m ago/.test(s.last_checked ?? '')).length;
    return { tracked, stale, signals, freshToday };
  }, [sources]);

  function statusClass(status) {
    const s = (status ?? '').toLowerCase();
    if (s === 'fresh') return 'is-fresh';
    if (s === 'signal') return 'is-signal';
    if (s === 'stale') return 'is-stale';
    return '';
  }

  return html`
    <div class="rs-source-wrap">
      <div class="rs-source-kpis">
        <div class="rs-source-kpi">
          <span class="rs-kpi-k">Tracked sources</span>
          <span class="rs-kpi-v">${stats.tracked}</span>
          <span class="rs-kpi-sub">4 categories</span>
        </div>
        <div class="rs-source-kpi">
          <span class="rs-kpi-k">Checked today</span>
          <span class="rs-kpi-v">${stats.freshToday}</span>
          <span class="rs-kpi-sub">auto-pull 7am</span>
        </div>
        <div class="rs-source-kpi">
          <span class="rs-kpi-k">Stale</span>
          <span class="rs-kpi-v" style=${{ color:'var(--danger)' }}>${stats.stale}</span>
          <span class="rs-kpi-sub">&gt; threshold</span>
        </div>
        <div class="rs-source-kpi">
          <span class="rs-kpi-k">New signals</span>
          <span class="rs-kpi-v" style=${{ color:'var(--achievement)' }}>${stats.signals}</span>
          <span class="rs-kpi-sub">since yesterday</span>
        </div>
      </div>

      <div class="rs-source-head">
        <span>Source register</span>
        <span class="sub">type · cadence · freshness</span>
      </div>

      <div class="rs-source-card">
        <table class="rs-source-table" role="grid" aria-label="Monitored sources">
          <thead>
            <tr>
              <th>Source</th>
              <th>Type</th>
              <th>Cadence</th>
              <th>Last checked</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${sources.map((s) => html`
              <tr key=${s.id} onClick=${() => onRefresh(s)} role="row" tabIndex=${0}>
                <td class="rs-src-name">${s.name}</td>
                <td><span class="rs-src-badge">${s.type}</span></td>
                <td>${s.cadence}</td>
                <td>${s.last_checked}</td>
                <td><span class=${cn('rs-source-status', statusClass(s.status))}>${s.status}</span></td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/** Personas view — 2-up ICP card grid (local layout, no kit equivalent). */
function PersonasView({ personas }) {
  return html`
    <div class="rs-persona-wrap">
      <div class="rs-persona-head">
        <span>Personas &amp; ICP</span>
        <span class="sub">${personas.length} segments · updated Apr</span>
      </div>
      <div class="rs-persona-grid">
        ${personas.map((p) => html`
          <div class="rs-persona-card" key=${p.id}>
            <span class="rs-persona-tag">${p.tag}</span>
            <div class="rs-persona-name">${p.name}</div>
            <div class="rs-persona-desc">${p.desc}</div>
            <div class="rs-persona-attr"><span>Top pain</span><b>${p.pain}</b></div>
            <div class="rs-persona-attr"><span>Motion</span><b>${p.motion}</b></div>
            <div class="rs-persona-attr"><span>ACV</span><b>${p.acv}</b></div>
            <div class="rs-persona-attr"><span>Fit</span><b>${p.fit}%</b></div>
            <div class="rs-prog" aria-label=${`Fit score ${p.fit}%`}>
              <div class="rs-prog-fill" style=${{ width: `${p.fit}%` }}></div>
            </div>
          </div>
        `)}
      </div>
    </div>
  `;
}

// ─── Loading / empty / error / streaming states ────────────────────────────────

function LoadingState() {
  return html`
    <div class="atelier-state is-loading" id="view-stage">
      <span class="atelier-spin" aria-hidden="true"></span>
      <span>Loading research…</span>
    </div>
  `;
}

function EmptyState() {
  return html`
    <div class="atelier-state is-empty" id="view-stage">
      <h3>No research yet</h3>
      <p>Run your first agent dispatch or draft a report to populate the knowledge surface.</p>
      <button class="btn btn-sm rs-empty-cta" type="button">New report</button>
    </div>
  `;
}

function ErrorState({ error }) {
  return html`
    <div class="atelier-state is-error" id="view-stage">
      <h3>Could not load research</h3>
      <p>Check the ikenga.db connection.</p>
      <span style=${{ fontSize:'0.72rem', color:'var(--fg-muted)', marginTop:'4px' }}>${error}</span>
    </div>
  `;
}

function StreamingState() {
  return html`
    <div class="atelier-state is-streaming" id="view-stage">
      <div class="atelier-prog" role="status" aria-live="polite"><span></span></div>
      <p>Research agent running…</p>
    </div>
  `;
}

// ─── ResearchView root ─────────────────────────────────────────────────────────

export function ResearchView({ activeFeature }) {
  // View state: 0=Reports | 1=Sources | 2=Personas (persisted to localStorage).
  const [activeView, setActiveView] = useState(() => {
    const stored = parseInt(localStorage.getItem('ikenga-research-view') ?? '', 10);
    if ([0, 1, 2].includes(stored)) return stored;
    const p = parseInt(new URLSearchParams(window.location.search).get('view') ?? '0', 10);
    return [0, 1, 2].includes(p) ? p : 0;
  });
  const [selected, setSelected] = useState(null);
  // Last-applied sidebar filter facet id (e.g. 'f:mine', 'f:t:persona'). Kept so
  // the sidebar can re-highlight it while the Reports list is active. Defaults to
  // RESET_FACET ('f:all') = the unfiltered list.
  const [activeFacet, setActiveFacet] = useState(RESET_FACET);
  const qc = useQueryClient();

  // ── Data queries ────────────────────────────────────────────────────────────
  const reportsQ = useQuery({ queryKey: QK.reports, queryFn: fetchReports });
  const sourcesQ = useQuery({ queryKey: QK.sources, queryFn: fetchSources, enabled: activeView === 1 });

  const reports = reportsQ.data ?? [];

  // ── Facet-filtered slice (the sidebar filter actually filters) ──────────────
  // Generic applier (lift-ready) + the domain predicate map. Recomputes only
  // when the source list or the active facet changes; badge counts in the menu
  // still derive from the FULL list so they stay live.
  const visibleReports = useMemo(
    () => applyFacet(reports, activeFacet, FACET_PREDICATES),
    [reports, activeFacet],
  );

  // ── db-updated refresh (refresh on event, not remount) ──────────────────────
  useEffect(() => {
    function onDbUpdated() {
      qc.invalidateQueries({ queryKey: ['research'] });
    }
    window.addEventListener('db-updated', onDbUpdated);
    return () => window.removeEventListener('db-updated', onDbUpdated);
  }, [qc]);

  // ── activeFeature → view switching (side-menu item clicks) ──────────────────
  // PINNED WIRING CONTRACT: shell relays side-menu clicks via host-context re-emit.
  // activeFeature carries royaltiSuite.activeFeature = the clicked item's id.
  useEffect(() => {
    if (!activeFeature) return;

    // View switch (v:*).
    if (activeFeature.startsWith('v:')) {
      if (activeFeature === 'v:reports') setActiveView(0);
      else if (activeFeature === 'v:sources') setActiveView(1);
      else if (activeFeature === 'v:personas') setActiveView(2);
      return;
    }

    // Filter facets (f:* incl. f:t:*) — list-only. Force the Reports view so a
    // facet the user can't currently see can't be silently applied (mirrors
    // tasks' setView('tasks')). 'f:all' resets to the unfiltered list; every
    // other id sets the active facet, which applyFacet turns into the slice.
    if (activeFeature.startsWith('f:')) {
      setActiveView(0);
      setActiveFacet(activeFeature);
      return;
    }
  }, [activeFeature]);

  // ── Persist view ────────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('ikenga-research-view', String(activeView));
  }, [activeView]);

  // ── Pre-select hero report R-01 on mount (Reports view) ─────────────────────
  useEffect(() => {
    if (reports.length > 0 && !selected && activeView === 0) {
      const hero = reports.find((r) => r.id === 'R-01') ?? reports[0];
      setSelected(hero);
    }
  }, [reports, activeView]);

  // ── setMenu publish ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (isStandalone()) return;
    setMenu(buildResearchMenu(activeView, reports, activeFacet)).catch(() => {/* ignore */});
  }, [activeView, reports, activeFacet]);

  // ── Hand-to-sales mutation (R-05 / R-06 cross-domain link) ──────────────────
  // approve-mode action: surface the dossier in the dock chat (approve-gate),
  // then link the research note to a sales deal. Provisional until 0053 lands:
  // append the link into sales_deals.notes (the research_item_id column may not
  // exist yet); once it lands, prefer UPDATE ... SET research_item_id = ?.
  const handToSales = useMutation({
    mutationFn: async (report) => {
      if (isStandalone()) return;
      // 1. Surface the dossier summary in the Chi dock (approve-gate happens there).
      await hostSendToActiveSession(
        `Hand the prospect dossier "${report.title}" to the sales pipeline. Review the dossier and create / update the matching sales deal.`,
        'com.ikenga.research',
      ).catch(() => {});

      // 2. Soft-link the dossier into the matching sales deal.
      const dealId = report.entity_id ?? null;
      const linkText = `\n[research:${report.id}] ${report.title}`;
      if (dealId) {
        // Prefer the formal column once 0053 lands; fall back to notes append.
        try {
          await hostDbExec(
            `UPDATE sales_deals SET research_item_id = ? WHERE id = ?`,
            [report.id, dealId],
          );
        } catch {
          await hostDbExec(
            `UPDATE sales_deals SET notes = COALESCE(notes, '') || ? WHERE id = ?`,
            [linkText, dealId],
          ).catch(() => {});
        }
      }
    },
    onSuccess: () => {
      // Open the Sales pane so the operator lands on the deal.
      hostNavigate('/pkg/com.ikenga.sales/').catch(() => {});
    },
  });

  // ── Head label ──────────────────────────────────────────────────────────────
  const headLabel = activeView === 0
    ? `Research · ${visibleReports.length}${activeFacet !== RESET_FACET ? ` of ${reports.length}` : ''} open`
    : activeView === 1
      ? `Sources · ${(sourcesQ.data ?? SOURCES_FIXTURE).length} monitored`
      : 'Personas';

  // ── Render ──────────────────────────────────────────────────────────────────
  let body;

  if (activeView === 0) {
    if (reportsQ.isLoading) body = html`<${LoadingState} />`;
    else if (reportsQ.isError) body = html`<${ErrorState} error=${reportsQ.error?.message ?? 'unknown'} />`;
    else if (visibleReports.length === 0) body = html`<${EmptyState} />`;
    else body = html`<${ReportsView}
      reports=${visibleReports}
      selected=${selected}
      onSelect=${setSelected}
      onHandToSales=${(r) => handToSales.mutate(r)}
      handPending=${handToSales.isPending}
    />`;
  } else if (activeView === 1) {
    if (sourcesQ.isLoading) body = html`<${LoadingState} />`;
    else body = html`<${SourcesView}
      sources=${sourcesQ.data ?? SOURCES_FIXTURE}
      onRefresh=${(s) => {
        if (!isStandalone()) {
          hostDbExec(`UPDATE research_sources SET status = 'checking' WHERE id = ?`, [s.id]).catch(() => {});
        }
      }}
    />`;
  } else {
    body = html`<${PersonasView} personas=${PERSONAS_FIXTURE} />`;
  }

  return html`
    <div class="frame" style=${{ height:'100%', display:'flex', flexDirection:'column' }}>
      <div class="frame-head" style=${{ display:'flex', alignItems:'center', gap:'8px' }}>
        <!-- Research domain icon (agents tint via .frame-title-mark inheritance) -->
        <svg class="frame-title-mark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="4" y1="6" x2="20" y2="6"></line>
          <line x1="4" y1="12" x2="14" y2="12"></line>
          <line x1="4" y1="18" x2="9" y2="18"></line>
        </svg>
        <span class="frame-title">${headLabel}</span>
        <button class="btn btn-primary btn-sm" type="button" style=${{ marginLeft:'auto' }}>New report</button>
      </div>
      <div class="frame-body-flush" id="view-stage" style=${{ flex:1, overflow:'hidden' }}>
        ${body}
      </div>
    </div>
  `;
}
