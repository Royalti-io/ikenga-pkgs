// Finance main view — Overview / Transactions / Receivables / Inter-Company / Reports.
//
// Composition follows plans/atelier-design-system/parts/screens/finance.md §§1–4:
//   Views: overview | transactions | receivables | inter-company | reports
//
//   Kit parts consumed:
//   - .frame / .frame-head / .frame-body (part 30 pkg-pane-frame)
//   - .stat-card / .stat-card.is-warn / .stat-card.is-danger (part 21 card)
//   - .frame-tab / .frame-tab.is-on / .tab-count (part 14 segmented-tabs)
//   - .pane-toolbar / .pane-filterbar / .pane-filterbar-search (part 33)
//   - .nav-group[data-kind] / .nav-item / .is-on / .is-dim (part 22)
//   - .badge / .badge-primary / .badge-achievement / .badge-danger (part 11)
//   - .atelier-state.is-{loading,empty,error,streaming} / .atelier-spin (part 26)
//   - .dense-row (part 20 table-dense-row)
//   - .btn / .btn-icon / .btn-sm (part 10 buttons)
//
//   Domain-local (finance.css .fin-*):
//   - .fin-kpi* — KPI strip internals
//   - .fin-gauge* — runway semicircle SVG
//   - .fin-treemap* — cash-by-entity treemap
//   - .fin-alerts* — alert strip
//   - .fin-table* / .fin-money-cell / .fin-days-cell — ledger table
//   - .fin-summary-strip* — transactions summary bar
//   - .fin-aging* / .bk-* — receivables aging buckets
//   - .fin-queue-* — inter-company pair queue
//   - .fin-report-* / .fin-deferred-note — reports tab
//   - .entity-switch / .dot / .ent-* — EntitySwitcher
//   - .btn-confirm / .btn-dispute — inline match action buttons
//   - .cc-native — currency sub-line
//
// Data: host.dbQuery + host.dbExec via AppBridge. TanStack Query for caching.
// Migration: 0046_finance_domain.sql — finance_alerts table.
// Mock contract 1: alert-strip fallback until 0046 lands.

import {
  html, cn,
  useState, useEffect, useMemo, useCallback, useRef,
  useQuery, useMutation, useQueryClient,
} from '../../lib/ui.js';
import { hostDbQuery, hostDbExec, setMenu, isStandalone } from '../../lib/bridge.js';

// ─── View enum ────────────────────────────────────────────────────────────────

const VIEWS = ['overview', 'transactions', 'receivables', 'inter-company', 'reports'];

const VIEW_LABELS = {
  overview:       'Overview',
  transactions:   'Transactions',
  receivables:    'Receivables',
  'inter-company':'Inter-Company',
  reports:        'Reports',
};

// ─── Entity enum ──────────────────────────────────────────────────────────────

const ENTITIES = ['all', 'royalti', 'dixtrit', 'personal'];
const ENTITY_LABELS = { all: 'All', royalti: 'Royalti.io', dixtrit: 'Dixtrit.media', personal: 'Personal' };

// ─── Fixture data (canonical — mirrors finance.md §1) ─────────────────────────
// Used as documented fallback until real data is present in ikenga.db.

const FIXTURE_ALERTS = [
  { id: 'a1', type: 'interco', severity: 'warn', message: '2 inter-company pairs await reconciliation — Royalti.io ↔ Dixtrit.media · $4,820', linked_id: null },
  { id: 'a2', type: 'ar',      severity: 'crit', message: 'Valentim de Carvalho invoice INV-2026-038 31 days overdue — $2,400 · contract signed', linked_id: 'INV-2026-038' },
  { id: 'a3', type: 'tax',     severity: 'warn', message: 'LIRS PAYE filing overdue since Feb 2024 — recalc + remit', linked_id: null },
];

const FIXTURE_KPIS = {
  cash:    { value: '$48,210', sub: '+4.2% MoM', dir: 'up' },
  burn:    { value: '$8,420',  sub: '−3.1% vs avg', dir: 'up' },
  runway:  { value: '5.7 mo', sub: 'Target ≥ 12 mo', dir: 'warn', isWarn: true },
  ar:      { value: '$6,180',  sub: '3 overdue · 1 critical', dir: 'down' },
};

const FIXTURE_TREEMAP = [
  { entity: 'Royalti.io (USD)', value: '$32,140', native: '' },
  { entity: 'Royalti.io (NGN)', value: '$4,820',  native: '₦7,454,200' },
  { entity: 'Dixtrit.media',   value: '$8,920',  native: '' },
  { entity: 'Personal (NGN)',  value: '$2,330',  native: '₦3,602,950' },
];

const FIXTURE_TRANSACTIONS = [
  { id: 't1', txn_date: '2026-05-02', entity: 'Royalti.io', description: 'Stripe payout · 11 subscription invoices (Mercury …8423)', category: 'Revenue · SaaS',    match_state: 'Paired',        amount_usd: 1840.20, sign: 1  },
  { id: 't2', txn_date: '2026-05-01', entity: 'Royalti.io', description: 'AWS · EC2 + S3 + CloudFront (Mercury …8423)',                  category: 'Infra · Cloud',  match_state: 'Paired',        amount_usd: -612.40,  sign: -1 },
  { id: 't3', txn_date: '2026-04-30', entity: 'Dixtrit',    description: 'Verto inflow · CodeNation Lda retainer (€2,000 @ 1.10)',       category: 'Revenue · Services', match_state: 'Paired',    amount_usd: 2200.00, sign: 1  },
  { id: 't4', txn_date: '2026-04-29', entity: 'Royalti.io', description: 'Kuda · payroll · founder salary (₦480,000)',                   category: 'Payroll',        match_state: 'Paired',        amount_usd: -311.80,  sign: -1 },
  { id: 't5', txn_date: '2026-04-28', entity: 'Royalti.io', description: 'Inter-co transfer → Personal · Hetzner reimbursement',         category: 'Inter-company',  match_state: 'Suggested 92%', amount_usd: -84.00,   sign: -1 },
  { id: 't6', txn_date: '2026-04-26', entity: 'Royalti.io', description: 'Verto · FUGA DDEX provider invoice (Q2 portion)',              category: 'Infra · DDEX',  match_state: 'Unmatched',     amount_usd: -1250.00, sign: -1 },
];

const FIXTURE_RECEIVABLES = [
  { id: 'r1', document_no: 'INV-2026-038', customer: 'Valentim de Carvalho', currency: 'EUR', balance_left: 2400, days: 31, invoice_status: 'overdue'  },
  { id: 'r2', document_no: 'INV-041',      customer: 'CodeNation Lda',       currency: 'EUR', balance_left: 680,  days: 11, invoice_status: 'overdue'  },
  { id: 'r3', document_no: 'INV-042',      customer: 'Phyx Mvmt',            currency: 'GBP', balance_left: 440,  days: 8,  invoice_status: 'open'     },
  { id: 'r4', document_no: 'INV-045',      customer: 'CapaSound Records',    currency: 'USD', balance_left: 1460, days: 0,  invoice_status: 'open'     },
  { id: 'r5', document_no: 'INV-046',      customer: 'Indie Music Label Co', currency: 'USD', balance_left: 1200, days: 0,  invoice_status: 'open'     },
];

const FIXTURE_INTERCO = [
  { id: 'ic1', source_entity: 'Royalti.io', destination_entity: 'Dixtrit.media', amount_usd: 4820, transfer_type: 'reimbursement', reconciliation_status: 'pending',    running_balance_usd: 4820  },
  { id: 'ic2', source_entity: 'Personal',   destination_entity: 'Royalti.io',    amount_usd: 84,   transfer_type: 'reimbursement', reconciliation_status: 'pending',    running_balance_usd: 84    },
];

const FIXTURE_WF = [
  { label: 'Nov', amount: 6200,  isPos: true },
  { label: 'Dec', amount: 1400,  isPos: true },
  { label: 'Jan', amount: -3800, isPos: false },
  { label: 'Feb', amount: 9400,  isPos: true },
  { label: 'Mar', amount: -2100, isPos: false },
  { label: 'Apr', amount: 5600,  isPos: true },
];

// ─── Query keys ───────────────────────────────────────────────────────────────

const QK = {
  kpis:         ['finance', 'kpis'],
  alerts:       ['finance', 'alerts'],
  transactions: (entity) => ['finance', 'transactions', entity],
  receivables:  ['finance', 'receivables'],
  interco:      ['finance', 'interco'],
};

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchAlerts() {
  // Mock contract 1: seed alerts from real receivables + inter-company data
  // until 0046_finance_domain.sql creates the finance_alerts table.
  if (isStandalone()) return FIXTURE_ALERTS;
  try {
    const rows = await hostDbQuery(
      `SELECT id, type, severity, message, linked_id, status
       FROM finance_alerts
       WHERE status != 'dismissed'
       ORDER BY severity DESC, created_at DESC
       LIMIT 20`
    );
    if (rows.length > 0) return rows;
    // Fallback: derive from real overdue receivables and unreconciled interco entries.
    const [arRows, intercoRows] = await Promise.all([
      hostDbQuery(
        `SELECT document_no, customer, balance_left, currency
         FROM receivables
         WHERE invoice_status = 'overdue'
         ORDER BY balance_left DESC
         LIMIT 5`
      ).catch(() => []),
      hostDbQuery(
        `SELECT source_entity, destination_entity, amount_usd
         FROM inter_company_entries
         WHERE reconciliation_status != 'reconciled'
         ORDER BY amount_usd DESC
         LIMIT 3`
      ).catch(() => []),
    ]);
    const derived = [];
    for (const r of arRows) {
      derived.push({
        id: `ar-${r.document_no}`,
        type: 'ar',
        severity: parseFloat(r.balance_left) > 2000 ? 'crit' : 'warn',
        message: `${r.customer} invoice ${r.document_no} overdue — ${r.currency} ${Number(r.balance_left).toLocaleString()}`,
        linked_id: r.document_no,
      });
    }
    for (const ic of intercoRows) {
      derived.push({
        id: `ic-${ic.source_entity}`,
        type: 'interco',
        severity: 'warn',
        message: `Inter-company pair ${ic.source_entity} ↔ ${ic.destination_entity} awaits reconciliation — $${Number(ic.amount_usd).toLocaleString()}`,
        linked_id: null,
      });
    }
    return derived.length ? derived : FIXTURE_ALERTS;
  } catch {
    return FIXTURE_ALERTS;
  }
}

async function fetchTransactions(entity = 'all') {
  if (isStandalone()) return FIXTURE_TRANSACTIONS;
  try {
    const entityFilter = entity === 'all' ? '' : 'AND entity LIKE ?';
    const params = entity === 'all' ? [] : [`%${entity}%`];
    const rows = await hostDbQuery(
      `SELECT id, txn_date, entity, description, payment_type AS category,
              amount_usd, type
       FROM transaction_ledger
       WHERE 1=1 ${entityFilter}
       ORDER BY txn_date DESC, id DESC
       LIMIT 100`,
      params
    );
    if (!rows.length) return FIXTURE_TRANSACTIONS;
    return rows.map((r) => ({
      ...r,
      amount_usd: parseFloat(r.amount_usd) || 0,
      sign: (parseFloat(r.amount_usd) || 0) >= 0 ? 1 : -1,
      match_state: r.type === 'credit' || r.type === 'debit' ? 'Paired' : 'Unmatched',
      category: r.category || '—',
    }));
  } catch {
    return FIXTURE_TRANSACTIONS;
  }
}

async function fetchReceivables() {
  if (isStandalone()) return FIXTURE_RECEIVABLES;
  try {
    const rows = await hostDbQuery(
      `SELECT id, document_no, customer, currency, balance_left, invoice_status,
              due_date, invoice_date
       FROM receivables
       ORDER BY balance_left DESC`
    );
    if (!rows.length) return FIXTURE_RECEIVABLES;
    const today = Date.now();
    return rows.map((r) => {
      const dueMs = r.due_date ? new Date(r.due_date).getTime() : 0;
      const days = dueMs && dueMs < today ? Math.floor((today - dueMs) / 86400000) : 0;
      return { ...r, days, balance_left: parseFloat(r.balance_left) || 0 };
    });
  } catch {
    return FIXTURE_RECEIVABLES;
  }
}

async function fetchInterco() {
  if (isStandalone()) return FIXTURE_INTERCO;
  try {
    const rows = await hostDbQuery(
      `SELECT id, source_entity, destination_entity, amount_usd, transfer_type,
              reconciliation_status, running_balance_usd
       FROM inter_company_entries
       ORDER BY id DESC
       LIMIT 50`
    );
    if (!rows.length) return FIXTURE_INTERCO;
    return rows.map((r) => ({
      ...r,
      amount_usd: parseFloat(r.amount_usd) || 0,
      running_balance_usd: parseFloat(r.running_balance_usd) || 0,
    }));
  } catch {
    return FIXTURE_INTERCO;
  }
}

async function confirmMatch(txnId) {
  if (isStandalone()) return;
  await hostDbExec(
    `UPDATE transaction_ledger SET type = 'paired' WHERE id = ?`,
    [txnId]
  );
}

async function disputeMatch(txnId) {
  if (isStandalone()) return;
  await hostDbExec(
    `UPDATE transaction_ledger SET type = 'disputed' WHERE id = ?`,
    [txnId]
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtUSD(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n) || n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${(abs / 1_000).toFixed(0)}K`;
  return `$${abs.toFixed(0)}`;
}

function fmtUSDFull(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n) || n == null) return '—';
  const sign = n < 0 ? '−' : '+';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysClass(days, status) {
  if (days === 0 || status === 'open') return 'ok';
  if (days <= 30)  return 'warn';
  if (days <= 60)  return 'late';
  return 'crit';
}

function agingClass(days) {
  if (days === 0) return 'bk-current';
  if (days <= 30) return 'bk-1-30';
  if (days <= 60) return 'bk-31-60';
  return 'bk-60';
}

// ─── Menu builder ────────────────────────────────────────────────────────────

function buildFinanceMenu(activeView, arAlerts, intercoAlerts, entity) {
  const hasArAlert = arAlerts > 0;
  const hasIntercoAlert = intercoAlerts > 0;
  return [
    { id: 'section-views', label: 'Views', section: true },
    { id: 'overview',        label: 'Overview',       icon: 'home',        active: activeView === 'overview',        section: 'view' },
    { id: 'transactions',    label: 'Transactions',   icon: 'list',        active: activeView === 'transactions',    section: 'view' },
    { id: 'receivables',     label: 'Receivables',    icon: 'file-text',   active: activeView === 'receivables',     section: 'view', badge: hasArAlert ? String(arAlerts) : undefined },
    { id: 'inter-company',   label: 'Inter-Company',  icon: 'arrow-left-right', active: activeView === 'inter-company', section: 'view', badge: hasIntercoAlert ? String(intercoAlerts) : undefined },
    { id: 'reports',         label: 'Reports',        icon: 'bar-chart-2', active: activeView === 'reports',         section: 'view' },
    { id: 'section-accounts', label: 'Accounts', section: true, disabled: activeView !== 'transactions' },
    { id: 'ent-all',      label: 'All entities',   icon: 'layers',    section: 'filter', active: entity === 'all',      disabled: activeView !== 'transactions' },
    { id: 'ent-royalti',  label: 'Royalti.io',     icon: 'circle',    section: 'filter', active: entity === 'royalti',  disabled: activeView !== 'transactions' },
    { id: 'ent-dixtrit',  label: 'Dixtrit.media',  icon: 'circle',    section: 'filter', active: entity === 'dixtrit',  disabled: activeView !== 'transactions' },
    { id: 'ent-personal', label: 'Personal',        icon: 'circle',    section: 'filter', active: entity === 'personal', disabled: activeView !== 'transactions' },
  ];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EntitySwitcher({ entity, onChange }) {
  return html`
    <div class="entity-switch" role="tablist" aria-label="Entity">
      ${ENTITIES.map((e) => html`
        <button
          key=${e}
          role="tab"
          aria-selected=${entity === e}
          class=${entity === e ? 'is-on' : ''}
          onClick=${() => onChange(e)}
        >
          <span class=${`dot ent-${e}`} aria-hidden="true"></span>
          ${ENTITY_LABELS[e]}
        </button>
      `)}
    </div>
  `;
}

function AlertStrip({ alerts }) {
  if (!alerts || alerts.length === 0) return null;
  return html`
    <div class="fin-alerts" role="region" aria-label="Alerts" aria-live="polite">
      ${alerts.map((a) => html`
        <div key=${a.id} class=${`fin-alerts-item${a.severity === 'crit' ? ' is-critical' : ''}`}>
          <svg class=${`fin-alerts-icon${a.severity === 'crit' ? ' is-critical' : ''}`} viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M7 2L12 11H2L7 2Z" />
            <path d="M7 6v2.5M7 9.5v.5" stroke-linecap="round" />
          </svg>
          <span class="fin-alerts-msg">${a.message}</span>
          ${a.linked_id ? html`<span class="fin-alerts-action">View →</span>` : null}
        </div>
      `)}
    </div>
  `;
}

function KpiStrip({ alerts }) {
  const runwayMonths = 5.7;
  const isWarn = runwayMonths < 12;

  // Sparkline points (decorative fixture — runtime would aggregate monthly net from transaction_ledger)
  const sparkUp = '0,20 10,16 22,18 34,12 46,14 58,8 64,4';
  const sparkDown = '0,8 10,12 22,10 34,16 46,14 58,18 64,20';

  return html`
    <div class="fin-kpi-grid">
      <!-- Cash -->
      <div class="stat-card" role="region" aria-label="Cash USD: $48,210, up 4.2%">
        <div class="fin-kpi">
          <span class="fin-kpi-label">Cash · USD</span>
          <span class="fin-kpi-value">${FIXTURE_KPIS.cash.value}</span>
          <span class=${`fin-kpi-sub is-${FIXTURE_KPIS.cash.dir}`}>${FIXTURE_KPIS.cash.sub}</span>
          <svg class="fin-kpi-spark" viewBox="0 0 64 24" preserveAspectRatio="none" aria-hidden="true">
            <polyline class="is-up" points=${sparkUp} />
          </svg>
        </div>
      </div>

      <!-- Burn -->
      <div class="stat-card" role="region" aria-label="Burn per month: $8,420, down 3.1%">
        <div class="fin-kpi">
          <span class="fin-kpi-label">Burn / mo</span>
          <span class="fin-kpi-value">${FIXTURE_KPIS.burn.value}</span>
          <span class=${`fin-kpi-sub is-${FIXTURE_KPIS.burn.dir}`}>${FIXTURE_KPIS.burn.sub}</span>
          <svg class="fin-kpi-spark" viewBox="0 0 64 24" preserveAspectRatio="none" aria-hidden="true">
            <polyline class="is-down" points=${sparkDown} />
          </svg>
        </div>
      </div>

      <!-- Runway — .is-warn at < 12 mo -->
      <div class=${`stat-card${isWarn ? ' is-warn' : ''}`}
           role="region"
           aria-label=${`Runway: ${runwayMonths} months, warning — target 12 months`}>
        <div class="fin-kpi">
          <span class="fin-kpi-label">Runway</span>
          <span class="fin-kpi-value">${FIXTURE_KPIS.runway.value}</span>
          <span class="fin-kpi-sub">${FIXTURE_KPIS.runway.sub}</span>
          <!-- Runway gauge SVG -->
          <svg class="fin-gauge" viewBox="0 0 120 64" aria-hidden="true">
            <title>Runway: ${runwayMonths} months of ${12} month target</title>
            <path d="M10,60 A50,50 0 0,1 110,60" class="fin-gauge-bg" />
            <path d="M10,60 A50,50 0 0,1 ${10 + 100 * Math.min(runwayMonths / 12, 1)},${60 - Math.sin(Math.PI * Math.min(runwayMonths / 12, 1)) * 50}"
                  class=${`fin-gauge-fg${isWarn ? ' is-warn' : ''}`} />
            <text x="60" y="54" text-anchor="middle" class="fin-gauge-center">${runwayMonths}mo</text>
            <text x="60" y="64" text-anchor="middle" class="fin-gauge-label">of 12 mo</text>
          </svg>
        </div>
      </div>

      <!-- A/R -->
      <div class="stat-card is-danger" role="region" aria-label="Accounts receivable outstanding: $6,180, 3 overdue 1 critical">
        <div class="fin-kpi">
          <span class="fin-kpi-label">A/R Outstanding</span>
          <span class="fin-kpi-value">${FIXTURE_KPIS.ar.value}</span>
          <span class=${`fin-kpi-sub is-${FIXTURE_KPIS.ar.dir}`}>${FIXTURE_KPIS.ar.sub}</span>
          <svg class="fin-kpi-spark" viewBox="0 0 64 24" preserveAspectRatio="none" aria-hidden="true">
            <polyline class="is-down" points=${sparkDown} />
          </svg>
        </div>
      </div>
    </div>
  `;
}

function NetCashWaterfall() {
  const maxAbs = Math.max(...FIXTURE_WF.map((b) => Math.abs(b.amount)));
  return html`
    <div class="fin-wf" aria-label="Net cash flow last 6 months">
      ${FIXTURE_WF.map((bar) => {
        const h = Math.round((Math.abs(bar.amount) / maxAbs) * 60);
        return html`
          <div key=${bar.label} class="fin-wf-bar">
            <div class=${`fin-wf-bar-inner${bar.isPos ? '' : ' is-neg'}`} style=${{ height: `${h}px` }}></div>
            <span class="fin-wf-axis">${bar.label}</span>
            <span class="fin-wf-axis" style=${{ color: bar.isPos ? 'var(--systemic)' : 'var(--danger)', fontSize: '9px' }}>
              ${bar.isPos ? '+' : ''}${(bar.amount / 1000).toFixed(1)}K
            </span>
          </div>
        `;
      })}
    </div>
  `;
}

function Treemap() {
  return html`
    <div class="fin-treemap" aria-label="Cash by entity">
      ${FIXTURE_TREEMAP.map((cell) => html`
        <div key=${cell.entity} class="fin-treemap-cell">
          <span class="fin-treemap-entity">${cell.entity}</span>
          <span class="fin-treemap-value">${cell.value}</span>
          ${cell.native ? html`<span class="fin-treemap-native">${cell.native}</span>` : null}
        </div>
      `)}
    </div>
  `;
}

function OverviewTab({ alerts }) {
  return html`
    <div class="frame-body" style=${{ overflowY: 'auto' }}>
      ${html`<${AlertStrip} alerts=${alerts} />`}
      ${html`<${KpiStrip} />`}
      <div style=${{ padding: '12px 16px 0', fontSize: '11px', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Net Cash Flow (6 mo)
      </div>
      ${html`<${NetCashWaterfall} />`}
      <div style=${{ padding: '12px 16px 0', fontSize: '11px', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Cash by Entity
      </div>
      ${html`<${Treemap} />`}
    </div>
  `;
}

function TransactionsTab({ transactions, isLoading, entity, onEntityChange, onConfirm, onDispute }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return transactions;
    const q = search.toLowerCase();
    return transactions.filter(
      (t) =>
        t.description?.toLowerCase().includes(q) ||
        t.entity?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q)
    );
  }, [transactions, search]);

  const inflow = useMemo(
    () => filtered.filter((t) => t.amount_usd >= 0).reduce((s, t) => s + t.amount_usd, 0),
    [filtered]
  );
  const outflow = useMemo(
    () => filtered.filter((t) => t.amount_usd < 0).reduce((s, t) => s + t.amount_usd, 0),
    [filtered]
  );
  const net = inflow + outflow;

  return html`
    <div class="frame-body" style=${{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <!-- Filterbar -->
      <div class="pane-toolbar pane-toolbar-sticky">
        <div class="pane-filterbar">
          <div class="pane-filterbar-search">
            <input
              type="search"
              placeholder="Search transactions…"
              value=${search}
              onInput=${(e) => setSearch(e.target.value)}
              aria-label="Search transactions"
            />
          </div>
          <div class="pane-filterbar-spacer"></div>
          ${html`<${EntitySwitcher} entity=${entity} onChange=${onEntityChange} />`}
        </div>
      </div>

      <!-- Summary strip -->
      <div class="fin-summary-strip">
        <div class="fin-summary-card">
          <span class="fin-summary-label">Inflow</span>
          <span class="fin-summary-value is-positive">${fmtUSD(inflow)}</span>
        </div>
        <div class="fin-summary-card">
          <span class="fin-summary-label">Outflow</span>
          <span class="fin-summary-value is-negative">${fmtUSD(Math.abs(outflow))}</span>
        </div>
        <div class="fin-summary-card">
          <span class="fin-summary-label">Net</span>
          <span class=${`fin-summary-value${net >= 0 ? ' is-positive' : ' is-negative'}`}>${fmtUSD(Math.abs(net))}</span>
        </div>
        <div class="fin-summary-card">
          <span class="fin-summary-label">Transactions</span>
          <span class="fin-summary-value">${filtered.length}</span>
        </div>
      </div>

      ${isLoading
        ? html`<div class="atelier-state is-loading"><div class="atelier-spin" aria-label="Loading transactions…"></div></div>`
        : filtered.length === 0
        ? html`<div class="atelier-state is-empty"><p>No transactions match these filters.</p></div>`
        : html`
          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Entity</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Match</th>
                  <th class="align-right">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map((t) => {
                  const isSuggested = t.match_state?.startsWith('Suggested');
                  return html`
                    <tr key=${t.id}>
                      <td>${t.txn_date?.substring(0, 10) ?? '—'}</td>
                      <td>
                        <span class="badge">${t.entity ?? '—'}</span>
                      </td>
                      <td style=${{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ${t.description ?? '—'}
                      </td>
                      <td style=${{ color: 'var(--fg-muted)' }}>${t.category ?? '—'}</td>
                      <td>
                        <span class=${`badge${
                          t.match_state === 'Paired'    ? ' badge-achievement' :
                          t.match_state === 'Unmatched' ? ' badge-danger' :
                          isSuggested                   ? ' badge-primary' : ''
                        }`}>
                          ${t.match_state ?? '—'}
                        </span>
                      </td>
                      <td class="align-right">
                        <span class=${`fin-money-cell${t.amount_usd >= 0 ? ' is-positive' : ' is-negative'}`}>
                          ${fmtUSDFull(t.amount_usd)}
                        </span>
                      </td>
                      <td>
                        ${isSuggested
                          ? html`
                            <div class="fin-queue-actions">
                              <button
                                class="btn-confirm"
                                aria-label=${`Confirm match for ${t.description}`}
                                onClick=${() => onConfirm(t.id)}
                              >Confirm</button>
                              <button
                                class="btn-dispute"
                                aria-label=${`Dispute match for ${t.description}`}
                                onClick=${() => onDispute(t.id)}
                              >Dispute</button>
                            </div>
                          `
                          : null}
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>
        `}
    </div>
  `;
}

function ReceivablesTab({ receivables, isLoading }) {
  const buckets = useMemo(() => {
    const b = { current: [], '1-30': [], '31-60': [], '60+': [] };
    for (const r of receivables) {
      if (r.days === 0 || r.invoice_status === 'open') b.current.push(r);
      else if (r.days <= 30)  b['1-30'].push(r);
      else if (r.days <= 60)  b['31-60'].push(r);
      else                    b['60+'].push(r);
    }
    return b;
  }, [receivables]);

  const bucketTotal = (key) =>
    buckets[key].reduce((s, r) => s + (r.balance_left || 0), 0);

  return html`
    <div class="frame-body" style=${{ overflowY: 'auto' }}>
      ${isLoading
        ? html`<div class="atelier-state is-loading"><div class="atelier-spin" aria-label="Loading receivables…"></div></div>`
        : html`
          <!-- Aging buckets -->
          <div class="fin-aging">
            ${[
              { key: 'current', label: 'Current',  cls: 'bk-current' },
              { key: '1-30',    label: '1–30d',     cls: 'bk-1-30'   },
              { key: '31-60',   label: '31–60d',    cls: 'bk-31-60'  },
              { key: '60+',     label: '60+d',      cls: 'bk-60'     },
            ].map(({ key, label, cls }) => html`
              <div key=${key} class=${`fin-aging-bucket ${cls}`}>
                <span class="fin-aging-bucket-label">${label}</span>
                <span class="fin-aging-bucket-amount">${fmtUSD(bucketTotal(key))}</span>
                <span class="fin-aging-bucket-count">${buckets[key].length} invoice${buckets[key].length === 1 ? '' : 's'}</span>
              </div>
            `)}
          </div>

          <!-- Invoice table -->
          <div class="fin-table-wrap">
            <table class="fin-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Invoice</th>
                  <th>Currency</th>
                  <th class="align-right">Balance</th>
                  <th class="align-right">Days</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${receivables.map((r) => {
                  const dc = daysClass(r.days, r.invoice_status);
                  return html`
                    <tr key=${r.id}>
                      <td style=${{ fontWeight: r.days > 30 ? 600 : 400 }}>${r.customer}</td>
                      <td style=${{ color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>${r.document_no}</td>
                      <td>${r.currency}</td>
                      <td class="align-right">
                        <span class="fin-money-cell">${fmtUSD(r.balance_left)}</span>
                      </td>
                      <td class="align-right">
                        <span class=${`fin-days-cell ${dc}`}>${r.days > 0 ? `${r.days}d` : 'Current'}</span>
                      </td>
                      <td>
                        <span class=${`badge${
                          r.invoice_status === 'overdue' ? ' badge-danger' :
                          r.invoice_status === 'open'    ? ' badge-primary' : ''
                        }`}>
                          ${r.invoice_status}
                        </span>
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>
        `}
    </div>
  `;
}

function InterCompanyTab({ entries, isLoading }) {
  const pending   = useMemo(() => entries.filter((e) => e.reconciliation_status !== 'reconciled'), [entries]);
  const completed = useMemo(() => entries.filter((e) => e.reconciliation_status === 'reconciled'), [entries]);

  const QueueRow = ({ entry }) => html`
    <div class="fin-queue-row">
      <div class="fin-queue-side">
        <span class="fin-queue-entity">${entry.source_entity}</span>
        <span class="fin-queue-meta">${entry.transfer_type}</span>
      </div>
      <div>
        <div class="fin-queue-pair" aria-hidden="true">⇄</div>
        <div class="fin-queue-amount">${fmtUSD(entry.amount_usd)}</div>
        <div class="fin-queue-reason">${entry.reconciliation_status}</div>
      </div>
      <div class="fin-queue-side">
        <span class="fin-queue-entity">${entry.destination_entity}</span>
        <span class="fin-queue-meta">→</span>
      </div>
      <div class="fin-queue-actions" style=${{ opacity: 1, flexDirection: 'column' }}>
        <span class="badge badge-achievement">${entry.reconciliation_status}</span>
      </div>
    </div>
  `;

  return html`
    <div class="frame-body" style=${{ overflowY: 'auto' }}>
      ${isLoading
        ? html`<div class="atelier-state is-loading"><div class="atelier-spin" aria-label="Loading inter-company entries…"></div></div>`
        : html`
          <div style=${{ padding: '12px 16px 8px', fontSize: '11px', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Pending reconciliation (${pending.length})
          </div>
          ${pending.length === 0
            ? html`<div class="atelier-state is-empty"><p>All inter-company entries reconciled.</p></div>`
            : pending.map((e) => html`<${QueueRow} key=${e.id} entry=${e} />`)}
          ${completed.length > 0 ? html`
            <div style=${{ padding: '12px 16px 8px', fontSize: '11px', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderTop: '1px solid var(--border-soft)', marginTop: '8px' }}>
              Reconciled (${completed.length})
            </div>
            ${completed.map((e) => html`<${QueueRow} key=${e.id} entry=${e} />`)}
          ` : null}
        `}
    </div>
  `;
}

function ReportsTab() {
  return html`
    <div class="frame-body" style=${{ overflowY: 'auto' }}>
      <div style=${{ padding: '16px 16px 8px', fontSize: '11px', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Period Summary
      </div>

      <!-- Summary KPIs -->
      <div class="fin-summary-strip" style=${{ borderTop: 'none' }}>
        ${[
          { label: 'Total Revenue', value: '$24,040', cls: 'is-positive' },
          { label: 'Total Expenses', value: '$12,818', cls: 'is-negative' },
          { label: 'Net (May 2026)', value: '+$11,222', cls: 'is-positive' },
          { label: 'YTD Net', value: '+$16,700', cls: 'is-positive' },
        ].map(({ label, value, cls }) => html`
          <div key=${label} class="fin-summary-card">
            <span class="fin-summary-label">${label}</span>
            <span class=${`fin-summary-value ${cls}`}>${value}</span>
          </div>
        `)}
      </div>

      <!-- Deferred export note -->
      <div class="fin-deferred-note" aria-label="Export deferred">
        <strong>Full P&amp;L export</strong> is deferred to WP-23.<br/>
        CSV export, balance sheet, and income statement will be available in the next release.
      </div>
    </div>
  `;
}

// ─── Finance main view ────────────────────────────────────────────────────────

export function FinanceView({ activeFeature }) {
  const [view, setView] = useState('overview');
  const [entity, setEntity] = useState('all');
  const queryClient = useQueryClient();

  // Resolve active view from side-menu click (activeFeature = nav item id).
  useEffect(() => {
    if (!activeFeature) return;
    // Sidebar nav item ids match VIEWS.
    if (VIEWS.includes(activeFeature)) {
      setView(activeFeature);
    } else if (activeFeature.startsWith('ent-')) {
      // Sidebar "Accounts" facet group → entity filter (Transactions view).
      const ent = activeFeature.slice(4);
      if (ENTITIES.includes(ent)) setEntity(ent);
    }
  }, [activeFeature]);

  // Listen for db-updated events to refresh data.
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] });
    };
    window.addEventListener('db-updated', handler);
    return () => window.removeEventListener('db-updated', handler);
  }, [queryClient]);

  // Queries
  const alertsQ = useQuery({
    queryKey: QK.alerts,
    queryFn: fetchAlerts,
    staleTime: 30_000,
  });

  const txnsQ = useQuery({
    queryKey: QK.transactions(entity),
    queryFn: () => fetchTransactions(entity),
    staleTime: 30_000,
    enabled: view === 'transactions' || view === 'overview',
  });

  const arQ = useQuery({
    queryKey: QK.receivables,
    queryFn: fetchReceivables,
    staleTime: 30_000,
    enabled: view === 'receivables' || view === 'overview',
  });

  const intercoQ = useQuery({
    queryKey: QK.interco,
    queryFn: fetchInterco,
    staleTime: 30_000,
    enabled: view === 'inter-company' || view === 'overview',
  });

  // Mutations
  const confirmMut = useMutation({
    mutationFn: confirmMatch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'transactions'] });
    },
  });

  const disputeMut = useMutation({
    mutationFn: disputeMatch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'transactions'] });
    },
  });

  // Side-menu publishing
  const alerts = alertsQ.data ?? FIXTURE_ALERTS;
  const arAlertCount = alerts.filter((a) => a.type === 'ar').length;
  const intercoAlertCount = alerts.filter((a) => a.type === 'interco').length;

  useEffect(() => {
    const items = buildFinanceMenu(view, arAlertCount, intercoAlertCount, entity);
    setMenu(items).catch(() => {});
  }, [view, arAlertCount, intercoAlertCount, entity]);

  // Error state
  if (txnsQ.isError && view === 'transactions') {
    return html`<div class="atelier-state is-error"><p>Could not load transactions — check your connection.</p></div>`;
  }

  const tabs = [
    { id: 'overview',       label: 'Overview' },
    { id: 'transactions',   label: 'Transactions' },
    { id: 'receivables',    label: 'Receivables',   badge: arAlertCount > 0 ? arAlertCount : null },
    { id: 'inter-company',  label: 'Inter-Company', badge: intercoAlertCount > 0 ? intercoAlertCount : null },
    { id: 'reports',        label: 'Reports' },
  ];

  return html`
    <div class="frame" style=${{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <!-- Frame head -->
      <div class="frame-head">
        <span class="frame-title">Accounting</span>
        <span class="frame-sub">Finance · Multi-entity ledger</span>
        <div style=${{ marginLeft: 'auto' }}>
          ${html`<${EntitySwitcher} entity=${entity} onChange=${setEntity} />`}
        </div>
      </div>

      <!-- Frame tabs -->
      <div class="frame-tabs" role="tablist" aria-label="Finance views">
        ${tabs.map(({ id, label, badge }) => html`
          <button
            key=${id}
            class=${`frame-tab${view === id ? ' is-on' : ''}`}
            role="tab"
            aria-selected=${view === id}
            aria-controls=${`panel-${id}`}
            onClick=${() => setView(id)}
          >
            ${label}
            ${badge ? html`<span class="tab-count badge badge-danger" aria-label="${badge} alert${badge === 1 ? '' : 's'}">${badge}</span>` : null}
          </button>
        `)}
      </div>

      <!-- Tab panels -->
      <div id="panel-overview" role="tabpanel" aria-label="Overview"
           style=${{ display: view === 'overview' ? 'contents' : 'none' }}>
        ${html`<${OverviewTab} alerts=${alerts} />`}
      </div>

      <div id="panel-transactions" role="tabpanel" aria-label="Transactions"
           style=${{ display: view === 'transactions' ? 'contents' : 'none' }}>
        ${html`<${TransactionsTab}
          transactions=${txnsQ.data ?? FIXTURE_TRANSACTIONS}
          isLoading=${txnsQ.isLoading}
          entity=${entity}
          onEntityChange=${setEntity}
          onConfirm=${(id) => confirmMut.mutate(id)}
          onDispute=${(id) => disputeMut.mutate(id)}
        />`}
      </div>

      <div id="panel-receivables" role="tabpanel" aria-label="Receivables"
           style=${{ display: view === 'receivables' ? 'contents' : 'none' }}>
        ${html`<${ReceivablesTab}
          receivables=${arQ.data ?? FIXTURE_RECEIVABLES}
          isLoading=${arQ.isLoading}
        />`}
      </div>

      <div id="panel-inter-company" role="tabpanel" aria-label="Inter-Company"
           style=${{ display: view === 'inter-company' ? 'contents' : 'none' }}>
        ${html`<${InterCompanyTab}
          entries=${intercoQ.data ?? FIXTURE_INTERCO}
          isLoading=${intercoQ.isLoading}
        />`}
      </div>

      <div id="panel-reports" role="tabpanel" aria-label="Reports"
           style=${{ display: view === 'reports' ? 'contents' : 'none' }}>
        ${html`<${ReportsTab} />`}
      </div>
    </div>
  `;
}
