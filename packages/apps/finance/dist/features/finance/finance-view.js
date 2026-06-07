// Finance main view — Overview / Transactions / Receivables / Inter-Company / Reports.
//
// Composition follows plans/atelier-design-system/parts/screens/finance.md §§1–4
// and the locked design plans/atelier/designs/atelier-finance.html (structure,
// class names, geometry, tokens are ported verbatim from there).
//
//   Views: overview | transactions | receivables | inter-company | reports
//
//   Kit parts consumed:
//   - .frame / .frame-head / .frame-body (part 30 pkg-pane-frame)
//   - .frame-tab / .frame-tab.is-on / .tab-count (part 14 segmented-tabs)
//   - .badge / .badge-primary / .badge-achievement / .badge-danger / .badge-systemic
//   - .atelier-state.is-{loading,empty,error} / .atelier-spin (part 26)
//   - .btn / .btn-sm / .btn-outline (part 10 buttons)
//
//   Domain-local (finance.css .fin-*):
//   - .fin-kpi* / .fin-gauge* — KPI strip + runway gauge
//   - .fin-chart / .fin-grid-line / .fin-axis-text — cash-flow SVG chart
//   - .fin-cash-grid / .fin-cash-tile — entity cash position
//   - .fin-alerts* — alert strip (2-col shared-icon + link list)
//   - .fin-recon-bar* / .fin-recon-legend — reconciliation status bar
//   - .fin-matrix-chart / .fin-mx-* — inter-company N×N balance matrix
//   - .fin-queue-* / .btn-confirm / .btn-dispute — reconciliation queue
//   - .fin-table* / .fin-money-cell / .fin-days-cell — ledger / invoice tables
//   - .fin-filterbar — transactions filter bar
//   - .fin-summary-strip* — transactions summary bar
//   - .fin-aging* / .bk-* — receivables aging buckets
//   - .fin-report-* / .deferred-pill / .fin-deferred-note — reports tab
//   - .entity-switch / .dot / .ent-* — EntitySwitcher
//
// Data: host.dbQuery + host.dbExec via AppBridge. TanStack Query for caching.
// Real schema (0029_finance_domain.sql):
//   transaction_ledger.type = income|expense (NOT credit/debit — direction only);
//   reconciliation_status = n/a|matched|paired|suggested|disputed|unmatched.
//   amount = native, amount_usd = USD-normalized, currency present.
//   inter_company_entries: amount/currency present; amount_usd/running_balance_usd
//   may be NULL — USD is derived from amount via exchange_rates fallback.

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
// Real ledger entities are the bare strings 'Royalti' / 'Dixtrit' / 'Personal'.

const ENTITIES = ['all', 'royalti', 'dixtrit', 'personal'];
const ENTITY_LABELS = { all: 'All', royalti: 'Royalti.io', dixtrit: 'Dixtrit.media', personal: 'Personal' };
// Map a stored entity string → entity key, dot class, and badge variant.
const ENTITY_KEY = { royalti: 'royalti', dixtrit: 'dixtrit', personal: 'personal' };
function entityKey(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('royalti')) return 'royalti';
  if (s.includes('dixtrit')) return 'dixtrit';
  if (s.includes('personal')) return 'personal';
  return 'all';
}
function entityBadgeCls(name) {
  switch (entityKey(name)) {
    case 'royalti':  return 'badge-primary';
    case 'dixtrit':  return 'badge-achievement';
    case 'personal': return 'badge-systemic';
    default:         return '';
  }
}
// Matrix cell tint classes keyed off entity short code.
const ENT_SHORT = { royalti: 'R', dixtrit: 'D', personal: 'P' };
const ENT_DOT   = { royalti: 'ent-royalti', dixtrit: 'ent-dixtrit', personal: 'ent-personal' };

// ─── Fixture data (canonical — mirrors finance.md §1) ─────────────────────────
// Used as documented fallback until real data is present in ikenga.db.

const FIXTURE_ALERTS = [
  { id: 'a1', type: 'interco', severity: 'warn', message: '2 inter-company pairs await reconciliation', meta: 'Royalti.io ↔ Dixtrit.media · $4,820', linked_id: null },
  { id: 'a2', type: 'ar',      severity: 'crit', message: 'Valentim de Carvalho invoice 31 days overdue', meta: '$2,400 · contract signed', linked_id: 'INV-2026-038' },
  { id: 'a3', type: 'tax',     severity: 'warn', message: 'LIRS PAYE filing overdue since Feb 2024', meta: 'recalc + remit', linked_id: null },
];

// Normalized KPI shape (also produced by fetchOverview from real data):
// cash/burn/ar carry { value, sub, dir }; runway carries { months, target, scenarios }.
const FIXTURE_KPIS = {
  cash:    { value: '$48,210', sub: '+4.2% vs prior mo', dir: 'up' },
  burn:    { value: '$8,420',  sub: '−3.1% vs avg', dir: 'up' },
  runway:  { months: 5.7, target: 12, scenarios: { conserv: 3.8, likely: 5.7, optim: 8.2 } },
  ar:      { value: '$6,180',  sub: '3 overdue · 1 critical', dir: 'down' },
};

const FIXTURE_CASH = [
  { ent: 'r', entity: 'Royalti.io', ccy: 'USD', value: '$32,140', native: 'Stripe + Mercury · 2 accounts' },
  { ent: 'r', entity: 'Royalti.io', ccy: 'NGN', value: '$4,820',  native: '₦7,422,800 · Kuda + GTB' },
  { ent: 'd', entity: 'Dixtrit.media', ccy: 'USD', value: '$8,920', native: 'Verto · 1 account' },
  { ent: 'p', entity: 'Personal', ccy: 'NGN', value: '$2,330', native: '₦3,588,200 · GTB' },
];

const FIXTURE_TRANSACTIONS = [
  { id: 't1', txn_date: '2026-05-02', entity: 'Royalti', description: 'Stripe payout · 11 subscription invoices (Mercury …8423)', category: 'Revenue · SaaS', match_state: 'paired', currency: 'USD', amount_usd: 1840.20, amount: 1840.20, sign: 1 },
  { id: 't2', txn_date: '2026-05-01', entity: 'Royalti', description: 'AWS · EC2 + S3 + CloudFront (Mercury …8423)', category: 'Infra · Cloud', match_state: 'paired', currency: 'USD', amount_usd: -612.40, amount: -612.40, sign: -1 },
  { id: 't3', txn_date: '2026-04-30', entity: 'Dixtrit', description: 'Verto inflow · CodeNation Lda retainer', category: 'Revenue · Services', match_state: 'paired', currency: 'EUR', amount_usd: 2200.00, amount: 2000.00, sign: 1 },
  { id: 't4', txn_date: '2026-04-29', entity: 'Royalti', description: 'Kuda · payroll · founder salary', category: 'Payroll', match_state: 'paired', currency: 'NGN', amount_usd: -311.80, amount: -480000, sign: -1 },
  { id: 't5', txn_date: '2026-04-28', entity: 'Royalti', description: 'Inter-co transfer → Personal · Hetzner reimbursement', category: 'Inter-company', match_state: 'suggested', match_score: 92, currency: 'USD', amount_usd: -84.00, amount: -84.00, sign: -1 },
  { id: 't6', txn_date: '2026-04-26', entity: 'Royalti', description: 'Verto · FUGA DDEX provider invoice (Q2 portion)', category: 'Infra · DDEX', match_state: 'unmatched', currency: 'USD', amount_usd: -1250.00, amount: -1250.00, sign: -1 },
  { id: 't7', txn_date: '2026-04-25', entity: 'Dixtrit', description: 'GBP transfer · UK label scoping fee (Phyx Mvmt)', category: 'Revenue · Services', match_state: 'disputed', currency: 'GBP', amount_usd: 500.00, amount: 400.00, sign: 1 },
];

const FIXTURE_RECEIVABLES = [
  { id: 'r1', document_no: 'INV-2026-038', customer: 'Valentim de Carvalho', currency: 'EUR', balance_left: 2400, days: 31, invoice_status: 'overdue', due_date: '2026-04-02' },
  { id: 'r2', document_no: 'INV-041',      customer: 'CodeNation Lda',       currency: 'EUR', balance_left: 680,  days: 11, invoice_status: 'overdue', due_date: '2026-04-22' },
  { id: 'r3', document_no: 'INV-042',      customer: 'Phyx Mvmt',            currency: 'GBP', balance_left: 440,  days: 8,  invoice_status: 'overdue', due_date: '2026-04-25' },
  { id: 'r4', document_no: 'INV-045',      customer: 'CapaSound Records',    currency: 'USD', balance_left: 1460, days: 0,  invoice_status: 'paid',    due_date: '2026-05-13' },
  { id: 'r5', document_no: 'INV-046',      customer: 'Indie Music Label Co', currency: 'USD', balance_left: 1200, days: 0,  invoice_status: 'paid',    due_date: '2026-05-20' },
];

const FIXTURE_INTERCO = [
  { id: 'ic1', source_entity: 'Royalti', destination_entity: 'Dixtrit', amount_usd: 4820, amount: 4820, currency: 'USD', transfer_type: 'reimbursement', reconciliation_status: 'pending', running_balance_usd: 4820, entry_date: '2026-04-28' },
  { id: 'ic2', source_entity: 'Personal', destination_entity: 'Royalti', amount_usd: 84, amount: 129360, currency: 'NGN', transfer_type: 'reimbursement', reconciliation_status: 'suggested', running_balance_usd: 84, entry_date: '2026-04-27' },
];

// 6-month net cash-flow series (decorative fixture; runtime aggregates monthly).
const FIXTURE_WF = [
  { label: 'Nov', amount: 6200 },
  { label: 'Dec', amount: 1400 },
  { label: 'Jan', amount: -3800 },
  { label: 'Feb', amount: 9400 },
  { label: 'Mar', amount: -2100 },
  { label: 'Apr', amount: 5600 },
];

const PAGE_SIZE = 9;

// ─── Query keys ───────────────────────────────────────────────────────────────

const QK = {
  kpis:         ['finance', 'kpis'],
  alerts:       ['finance', 'alerts'],
  overview:     ['finance', 'overview'],
  transactions: (entity) => ['finance', 'transactions', entity],
  receivables:  ['finance', 'receivables'],
  interco:      ['finance', 'interco'],
};

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchAlerts() {
  if (isStandalone()) return FIXTURE_ALERTS;
  try {
    const rows = await hostDbQuery(
      `SELECT id, type, severity, message, linked_id, status
       FROM finance_alerts
       WHERE status != 'dismissed'
       ORDER BY severity DESC, created_at DESC
       LIMIT 20`
    ).catch(() => []);
    if (rows.length > 0) return rows;
    // Fallback: derive from real overdue receivables and unreconciled interco entries.
    const [arRows, intercoRows] = await Promise.all([
      hostDbQuery(
        `SELECT document_no, customer, balance_left, currency
         FROM receivables
         WHERE invoice_status = 'overdue'
         ORDER BY CAST(balance_left AS REAL) DESC
         LIMIT 5`
      ).catch(() => []),
      hostDbQuery(
        `SELECT source_entity, destination_entity, amount, amount_usd, currency
         FROM inter_company_entries
         WHERE reconciliation_status NOT IN ('matched', 'reconciled')
         ORDER BY id DESC
         LIMIT 3`
      ).catch(() => []),
    ]);
    const derived = [];
    for (const r of arRows) {
      const bal = Number(r.balance_left) || 0;
      derived.push({
        id: `ar-${r.document_no}`,
        type: 'ar',
        severity: bal > 2000 ? 'crit' : 'warn',
        message: `${r.customer} invoice ${r.document_no} overdue`,
        meta: `${r.currency || ''} ${bal.toLocaleString()}`.trim(),
        linked_id: r.document_no,
      });
    }
    for (const ic of intercoRows) {
      derived.push({
        id: `ic-${ic.source_entity}-${ic.destination_entity}`,
        type: 'interco',
        severity: 'warn',
        message: `Inter-company pair ${ic.source_entity} ↔ ${ic.destination_entity} awaits reconciliation`,
        meta: ic.amount_usd != null ? `$${Number(ic.amount_usd).toLocaleString()}` : `${ic.currency} ${Number(ic.amount).toLocaleString()}`,
        linked_id: null,
      });
    }
    return derived.length ? derived : FIXTURE_ALERTS;
  } catch {
    return FIXTURE_ALERTS;
  }
}

// Map a stored reconciliation_status to a normalized match state.
function normMatch(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'matched' || s === 'paired' || s === 'reconciled') return 'paired';
  if (s === 'suggested') return 'suggested';
  if (s === 'disputed')  return 'disputed';
  if (s === 'unmatched' || s === 'pending') return 'unmatched';
  return 'na'; // 'n/a' or unknown — neutral, not an error
}

// ─── FX normalization ─────────────────────────────────────────────────────────
// exchange_rates stores one row per month: ngn_usd = NGN per 1 USD (divide),
// eur_usd / gbp_usd = USD per 1 unit (multiply). We load every month so a value
// can be converted using the rate that applied in its own month (with the most
// recent month as fallback for any gap).

async function fetchFxRates() {
  const rows = await hostDbQuery(
    `SELECT rate_month, ngn_usd, eur_usd, gbp_usd FROM exchange_rates ORDER BY rate_month DESC`
  ).catch(() => []);
  const byMonth = {};
  let latest = null;
  for (const r of rows) {
    const m = {
      NGN: parseFloat(r.ngn_usd) || null,
      EUR: parseFloat(r.eur_usd) || null,
      GBP: parseFloat(r.gbp_usd) || null,
    };
    byMonth[r.rate_month] = m;
    if (!latest) latest = m; // first row is the newest (ORDER BY DESC)
  }
  return { byMonth, latest: latest || { NGN: null, EUR: null, GBP: null } };
}

// Convert a native amount to USD. `month` ('YYYY-MM') selects the period rate;
// falls back to the latest rate when that month is missing. Returns null when the
// rate is unavailable (so callers can avoid fabricating a USD figure).
function fxToUsd(amount, currency, fx, month) {
  const n = parseFloat(amount);
  if (!Number.isFinite(n)) return null;
  const c = String(currency || 'USD').toUpperCase();
  if (c === 'USD') return n;
  const rates = (month && fx.byMonth[month]) || fx.latest;
  if (c === 'NGN') return rates.NGN ? n / rates.NGN : null;
  if (c === 'EUR') return rates.EUR ? n * rates.EUR : null;
  if (c === 'GBP') return rates.GBP ? n * rates.GBP : null;
  return n; // unknown currency — treat as already-USD rather than drop it
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(ym) {
  const mi = parseInt(String(ym).slice(5, 7), 10) - 1;
  return MONTH_ABBR[mi] || String(ym);
}

async function fetchTransactions(entity = 'all') {
  if (isStandalone()) return FIXTURE_TRANSACTIONS;
  try {
    const entityFilter = entity === 'all' ? '' : 'AND lower(entity) LIKE ?';
    const params = entity === 'all' ? [] : [`%${entity}%`];
    const rows = await hostDbQuery(
      `SELECT id, txn_date, entity, description, payment_type AS category,
              amount, amount_usd, currency, type, reconciliation_status
       FROM transaction_ledger
       WHERE 1=1 ${entityFilter}
       ORDER BY txn_date DESC, id DESC
       LIMIT 400`,
      params
    );
    if (!rows.length) return FIXTURE_TRANSACTIONS;
    return rows.map((r) => {
      const usd = parseFloat(r.amount_usd);
      const amt = Number.isFinite(usd) ? usd : (parseFloat(r.amount) || 0);
      return {
        ...r,
        amount_usd: amt,
        amount: parseFloat(r.amount) || 0,
        currency: r.currency || 'USD',
        sign: amt >= 0 ? 1 : -1,
        match_state: normMatch(r.reconciliation_status),
        category: r.category || '—',
      };
    });
  } catch {
    return FIXTURE_TRANSACTIONS;
  }
}

async function fetchReceivables() {
  if (isStandalone()) return FIXTURE_RECEIVABLES;
  try {
    const rows = await hostDbQuery(
      `SELECT id, document_no, customer, currency, balance_left, total_amount,
              invoice_status, collection_status, due_date, invoice_date
       FROM receivables
       ORDER BY CAST(balance_left AS REAL) DESC`
    );
    if (!rows.length) return FIXTURE_RECEIVABLES;
    const today = Date.now();
    return rows.map((r) => {
      const dueMs = r.due_date ? new Date(r.due_date).getTime() : 0;
      const overdue = r.invoice_status === 'overdue';
      const days = overdue && dueMs && dueMs < today
        ? Math.floor((today - dueMs) / 86400000)
        : 0;
      return { ...r, days, balance_left: parseFloat(r.balance_left) || 0 };
    });
  } catch {
    return FIXTURE_RECEIVABLES;
  }
}

async function fetchInterco() {
  if (isStandalone()) return FIXTURE_INTERCO;
  try {
    const [rows, fx] = await Promise.all([
      hostDbQuery(
        `SELECT id, source_entity, destination_entity, amount, currency, amount_usd,
                transfer_type, reconciliation_status, running_balance_usd, entry_date
         FROM inter_company_entries
         ORDER BY entry_date DESC, id DESC
         LIMIT 200`
      ),
      fetchFxRates(),
    ]);
    if (!rows.length) return FIXTURE_INTERCO;
    // inter_company_entries.amount_usd / running_balance_usd are NULL in real
    // data — normalize the native amount to USD via exchange_rates using the
    // entry's own month, and derive a USD running balance per directed pair from
    // the oldest entry forward.
    const asc = rows.slice().reverse();
    const usdById = {};
    const runById = {};
    const runByPair = {};
    for (const r of asc) {
      const month = String(r.entry_date || '').slice(0, 7);
      const dbUsd = parseFloat(r.amount_usd);
      const usd = Number.isFinite(dbUsd) ? dbUsd : fxToUsd(r.amount, r.currency, fx, month);
      usdById[r.id] = usd;
      const pair = `${r.source_entity}→${r.destination_entity}`;
      const next = (runByPair[pair] || 0) + (usd || 0);
      runByPair[pair] = next;
      const dbRun = parseFloat(r.running_balance_usd);
      runById[r.id] = Number.isFinite(dbRun) ? dbRun : (usd != null ? next : null);
    }
    return rows.map((r) => ({
      ...r,
      amount: parseFloat(r.amount) || 0,
      currency: r.currency || 'USD',
      amount_usd: usdById[r.id] ?? null,
      running_balance_usd: runById[r.id] ?? null,
    }));
  } catch {
    return FIXTURE_INTERCO;
  }
}

async function fetchOverview() {
  if (isStandalone()) {
    return { kpis: FIXTURE_KPIS, cashTiles: FIXTURE_CASH, wfSeries: FIXTURE_WF };
  }
  try {
    const [fx, balRows, monthRows, arRows] = await Promise.all([
      fetchFxRates(),
      hostDbQuery(
        `SELECT b.entity AS entity, b.currency AS currency, b.bank AS bank,
                lab.balance_after AS balance
         FROM latest_account_balances lab
         JOIN bank_accounts b ON b.id = lab.account_id`
      ).catch(() => []),
      hostDbQuery(
        `SELECT substr(txn_date, 1, 7) AS ym,
                SUM(CAST(amount_usd AS REAL)) AS net,
                COUNT(*) AS n
         FROM transaction_ledger
         WHERE amount_usd IS NOT NULL AND amount_usd != '' AND txn_date <= date('now')
         GROUP BY ym HAVING COUNT(*) >= 5
         ORDER BY ym DESC LIMIT 6`
      ).catch(() => []),
      hostDbQuery(
        `SELECT balance_left, currency, invoice_status, due_date
         FROM receivables WHERE invoice_status != 'paid'`
      ).catch(() => []),
    ]);

    if (!balRows.length && !monthRows.length) {
      return { kpis: FIXTURE_KPIS, cashTiles: FIXTURE_CASH, wfSeries: FIXTURE_WF };
    }

    // ── Cash position by entity (native balances → USD at the latest rate) ──
    const ENT_META = {
      Royalti:  { ent: 'r', name: 'Royalti.io' },
      Dixtrit:  { ent: 'd', name: 'Dixtrit.media' },
      Personal: { ent: 'p', name: 'Personal' },
    };
    const byEnt = {};
    let totalCash = 0;
    for (const r of balRows) {
      const usd = fxToUsd(r.balance, r.currency, fx) || 0;
      totalCash += usd;
      const key = r.entity || 'Other';
      (byEnt[key] ||= { accounts: [], banks: new Set(), usd: 0 });
      byEnt[key].usd += usd;
      byEnt[key].accounts.push({ ccy: r.currency, native: parseFloat(r.balance) || 0, usd });
      if (r.bank) byEnt[key].banks.add(r.bank);
    }
    const cashTiles = Object.entries(byEnt)
      .sort((a, b) => b[1].usd - a[1].usd)
      .map(([key, v]) => {
        const meta = ENT_META[key] || { ent: '', name: key };
        const top = v.accounts
          .filter((a) => Math.abs(a.native) > 0)
          .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd))[0];
        const banks = [...v.banks].join(' + ');
        const native = top
          ? `${CCY_SYMBOL[top.ccy] || ''}${Math.round(Math.abs(top.native)).toLocaleString()} ${top.ccy}${banks ? ` · ${banks}` : ''}`
          : `${v.accounts.length} account${v.accounts.length === 1 ? '' : 's'}${banks ? ` · ${banks}` : ''}`;
        return { ent: meta.ent, entity: meta.name, ccy: 'USD', value: `$${Math.round(v.usd).toLocaleString()}`, native };
      });

    // ── 6-month net cash-flow series (chronological) ──
    const months = monthRows.slice().reverse();
    const wfSeries = months.map((m) => ({ label: monthLabel(m.ym), amount: Math.round(Number(m.net) || 0) }));

    // ── Burn / runway from average monthly net ──
    const nets = months.map((m) => Number(m.net) || 0);
    const avgNet = nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : 0;
    const lastNet = nets.length ? nets[nets.length - 1] : 0;
    const lastLabel = months.length ? monthLabel(months[months.length - 1].ym) : '';
    const burnPerMo = avgNet < 0 ? -avgNet : 0;
    const lastBurn = lastNet < 0 ? -lastNet : 0;
    const burnDeltaPct = burnPerMo > 0 ? ((lastBurn - burnPerMo) / burnPerMo) * 100 : 0;
    const runwayMonths = burnPerMo > 0 ? totalCash / burnPerMo : Infinity;
    const scen = (mult) => (burnPerMo > 0 ? totalCash / (burnPerMo * mult) : Infinity);

    // ── A/R outstanding (USD) ──
    let arOutstanding = 0;
    let overdueCount = 0;
    for (const r of arRows) {
      arOutstanding += fxToUsd(r.balance_left, r.currency, fx) || 0;
      if (r.invoice_status === 'overdue') overdueCount += 1;
    }

    const kpis = {
      cash: {
        value: `$${Math.round(totalCash).toLocaleString()}`,
        sub: nets.length
          ? `${lastNet >= 0 ? '+' : '−'}$${Math.abs(Math.round(lastNet)).toLocaleString()} net · ${lastLabel}`
          : 'no recent activity',
        dir: lastNet >= 0 ? 'up' : 'down',
      },
      burn: {
        value: burnPerMo > 0 ? `$${Math.round(burnPerMo).toLocaleString()}` : '$0',
        sub: burnPerMo > 0 ? `${burnDeltaPct >= 0 ? '+' : '−'}${Math.abs(burnDeltaPct).toFixed(0)}% vs 6-mo avg` : 'net positive',
        dir: burnDeltaPct <= 0 ? 'up' : 'down', // burning less than average is good
      },
      runway: {
        months: runwayMonths,
        target: 12,
        scenarios: { conserv: scen(1.3), likely: runwayMonths, optim: scen(0.75) },
      },
      ar: {
        value: `$${Math.round(arOutstanding).toLocaleString()}`,
        sub: `${overdueCount} overdue`,
        dir: 'down',
      },
    };

    return {
      kpis,
      cashTiles: cashTiles.length ? cashTiles : FIXTURE_CASH,
      wfSeries: wfSeries.length ? wfSeries : FIXTURE_WF,
    };
  } catch {
    return { kpis: FIXTURE_KPIS, cashTiles: FIXTURE_CASH, wfSeries: FIXTURE_WF };
  }
}

async function confirmMatch(txnId) {
  if (isStandalone()) return;
  await hostDbExec(
    `UPDATE transaction_ledger SET reconciliation_status = 'paired' WHERE id = ?`,
    [txnId]
  );
}

async function disputeMatch(txnId) {
  if (isStandalone()) return;
  await hostDbExec(
    `UPDATE transaction_ledger SET reconciliation_status = 'disputed' WHERE id = ?`,
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

function fmtUSDSigned(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n) || n == null) return '—';
  const sign = n < 0 ? '−' : '+';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtUSDFull(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n) || n == null) return '—';
  const sign = n < 0 ? '−' : '+';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CCY_SYMBOL = { USD: '$', EUR: '€', GBP: '£', NGN: '₦' };
function fmtNative(amount, currency) {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n) || n == null) return '';
  const sym = CCY_SYMBOL[currency] || '';
  return `${sym}${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;
}

function daysClass(days, status) {
  if (days === 0 || status === 'paid' || status === 'open') return 'ok';
  if (days <= 30)  return 'warn';
  if (days <= 60)  return 'late';
  return 'crit';
}

// Match-state badge metadata (Dusk Wood semantics from design § B).
function matchBadge(state) {
  switch (state) {
    case 'paired':    return { cls: 'badge-achievement', label: 'Paired' };
    case 'suggested': return { cls: 'badge-achievement', label: 'Suggested' };
    case 'disputed':  return { cls: 'badge-danger',      label: 'Disputed' };
    case 'unmatched': return { cls: 'badge-danger',      label: 'Unmatched' };
    default:          return { cls: '',                  label: 'Unreconciled' };
  }
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
  const hasCrit = alerts.some((a) => a.severity === 'crit');
  return html`
    <div class="fin-alerts" role="region" aria-label="Alerts" aria-live="polite">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
           style=${hasCrit ? { color: 'var(--danger)' } : null}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div>
        ${alerts.map((a) => html`
          <a key=${a.id} href="#" onClick=${(e) => e.preventDefault()}>
            ${a.message}
            ${a.meta ? html`<span class="meta">— ${a.meta}</span>` : null}
          </a>
        `)}
      </div>
    </div>
  `;
}

function KpiStrip({ kpis }) {
  const k = kpis || FIXTURE_KPIS;
  const cash = k.cash || FIXTURE_KPIS.cash;
  const burn = k.burn || FIXTURE_KPIS.burn;
  const ar = k.ar || FIXTURE_KPIS.ar;
  const runway = k.runway || FIXTURE_KPIS.runway;

  const runwayMonths = runway.months;
  const target = runway.target ?? 12;
  const finite = Number.isFinite(runwayMonths);
  const isWarn = finite && runwayMonths < target;
  const frac = Math.max(0, Math.min(1, finite ? runwayMonths / target : 1));
  // Arc endpoint on the semicircle: centre (100,90), r=80, sweeping the left
  // anchor (20,90) clockwise to the right anchor (180,90). frac=0.5 → top centre.
  const ang = Math.PI * (1 - frac);
  const ex = (100 + 80 * Math.cos(ang)).toFixed(2);
  const ey = (90 - 80 * Math.sin(ang)).toFixed(2);
  const arcPath = `M 20 90 A 80 80 0 0 1 ${ex} ${ey}`;
  const fmtMo = (x) => (Number.isFinite(x) ? x.toFixed(1) : '12+');
  const sc = runway.scenarios || {};

  const sparkUp = '0,20 15,18 30,16 45,17 60,12 75,10 90,11 105,7 120,5';
  const sparkBurn = '0,8 15,10 30,12 45,9 60,11 75,14 90,12 105,15 120,17';
  const sparkDown = '0,18 15,16 30,14 45,12 60,11 75,9 90,8 105,6 120,4';
  const dirCls = (d) => (d === 'down' ? 'is-down' : 'is-up');

  return html`
    <div class="fin-kpi-grid">
      <!-- Cash -->
      <div class="fin-kpi" role="region" aria-label=${`Cash USD: ${cash.value}, ${cash.sub}`}>
        <div class="fin-kpi-label">Cash · USD</div>
        <div class="fin-kpi-value">${cash.value}</div>
        <div class=${`fin-kpi-sub ${dirCls(cash.dir)}`}>${cash.sub}</div>
        <div class=${`fin-kpi-spark ${dirCls(cash.dir)}`}>
          <svg viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
            <polyline points=${cash.dir === 'down' ? sparkDown : sparkUp} />
          </svg>
        </div>
      </div>

      <!-- Burn -->
      <div class="fin-kpi" role="region" aria-label=${`Burn per month: ${burn.value}, ${burn.sub}`}>
        <div class="fin-kpi-label">Burn / mo</div>
        <div class="fin-kpi-value">${burn.value}</div>
        <div class=${`fin-kpi-sub ${dirCls(burn.dir)}`}>${burn.sub}</div>
        <div class=${`fin-kpi-spark ${dirCls(burn.dir)}`}>
          <svg viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
            <polyline points=${sparkBurn} />
          </svg>
        </div>
      </div>

      <!-- Runway — full semicircle gauge + scenario row -->
      <div class="fin-kpi is-gauge" role="region"
           aria-label=${`Runway: ${fmtMo(runwayMonths)} months${isWarn ? ', warning' : ''} — target ${target} months`}>
        <div class="fin-kpi-label">Runway</div>
        <div class=${`fin-gauge${isWarn ? ' is-warn' : ' is-good'}`}>
          <svg viewBox="0 0 200 110" preserveAspectRatio="xMidYMid meet">
            <title>Runway: ${fmtMo(runwayMonths)} of ${target} month target</title>
            <path class="fin-gauge-bg" d="M 20 90 A 80 80 0 0 1 180 90" fill="none" stroke-width="11" stroke-linecap="round" />
            <path class="fin-gauge-fg" d=${arcPath} fill="none" stroke-width="11" stroke-linecap="round" />
            <line class="fin-gauge-tick" x1="20"  y1="90" x2="14"  y2="98" />
            <line class="fin-gauge-tick" x1="100" y1="10" x2="100" y2="20" />
            <line class="fin-gauge-tick" x1="180" y1="90" x2="186" y2="98" />
            <text class="fin-axis-text" x="14"  y="106" text-anchor="start">0</text>
            <text class="fin-axis-text" x="100" y="32"  text-anchor="middle">${Math.round(target / 2)}</text>
            <text class="fin-axis-text" x="186" y="106" text-anchor="end">${target}+</text>
          </svg>
          <div class="fin-gauge-center">
            <div class="num">${fmtMo(runwayMonths)}</div>
            <div class="unit">months</div>
          </div>
        </div>
        <div class="fin-gauge-scenarios">
          <div class="scen-bad"><div class="lbl">Conserv.</div><div class="val">${fmtMo(sc.conserv)}</div></div>
          <div class="scen-mid"><div class="lbl">Likely</div><div class="val">${fmtMo(sc.likely ?? runwayMonths)}</div></div>
          <div class="scen-good"><div class="lbl">Optim.</div><div class="val">${fmtMo(sc.optim)}</div></div>
        </div>
      </div>

      <!-- A/R -->
      <div class="fin-kpi" role="region" aria-label=${`Accounts receivable outstanding: ${ar.value}, ${ar.sub}`}>
        <div class="fin-kpi-label">A/R outstanding</div>
        <div class="fin-kpi-value">${ar.value}</div>
        <div class=${`fin-kpi-sub ${dirCls(ar.dir)}`}>${ar.sub}</div>
        <div class=${`fin-kpi-spark ${dirCls(ar.dir)}`}>
          <svg viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
            <polyline points=${ar.dir === 'down' ? sparkDown : sparkUp} />
          </svg>
        </div>
      </div>
    </div>
  `;
}

// Cash-flow SVG chart — gridline, axis labels, per-bar value annotations.
// Geometry mirrors design § A: 720×200 viewBox, baseline at y=100.
function CashFlowChart({ series }) {
  const data = series && series.length ? series : FIXTURE_WF;
  const maxAbs = Math.max(1, ...data.map((b) => Math.abs(b.amount)));
  const innerW = 660;       // chart drawing area (x 40 → 700)
  const x0 = 40;
  const baseline = 100;
  const maxH = 68;          // max bar half-height
  const slot = innerW / data.length;
  const barW = Math.min(74, slot * 0.62);

  return html`
    <div class="fin-chart">
      <div class="fin-h2">
        Cash flow — last 6 months
        <span class="fin-h2-meta">net · monthly · usd</span>
      </div>
      <svg viewBox="0 0 720 200" preserveAspectRatio="none" aria-label="Net cash flow last six months">
        <line class="fin-grid-line" x1="40" y1="100" x2="700" y2="100" />
        <text class="fin-axis-text" x="6" y="104">0</text>
        <text class="fin-axis-text" x="6" y="20">+max</text>
        <text class="fin-axis-text" x="6" y="190">−max</text>
        ${data.map((b, i) => {
          const cx = x0 + slot * i + slot / 2;
          const bx = cx - barW / 2;
          const h = Math.round((Math.abs(b.amount) / maxAbs) * maxH);
          const isPos = b.amount >= 0;
          const by = isPos ? baseline - h : baseline;
          const valY = isPos ? by - 8 : by + h + 16;
          const k = (b.amount / 1000);
          const label = `${isPos ? '+' : '−'}${Math.abs(k).toFixed(1)}k`;
          return html`
            <g key=${b.label}>
              <rect class=${isPos ? 'fin-bar-pos' : 'fin-bar-neg'} x=${bx} y=${by} width=${barW} height=${Math.max(h, 1)} />
              <text class="fin-axis-text" x=${cx} y="118" text-anchor="middle">${b.label}</text>
              <text class="fin-axis-text" x=${cx} y=${valY} text-anchor="middle">${label}</text>
            </g>
          `;
        })}
      </svg>
    </div>
  `;
}

// Entity cash position — 4-col tiles with left-edge tint bar + native sub-line.
function EntityCashGrid({ tiles }) {
  const data = tiles && tiles.length ? tiles : FIXTURE_CASH;
  return html`
    <div class="fin-cash-grid" aria-label="Cash position by entity">
      ${data.map((t, i) => html`
        <div key=${i} class=${`fin-cash-tile ent-${t.ent}`}>
          <div class="fin-cash-row"><span>${t.entity}</span><span class="ccy">${t.ccy}</span></div>
          <div class="fin-cash-value">${t.value}</div>
          ${t.native ? html`<div class="fin-cash-native">${t.native}</div>` : null}
        </div>
      `)}
    </div>
  `;
}

function OverviewTab({ alerts, overview }) {
  const ov = overview || {};
  const tileCount = ov.cashTiles?.length ?? FIXTURE_CASH.length;
  return html`
    <div class="frame-body-flush" style=${{ overflowY: 'auto', flex: 1, paddingBottom: '16px' }}>
      ${html`<${AlertStrip} alerts=${alerts} />`}
      ${html`<${KpiStrip} kpis=${ov.kpis} />`}
      <div style=${{ height: '16px' }}></div>
      ${html`<${CashFlowChart} series=${ov.wfSeries} />`}
      <div style=${{ padding: '0 16px var(--space-3)' }}>
        <div class="fin-h2" style=${{ marginTop: 0 }}>
          Cash position by entity
          <span class="fin-h2-meta">native + usd-normalized · ${tileCount} ${tileCount === 1 ? 'entity' : 'entities'}</span>
        </div>
      </div>
      ${html`<${EntityCashGrid} tiles=${ov.cashTiles} />`}
    </div>
  `;
}

function TransactionsTab({ transactions, isLoading, entity, onEntityChange, onConfirm, onDispute }) {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [matchFilter, setMatchFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [page, setPage] = useState(0);

  // Reset to first page whenever the filter inputs change.
  useEffect(() => { setPage(0); }, [search, dateFrom, dateTo, matchFilter, currencyFilter, entity]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (q && !(
        t.description?.toLowerCase().includes(q) ||
        t.entity?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q)
      )) return false;
      const d = (t.txn_date || '').slice(0, 10);
      if (dateFrom && d && d < dateFrom) return false;
      if (dateTo && d && d > dateTo) return false;
      if (matchFilter !== 'all' && t.match_state !== matchFilter) return false;
      if (currencyFilter !== 'all' && (t.currency || 'USD') !== currencyFilter) return false;
      return true;
    });
  }, [transactions, search, dateFrom, dateTo, matchFilter, currencyFilter]);

  const inflow = useMemo(
    () => filtered.filter((t) => t.amount_usd >= 0).reduce((s, t) => s + t.amount_usd, 0),
    [filtered]
  );
  const outflow = useMemo(
    () => filtered.filter((t) => t.amount_usd < 0).reduce((s, t) => s + t.amount_usd, 0),
    [filtered]
  );
  const net = inflow + outflow;

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE);

  return html`
    <div class="frame-body-flush" style=${{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <!-- Filter bar -->
      <div class="fin-filterbar">
        <div class="input-search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            class="input"
            type="search"
            placeholder="Description / counterparty…"
            value=${search}
            onInput=${(e) => setSearch(e.target.value)}
            aria-label="Search transactions"
          />
        </div>
        <input type="date" value=${dateFrom} onInput=${(e) => setDateFrom(e.target.value)} aria-label="From date" />
        <span class="to">to</span>
        <input type="date" value=${dateTo} onInput=${(e) => setDateTo(e.target.value)} aria-label="To date" />
        <select value=${matchFilter} onChange=${(e) => setMatchFilter(e.target.value)} aria-label="Match state">
          <option value="all">Any match</option>
          <option value="paired">Paired</option>
          <option value="suggested">Suggested</option>
          <option value="unmatched">Unmatched</option>
          <option value="disputed">Disputed</option>
          <option value="na">Unreconciled</option>
        </select>
        <select value=${currencyFilter} onChange=${(e) => setCurrencyFilter(e.target.value)} aria-label="Currency">
          <option value="all">Any currency</option>
          <option value="USD">USD</option>
          <option value="NGN">NGN</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
        </select>
        <div class="spacer"></div>
        <span class="count">${filtered.length.toLocaleString()} transactions</span>
      </div>

      <!-- Summary strip -->
      <div class="fin-summary-strip">
        <div class="fin-summary-card">
          <span class="fin-summary-label">Inflow</span>
          <span class="fin-summary-value is-positive">${fmtUSDSigned(inflow)}</span>
        </div>
        <div class="fin-summary-card">
          <span class="fin-summary-label">Outflow</span>
          <span class="fin-summary-value is-negative">${fmtUSDSigned(outflow)}</span>
        </div>
        <div class="fin-summary-card">
          <span class="fin-summary-label">Net</span>
          <span class=${`fin-summary-value${net >= 0 ? ' is-positive' : ' is-negative'}`}>${fmtUSDSigned(net)}</span>
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
                  <th style=${{ width: '96px' }}>Date</th>
                  <th style=${{ width: '108px' }}>Entity</th>
                  <th>Description</th>
                  <th style=${{ width: '130px' }}>Category</th>
                  <th style=${{ width: '110px' }}>Match</th>
                  <th class="align-right" style=${{ width: '160px' }}>Amount</th>
                  <th style=${{ width: '150px' }}></th>
                </tr>
              </thead>
              <tbody>
                ${pageRows.map((t) => {
                  const mb = matchBadge(t.match_state);
                  const isSuggested = t.match_state === 'suggested';
                  const native = t.currency && t.currency !== 'USD'
                    ? fmtNative(t.amount, t.currency)
                    : '';
                  return html`
                    <tr key=${t.id}>
                      <td class="meta">${t.txn_date?.substring(0, 10) ?? '—'}</td>
                      <td>
                        <span class=${`badge ${entityBadgeCls(t.entity)}`.trim()}>${t.entity ?? '—'}</span>
                      </td>
                      <td style=${{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ${t.description ?? '—'}
                      </td>
                      <td class="muted">${t.category ?? '—'}</td>
                      <td>
                        ${t.match_state === 'suggested'
                          ? html`<span class="badge" style=${{ background: 'color-mix(in srgb, var(--achievement) 20%, var(--bg-base))', borderColor: 'var(--achievement)', color: 'var(--achievement)' }}>Suggested${t.match_score ? ` · ${t.match_score}%` : ''}</span>`
                          : html`<span class=${`badge ${mb.cls}`.trim()}>${mb.label}</span>`}
                      </td>
                      <td class="align-right">
                        <span class="fin-money-cell">
                          <span class=${`primary ${t.amount_usd >= 0 ? 'pos' : 'neg'}`}>${fmtUSDFull(t.amount_usd)}</span>
                          ${native ? html`<span class="native">${native}</span>` : null}
                        </span>
                      </td>
                      <td class="align-right">
                        ${isSuggested
                          ? html`
                            <div class="fin-row-actions">
                              <button
                                class="btn-confirm"
                                type="button"
                                aria-label=${`Confirm match for ${t.description}`}
                                onClick=${() => onConfirm(t.id)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                                Confirm
                              </button>
                              <button
                                class="btn-dispute"
                                type="button"
                                aria-label=${`Dispute match for ${t.description}`}
                                onClick=${() => onDispute(t.id)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                Dispute
                              </button>
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

          <div class="fin-pager">
            <span class="meta">Page ${safePage + 1} / ${pageCount} · ${rangeStart}–${rangeEnd} of ${filtered.length.toLocaleString()}</span>
            <div class="fin-pager-btns">
              <button class="btn btn-sm btn-outline" type="button" disabled=${safePage === 0} onClick=${() => setPage(Math.max(0, safePage - 1))} aria-label="Previous page">←</button>
              <button class="btn btn-sm btn-outline" type="button" disabled=${safePage >= pageCount - 1} onClick=${() => setPage(Math.min(pageCount - 1, safePage + 1))} aria-label="Next page">→</button>
            </div>
          </div>
        `}
    </div>
  `;
}

function ReceivablesTab({ receivables, isLoading }) {
  const buckets = useMemo(() => {
    const b = { current: [], '1-30': [], '31-60': [], '60+': [] };
    for (const r of receivables) {
      if (r.days === 0 || r.invoice_status === 'paid' || r.invoice_status === 'open') b.current.push(r);
      else if (r.days <= 30)  b['1-30'].push(r);
      else if (r.days <= 60)  b['31-60'].push(r);
      else                    b['60+'].push(r);
    }
    return b;
  }, [receivables]);

  const bucketTotal = (key) =>
    buckets[key].reduce((s, r) => s + (r.balance_left || 0), 0);

  return html`
    <div class="frame-body-flush" style=${{ overflowY: 'auto', flex: 1, paddingBottom: '16px' }}>
      ${isLoading
        ? html`<div class="atelier-state is-loading"><div class="atelier-spin" aria-label="Loading receivables…"></div></div>`
        : html`
          <!-- Aging buckets -->
          <div class="fin-aging">
            ${[
              { key: 'current', label: 'Current',  cls: 'bk-current' },
              { key: '1-30',    label: '1–30 days', cls: 'bk-1-30'   },
              { key: '31-60',   label: '31–60 days', cls: 'bk-31-60' },
              { key: '60+',     label: '60+ days',  cls: 'bk-60'     },
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
                  <th style=${{ width: '120px' }}>Invoice</th>
                  <th style=${{ width: '88px' }}>Currency</th>
                  <th class="align-right" style=${{ width: '140px' }}>Balance</th>
                  <th class="align-right" style=${{ width: '108px' }}>Days</th>
                  <th style=${{ width: '130px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                ${receivables.map((r) => {
                  const dc = daysClass(r.days, r.invoice_status);
                  return html`
                    <tr key=${r.id}>
                      <td style=${{ fontWeight: r.days > 30 ? 600 : 400 }}>${r.customer}</td>
                      <td class="meta">${r.document_no}</td>
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
                          r.invoice_status === 'paid'    ? ' badge-achievement' :
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

// Derive the N×N inter-company balance matrix from entry rows.
// Net directional balance per (row owes → col): positive = row is owed by col.
function buildMatrix(entries) {
  // Collect entities present in the data, in canonical order.
  const order = ['royalti', 'dixtrit', 'personal'];
  const present = new Set();
  for (const e of entries) {
    present.add(entityKey(e.source_entity));
    present.add(entityKey(e.destination_entity));
  }
  const ents = order.filter((k) => present.has(k));
  if (ents.length === 0) return null;

  // net[from][to] in USD (fallback to native amount when amount_usd is null).
  const net = {};
  const counts = {}; // status counts per directed pair
  for (const a of ents) { net[a] = {}; counts[a] = {}; for (const b of ents) { net[a][b] = 0; counts[a][b] = { matched: 0, suggested: 0, unmatched: 0, disputed: 0 }; } }

  for (const e of entries) {
    const from = entityKey(e.source_entity);
    const to = entityKey(e.destination_entity);
    if (!net[from] || net[from][to] === undefined) continue;
    const usd = e.amount_usd != null ? Number(e.amount_usd) : null;
    const val = usd != null ? usd : Number(e.amount) || 0;
    // source pays destination → source owes destination → from row is NEGATIVE to col.
    net[from][to] -= val;
    net[to][from] += val;
    const st = normMatch(e.reconciliation_status);
    const k = st === 'paired' ? 'matched' : (counts[from][to][st] !== undefined ? st : 'unmatched');
    counts[from][to][k] = (counts[from][to][k] || 0) + 1;
    counts[to][from][k] = (counts[to][from][k] || 0) + 1;
  }

  // magnitude bucket 1..4 for heat bars
  const maxAbs = Math.max(1, ...ents.flatMap((a) => ents.map((b) => Math.abs(net[a][b]))));
  const mag = (v) => {
    const r = Math.abs(v) / maxAbs;
    if (r <= 0) return 0;
    if (r < 0.25) return 1;
    if (r < 0.5)  return 2;
    if (r < 0.8)  return 3;
    return 4;
  };

  // row net totals
  const rowNet = {};
  for (const a of ents) rowNet[a] = ents.reduce((s, b) => s + net[a][b], 0);

  return { ents, net, counts, mag, rowNet };
}

const INTERCO_META = {
  royalti:  'Mercury · Stripe · Kuda',
  dixtrit:  'Verto · EUR / GBP',
  personal: 'GTB NGN',
};

function BalanceMatrix({ entries }) {
  const mx = useMemo(() => buildMatrix(entries), [entries]);
  if (!mx) {
    return html`<div class="atelier-state is-empty"><p>No inter-company entries to chart.</p></div>`;
  }
  const { ents, net, counts, mag, rowNet } = mx;
  const tmpl = `132px repeat(${ents.length}, 1fr)`;

  const cells = [];
  // header row: corner + column heads
  cells.push(html`
    <div class="fin-mx-corner" key="corner">
      <span>OWES</span><span class="arrow">↓ / →</span><span>IS OWED BY</span>
    </div>
  `);
  for (const c of ents) {
    cells.push(html`
      <div class="fin-mx-colhead" key=${`col-${c}`}>
        <span class="ent"><span class=${`dot ${ENT_DOT[c]}`}></span>${ENTITY_LABELS[c]}</span>
        <span class="meta">${INTERCO_META[c]}</span>
      </div>
    `);
  }
  // data rows
  for (const r of ents) {
    cells.push(html`
      <div class="fin-mx-rowhead" key=${`row-${r}`}>
        <span class="ent"><span class=${`dot ${ENT_DOT[r]}`}></span>${ENTITY_LABELS[r]}</span>
        <span class="meta">net: ${fmtUSDSigned(rowNet[r])}</span>
      </div>
    `);
    for (const c of ents) {
      if (r === c) {
        cells.push(html`<div class="fin-mx-cell is-self" key=${`${r}-${c}`} aria-disabled="true"><div class="val">—</div></div>`);
        continue;
      }
      const v = net[r][c];
      const cnt = counts[r][c] || {};
      const unm = cnt.unmatched || 0;
      const sug = cnt.suggested || 0;
      const dis = cnt.disputed || 0;
      const cls = v > 0.5 ? 'is-pos' : v < -0.5 ? 'is-neg' : 'is-zero';
      const dirArrow = v >= 0 ? '←' : '→';
      const note = unm ? `${unm} unmatched` : sug ? `${sug} suggested` : dis ? `${dis} disputed` : 'settled';
      const flag = unm ? html`<span class="flag" style=${{ background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 30%, var(--border))' }}>${unm} unm</span>`
                 : sug ? html`<span class="flag" style=${{ background: 'color-mix(in srgb, var(--achievement) 22%, var(--bg-base))', color: 'var(--achievement)', border: '1px solid color-mix(in srgb, var(--achievement) 35%, var(--border))' }}>${sug} sug</span>`
                 : null;
      cells.push(html`
        <div class=${`fin-mx-cell ${cls}`} key=${`${r}-${c}`} role="button" tabindex="0"
             aria-label=${`${ENTITY_LABELS[r]} ${v >= 0 ? 'is owed by' : 'owes'} ${ENTITY_LABELS[c]}: ${fmtUSDSigned(v)}`}>
          ${cls !== 'is-zero' ? html`<span class="heat" data-mag=${mag(v)}></span>` : null}
          <div class="val">${v === 0 ? '$0' : fmtUSDSigned(v)}</div>
          <div class="dir">${ENT_SHORT[r]} ${dirArrow} ${ENT_SHORT[c]} · ${note}</div>
          ${flag}
        </div>
      `);
    }
  }

  return html`
    <div class="fin-h2" style=${{ marginTop: 0 }}>Balance matrix<span class="fin-h2-meta">${ents.length}×${ents.length} · usd-normalized</span></div>
    <div class="fin-matrix-chart" role="grid" aria-label="Inter-company balance matrix" style=${{ gridTemplateColumns: tmpl }}>
      ${cells}
    </div>
    <div class="fin-mx-legend">
      <span class="item"><span class="swatch sw-pos"></span>row is owed</span>
      <span class="item"><span class="swatch sw-neg"></span>row owes</span>
      <span class="item"><span class="swatch sw-zero"></span>settled</span>
      <span class="item"><span class="swatch sw-self"></span>self</span>
      <span class="item" style=${{ marginLeft: 'auto' }}>heat bar = abs(amount) · 4-step scale</span>
    </div>
  `;
}

// Reconciliation status stacked bar derived from real entry status distribution.
function ReconBar({ entries }) {
  const stats = useMemo(() => {
    const c = { pending: 0, suggested: 0, matched: 0, disputed: 0 };
    for (const e of entries) {
      const st = normMatch(e.reconciliation_status);
      if (st === 'paired') c.matched += 1;
      else if (st === 'suggested') c.suggested += 1;
      else if (st === 'disputed') c.disputed += 1;
      else c.pending += 1; // unmatched / pending / n/a
    }
    const total = Math.max(1, c.pending + c.suggested + c.matched + c.disputed);
    const pct = (n) => ((n / total) * 100);
    return { c, total: c.pending + c.suggested + c.matched + c.disputed, pct };
  }, [entries]);

  const { c, total, pct } = stats;
  const seg = (n) => `${pct(n).toFixed(1)}%`;
  const item = (sw, label, n) => html`
    <span class="item"><span class=${`swatch ${sw}`}></span>${label} <span class="ct">${n}</span><span class="pct">(${pct(n).toFixed(1)}%)</span></span>
  `;

  return html`
    <div class="fin-recon-bar-wrap">
      <div class="fin-h2" style=${{ marginBottom: 0 }}>
        Reconciliation status
        <span class="fin-h2-meta">${total} entries</span>
      </div>
      <div class="fin-recon-bar" role="img"
           aria-label=${`Reconciliation: ${c.pending} unmatched, ${c.suggested} suggested, ${c.matched} matched, ${c.disputed} disputed`}>
        <span class="seg-pending"   style=${{ width: seg(c.pending) }}></span>
        <span class="seg-suggested" style=${{ width: seg(c.suggested) }}></span>
        <span class="seg-matched"   style=${{ width: seg(c.matched) }}></span>
        <span class="seg-disputed"  style=${{ width: seg(c.disputed) }}></span>
      </div>
      <div class="fin-recon-legend">
        ${item('s-pending', 'Unmatched', c.pending)}
        ${item('s-suggested', 'Suggested', c.suggested)}
        ${item('s-matched', 'Matched', c.matched)}
        ${item('s-disputed', 'Disputed', c.disputed)}
      </div>
    </div>
  `;
}

function InterCompanyTab({ entries, isLoading, onConfirm, onDispute }) {
  const [queueTab, setQueueTab] = useState('all');

  const statusOf = useCallback((e) => normMatch(e.reconciliation_status), []);

  const counts = useMemo(() => {
    const c = { all: entries.length, suggested: 0, unmatched: 0, disputed: 0, matched: 0 };
    for (const e of entries) {
      const st = statusOf(e);
      if (st === 'paired') c.matched += 1;
      else if (st === 'suggested') c.suggested += 1;
      else if (st === 'disputed') c.disputed += 1;
      else c.unmatched += 1;
    }
    return c;
  }, [entries, statusOf]);

  const queue = useMemo(() => {
    return entries.filter((e) => {
      const st = statusOf(e);
      if (queueTab === 'all') return true;
      if (queueTab === 'matched') return st === 'paired';
      if (queueTab === 'unmatched') return st === 'unmatched' || st === 'na';
      return st === queueTab;
    });
  }, [entries, queueTab, statusOf]);

  const fmtEntry = (e) => e.amount_usd != null
    ? fmtUSDSigned(e.amount_usd)
    : fmtNative(e.amount, e.currency);

  const QueueRow = ({ entry }) => {
    const st = statusOf(entry);
    const isActionable = st === 'suggested' || st === 'unmatched';
    return html`
      <div class="fin-queue-row">
        <div>
          <div class="fin-queue-meta">
            ${st === 'suggested'
              ? html`<span class="badge" style=${{ background: 'color-mix(in srgb, var(--achievement) 20%, var(--bg-base))', borderColor: 'var(--achievement)', color: 'var(--achievement)' }}>Suggested</span>`
              : st === 'paired'
              ? html`<span class="badge badge-achievement">Matched</span>`
              : st === 'disputed'
              ? html`<span class="badge badge-danger">Disputed</span>`
              : html`<span class="badge badge-danger">Unmatched</span>`}
            <span class="fin-queue-tag">${(entry.transfer_type || 'inter-co').toUpperCase()}</span>
            ${entry.entry_date ? html`<span class="fin-queue-score">${entry.entry_date}</span>` : null}
          </div>
          <div class="fin-queue-pair">
            <div class="fin-queue-side">
              <div class="name">${ENTITY_LABELS[entityKey(entry.source_entity)] || entry.source_entity} · ${fmtEntry(entry)}</div>
              <div class="memo">${(entry.transfer_type || '').replace(/_/g, ' ')}</div>
            </div>
            <div class="fin-queue-side">
              <div class="name">${ENTITY_LABELS[entityKey(entry.destination_entity)] || entry.destination_entity}</div>
              <div class="memo">counterparty</div>
            </div>
          </div>
          <div class="fin-queue-reason">${st === 'paired' ? 'reconciled · entries paired' : 'awaiting reconciliation'}</div>
        </div>
        <div class="fin-queue-actions">
          ${isActionable
            ? html`
              <button class="btn-confirm" type="button" aria-label="Confirm reconciliation" onClick=${() => onConfirm && onConfirm(entry.id)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                Confirm
              </button>
              <button class="btn-dispute" type="button" aria-label="Dispute reconciliation" onClick=${() => onDispute && onDispute(entry.id)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                Dispute
              </button>
            `
            : html`<span class="badge badge-achievement">Reconciled</span>`}
        </div>
      </div>
    `;
  };

  return html`
    <div class="frame-body-flush" style=${{ overflowY: 'auto', flex: 1, paddingBottom: '16px' }}>
      ${isLoading
        ? html`<div class="atelier-state is-loading"><div class="atelier-spin" aria-label="Loading inter-company entries…"></div></div>`
        : html`
          ${html`<${ReconBar} entries=${entries} />`}

          <div style=${{ padding: '0 16px' }}>
            ${html`<${BalanceMatrix} entries=${entries} />`}

            <div class="fin-h2" style=${{ marginTop: 'var(--space-6)' }}>Reconciliation queue</div>

            <div class="fin-queue-tabs" role="tablist">
              ${[
                { id: 'all',       label: 'All',       ct: counts.all },
                { id: 'suggested', label: 'Suggested', ct: counts.suggested },
                { id: 'unmatched', label: 'Unmatched', ct: counts.unmatched },
                { id: 'disputed',  label: 'Disputed',  ct: counts.disputed },
                { id: 'matched',   label: 'Matched',   ct: counts.matched },
              ].map(({ id, label, ct }) => html`
                <button key=${id} class=${queueTab === id ? 'is-on' : ''} onClick=${() => setQueueTab(id)} role="tab" aria-selected=${queueTab === id}>
                  ${label}<span class="ct">${ct}</span>
                </button>
              `)}
            </div>

            ${queue.length === 0
              ? html`<div class="atelier-state is-empty"><p>No entries in this bucket.</p></div>`
              : html`<div class="fin-queue-list">${queue.map((e) => html`<${QueueRow} key=${e.id} entry=${e} />`)}</div>`}
          </div>
        `}
    </div>
  `;
}

function ReportsTab() {
  const [reportTab, setReportTab] = useState('pnl');
  const TABS = [
    { id: 'pnl',    label: 'P&L', deferred: false },
    { id: 'bva',    label: 'Budget vs Actual', deferred: true },
    { id: 'cash',   label: 'Cash Flow', deferred: true },
    { id: 'burn',   label: 'Burn Analytics', deferred: true },
    { id: 'custom', label: 'Custom', deferred: true },
  ];

  return html`
    <div class="frame-body-flush" style=${{ overflowY: 'auto', flex: 1, paddingBottom: '16px' }}>
      <!-- Report sub-tabs with deferred pills -->
      <div class="fin-report-tabs" role="tablist" aria-label="Report types">
        ${TABS.map(({ id, label, deferred }) => html`
          <button
            key=${id}
            class=${`fin-report-tab${reportTab === id ? ' is-on' : ''}`}
            role="tab"
            aria-selected=${reportTab === id}
            disabled=${deferred}
            onClick=${() => !deferred && setReportTab(id)}
          >
            ${label}
            ${deferred ? html`<span class="deferred-pill">deferred</span>` : null}
          </button>
        `)}
      </div>

      <!-- P&L stats — 4-up grid with delta sub-lines -->
      <div class="fin-report-stats">
        ${[
          { label: 'Revenue', value: '+$24,820', sub: '+18% vs Q4 2025', dir: 'up' },
          { label: 'COGS',    value: '−$3,180',  sub: '−6% vs Q4 2025',  dir: 'up' },
          { label: 'OpEx',    value: '−$15,968', sub: '+9% vs Q4 2025',  dir: 'down' },
          { label: 'Net',     value: '+$5,672',  sub: '+22% vs Q4 2025', dir: 'up' },
        ].map(({ label, value, sub, dir }) => html`
          <div key=${label} class="fin-kpi">
            <div class="fin-kpi-label">${label}</div>
            <div class="fin-kpi-value">${value}</div>
            <div class=${`fin-kpi-sub is-${dir}`}>${sub}</div>
          </div>
        `)}
      </div>

      <!-- Deferred export note -->
      <div class="fin-deferred-note" aria-label="Deferred reports">
        <strong>Code-work flagged:</strong> Budget vs Actual, Cash Flow, Burn Analytics, and Custom
        currently render as <code>&lt;DeferredTab /&gt;</code> placeholders. Full P&amp;L export
        (CSV, balance sheet, income statement) is deferred to a later release.
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
    if (VIEWS.includes(activeFeature)) {
      setView(activeFeature);
    } else if (activeFeature.startsWith('ent-')) {
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
  const alertsQ = useQuery({ queryKey: QK.alerts, queryFn: fetchAlerts, staleTime: 30_000 });

  const overviewQ = useQuery({
    queryKey: QK.overview,
    queryFn: fetchOverview,
    staleTime: 30_000,
    enabled: view === 'overview',
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finance'] }),
  });
  const disputeMut = useMutation({
    mutationFn: disputeMatch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finance'] }),
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
        <div class="frame-title-wrap" style=${{ flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }}>
          <span class="frame-title">Accounting</span>
          <span class="frame-sub">Cash position, transactions, receivables, and inter-company tracking.</span>
        </div>
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
        ${html`<${OverviewTab} alerts=${alerts} overview=${overviewQ.data} />`}
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
          onConfirm=${(id) => confirmMut.mutate(id)}
          onDispute=${(id) => disputeMut.mutate(id)}
        />`}
      </div>

      <div id="panel-reports" role="tabpanel" aria-label="Reports"
           style=${{ display: view === 'reports' ? 'contents' : 'none' }}>
        ${html`<${ReportsTab} />`}
      </div>
    </div>
  `;
}
