// WP-11 CSS — Runs view + Failures view + shared RunDetail panel.
// Ships alongside agent-ops-css.js (injected right after it in app.js).
// Class naming: .ao-runs-* / .ao-fail-* / .ao-run-detail / .ao-run-row
// All tokens consumed here match what agent-ops-css.js already uses:
//   --fg, --fg-muted, --fg-faint (→ --fg-subtle alias), --fg-subtle
//   --bg-raised, --bg-sunken, --bg-surface, --border, --border-soft
//   --danger, --danger-soft, --systemic, --systemic-soft
//   --achievement, --achievement-soft, --primary, --primary-fg, --primary-soft
//   --font-mono, --r (not used by base css but available from tokens)
//   --shadow-3 (used by modal)
export default `
/* ============ RUNS VIEW ============ */
.ao-runs-screen {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.ao-runs-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.ao-runs-header h1 {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -.01em;
  margin: 0;
}
.ao-runs-header .sub { font-size: 11px; color: var(--fg-muted); }

.ao-runs-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* left list pane */
.ao-runs-list {
  flex: 0 0 380px;
  overflow-y: auto;
  border-right: 1px solid var(--border-soft);
  min-width: 0;
}

/* expand panel (right side) */
.ao-runs-detail-pane {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  padding: 16px 20px;
}
.ao-runs-detail-pane.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  font-size: 13px;
}

/* ============ RUN LIST ROW ============ */
.ao-run-row {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 0 10px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
  transition: background .1s;
}
.ao-run-row:hover { background: var(--bg-raised); }
.ao-run-row.selected { background: var(--primary-soft); }
.ao-run-row.is-skipped { opacity: .55; }

.ao-run-row .rr-badge-col {
  display: flex;
  align-items: center;
  justify-content: center;
}
.ao-run-row .rr-main {
  min-width: 0;
}
.ao-run-row .rr-job {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ao-run-row .rr-job .rr-ns { color: var(--fg-faint, var(--fg-subtle)); }
.ao-run-row .rr-meta {
  font-size: 10.5px;
  color: var(--fg-muted);
  margin-top: 2px;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.ao-run-row .rr-meta .sep { color: var(--border); }
.ao-run-row .rr-cost {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--achievement);
  text-align: right;
  flex-shrink: 0;
}
.ao-run-row .rr-cost.none { color: var(--fg-faint, var(--fg-subtle)); }

/* skipped row label */
.ao-skip-label {
  font-size: 10px;
  font-family: var(--font-mono);
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  color: var(--fg-faint, var(--fg-subtle));
  text-decoration: line-through;
}

/* ============ RUN DETAIL PANEL ============ */
.ao-run-detail {
  min-width: 0;
}
.ao-run-detail .rd-title {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 4px;
  color: var(--fg);
  word-break: break-all;
}
.ao-run-detail .rd-subtitle {
  font-size: 11px;
  color: var(--fg-muted);
  margin: 0 0 14px;
}

.ao-run-detail .rd-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
  margin-bottom: 14px;
}
.ao-run-detail .rd-cell {
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: 7px;
  padding: 8px 10px;
}
.ao-run-detail .rd-cell .k {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--fg-muted);
  margin-bottom: 3px;
}
.ao-run-detail .rd-cell .v {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg);
  word-break: break-all;
}
.ao-run-detail .rd-cell .v.cost { color: var(--achievement); }
.ao-run-detail .rd-cell .v.ok { color: var(--systemic); }
.ao-run-detail .rd-cell .v.fail { color: var(--danger); }
.ao-run-detail .rd-cell .v.running { color: var(--achievement); }

/* section within detail */
.ao-run-detail .rd-section {
  margin-top: 12px;
}
.ao-run-detail .rd-section-h {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--fg-muted);
  margin-bottom: 5px;
  padding-bottom: 3px;
  border-bottom: 1px solid var(--border-soft);
}

/* pre block for summary / error */
.ao-pre {
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-all;
  overflow-y: auto;
  max-height: 220px;
  line-height: 1.55;
}
.ao-pre.error {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 6%, var(--bg-sunken));
  border-color: color-mix(in srgb, var(--danger) 30%, transparent);
}
.ao-pre.empty {
  color: var(--fg-muted);
  font-style: italic;
}

/* token row */
.ao-token-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.ao-token-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--bg-raised);
  border: 1px solid var(--border-soft);
  border-radius: 99px;
  padding: 2px 8px;
  color: var(--fg-muted);
}
.ao-token-chip .tck { color: var(--fg-faint, var(--fg-subtle)); font-size: 9.5px; }

/* ============ FAILURES VIEW ============ */
.ao-fail-screen {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.ao-fail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.ao-fail-header h1 {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -.01em;
  margin: 0;
}
.ao-fail-header .sub { font-size: 11px; color: var(--fg-muted); }

.ao-fail-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 18px 18px;
}

/* alert cards */
.ao-fail-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.ao-fail-card {
  background: color-mix(in srgb, var(--danger) 7%, var(--bg-surface));
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  border-radius: 9px;
  padding: 12px 14px;
}
.ao-fail-card .fc-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.ao-fail-card .fc-job {
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--fg);
  flex: 1;
  min-width: 0;
}
.ao-fail-card .fc-job .fc-ns { color: var(--fg-faint, var(--fg-subtle)); }
.ao-fail-card .fc-count {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  color: var(--danger);
  background: var(--danger-soft);
  padding: 2px 9px;
  border-radius: 99px;
  white-space: nowrap;
}
.ao-fail-card .fc-label {
  font-size: 11.5px;
  color: var(--fg-muted);
  margin-bottom: 6px;
}
.ao-fail-card .fc-error {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border-radius: 5px;
  padding: 5px 8px;
  margin-bottom: 4px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 80px;
  overflow-y: auto;
}
.ao-fail-card .fc-last {
  font-size: 10.5px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
}

/* ============ SHARED RUN LIST (Failures view uses same .ao-run-row) ============ */
.ao-fail-runs-list {
  background: var(--bg-surface);
  border: 1px solid var(--border-soft);
  border-radius: 9px;
  overflow: hidden;
}

/* ============ LOADING / EMPTY ============ */
.ao-runs-loading,
.ao-fail-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 1.5rem 18px;
  font-size: 13px;
  color: var(--fg-muted);
}
.ao-runs-empty,
.ao-fail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 2.5rem 1rem;
  font-size: 13px;
  color: var(--fg-muted);
  text-align: center;
}
.ao-runs-empty .sub,
.ao-fail-empty .sub {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--fg-faint, var(--fg-subtle));
}

/* healthy-all state in Failures */
.ao-fail-healthy {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 3rem 1rem;
  text-align: center;
}
.ao-fail-healthy .msg {
  font-size: 14px;
  font-weight: 600;
  color: var(--systemic);
}
.ao-fail-healthy .sub {
  font-size: 11.5px;
  color: var(--fg-muted);
}
`;
