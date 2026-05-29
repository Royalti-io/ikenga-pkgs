// Auto-derived from the D-01 mock (board-timeline-first.html) pane CSS.
// Shell-chrome rules (.shell, .actbar, .sidemenu, .chrome-tag, .pane-frame-note)
// have been stripped — those are SHELL, not pkg. The pkg iframe renders only
// the pane content (below .pane-frame-note in the mock).
//
// CSS ships as a JS string (no-build: WebKitGTK can't load link/fetch
// subresources from about:srcdoc; CSS rides the script path). app.js injects
// this as an inline <style> after tokens-css.js (tokens define --fg/--bg-base
// etc.; this file consumes them).
//
// Token mapping: D-01 used inline hsl(...) literals (the mock was standalone);
// this file replaces them with @ikenga/tokens semantic slots so the pkg follows
// the shell's active theme (A/B/C × light/dark) automatically.
export default `
/* ============ PANE LAYOUT ============ */
.ao-screen {
  display: flex;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
}

.ao-panebar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.ao-panebar h1 {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -.01em;
  margin: 0;
}
.ao-panebar .sub { font-size: 11px; color: var(--fg-muted); }
.ao-spacer { flex: 1; }

.ao-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--fg-muted);
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: 99px;
}
.ao-pill.up .ao-dot { background: var(--systemic); box-shadow: 0 0 0 3px var(--systemic-soft); }
.ao-pill.down { color: var(--danger); border-color: var(--danger); }
.ao-pill.down .ao-dot { background: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }

.ao-dot {
  width: 7px;
  height: 7px;
  border-radius: 99px;
  background: var(--systemic);
}

/* daemon-down banner */
.ao-downbanner {
  display: none;
  align-items: center;
  gap: 10px;
  padding: 8px 18px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
  border-bottom: 1px solid var(--danger);
  flex-shrink: 0;
}
.ao-screen.is-down .ao-downbanner { display: flex; }
.ao-screen.is-down .ao-pill.up { display: none; }
.ao-screen.is-down .ao-pill.down { display: inline-flex; }
.ao-screen.is-down .ao-btn.run { opacity: .4; pointer-events: none; }

.ao-body {
  padding: 8px 18px 18px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

/* ============ KPI STRIP ============ */
.ao-kpis {
  display: flex;
  gap: 10px;
  padding: 12px 0 4px;
}
.ao-kpi {
  flex: 1;
  background: var(--bg-surface);
  border: 1px solid var(--border-soft);
  border-radius: 9px;
  padding: 9px 12px;
}
.ao-kpi .n {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -.02em;
}
.ao-kpi .l {
  font-size: 10.5px;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: .04em;
  margin-top: 1px;
}
.ao-kpi.ok .n { color: var(--systemic); }
.ao-kpi.warn .n { color: var(--achievement); }
.ao-kpi.bad .n { color: var(--danger); }

/* ============ SECTION HEADERS ============ */
.ao-section-h {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 14px 0 8px;
}
.ao-section-h h2 {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--fg-muted);
  margin: 0;
  white-space: nowrap;
}
.ao-section-h .rule {
  flex: 1;
  height: 1px;
  background: var(--border-soft);
}
.ao-section-h .meta {
  font-size: 11px;
  color: var(--fg-faint, var(--fg-muted));
  white-space: nowrap;
}

/* ============ TIMELINE ============ */
.ao-timeline {
  background: var(--bg-surface);
  border: 1px solid var(--border-soft);
  border-radius: 9px;
  padding: 12px 16px 8px;
  position: relative;
}
.ao-tl-axis {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--fg-faint, var(--fg-muted));
  font-family: var(--font-mono);
  border-bottom: 1px dashed var(--border);
  padding-bottom: 6px;
  margin-bottom: 8px;
}
.ao-tl-axis .tz { color: var(--fg-muted); }
.ao-tl-now {
  position: absolute;
  top: 52px;
  bottom: 10px;
  width: 2px;
  background: var(--achievement);
  left: 6%;
  opacity: .7;
}
.ao-tl-now::after {
  content: 'now';
  position: absolute;
  top: -12px;
  left: -9px;
  font-size: 9px;
  color: var(--achievement);
  font-family: var(--font-mono);
}
.ao-tl-row {
  position: relative;
  height: 28px;
  display: flex;
  align-items: center;
  border-radius: 5px;
}
.ao-tl-row:hover { background: var(--bg-raised); }
.ao-tl-label {
  position: absolute;
  left: 6px;
  top: 6px;
  font-size: 11px;
  font-weight: 600;
  width: 120px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.ao-tl-label .chev {
  color: var(--fg-faint, var(--fg-muted));
  font-size: 9px;
  width: 9px;
}
.ao-tl-label .cnt {
  font-size: 9.5px;
  color: var(--fg-faint, var(--fg-muted));
  font-family: var(--font-mono);
  font-weight: 400;
}
.ao-tl-lane {
  position: absolute;
  left: 134px;
  right: 8px;
  top: 0;
  bottom: 0;
}
.ao-tl-fire {
  position: absolute;
  top: 5px;
  height: 18px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  padding: 0 7px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  color: var(--primary-fg);
  transform: translateX(-50%);
}
.ao-tl-fire.soon { background: var(--primary); }
.ao-tl-fire.later {
  background: var(--bg-raised);
  color: var(--fg-muted);
  border: 1px solid var(--border);
}
.ao-tl-fire.warn {
  background: var(--achievement-soft);
  color: var(--achievement);
  border: 1px solid var(--achievement);
}
.ao-tl-fire.cluster {
  background: var(--bg-sunken);
  border: 1px dashed var(--border);
  color: var(--fg-muted);
  font-family: var(--font-mono);
}
.ao-tl-fire.skip {
  background: transparent;
  border: 1px dashed var(--fg-faint, var(--fg-muted));
  color: var(--fg-faint, var(--fg-muted));
  text-decoration: line-through;
}
/* sub-lane (expandable) */
.ao-tl-sub { display: none; }
.ao-tl-sub.open { display: block; }
.ao-tl-sub .ao-tl-label {
  font-weight: 400;
  color: var(--fg-muted);
  padding-left: 18px;
}

/* ============ JOB TABLE ============ */
.ao-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--bg-surface);
  border: 1px solid var(--border-soft);
  border-radius: 9px;
  overflow: hidden;
}
.ao-table thead th {
  text-align: left;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--fg-faint, var(--fg-muted));
  font-weight: 600;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-sunken);
  cursor: pointer;
  white-space: nowrap;
}
.ao-table thead th .ar { opacity: .5; font-size: 9px; }
.ao-table tbody td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--border-soft);
  vertical-align: middle;
}
.ao-table tbody tr:hover { background: var(--bg-raised); }
.ao-table tbody tr.ext { opacity: .62; }

/* group row (externally managed) */
.ao-grp td {
  background: var(--bg-sunken);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--fg-faint, var(--fg-muted));
  font-weight: 700;
  padding: 6px 12px;
}

/* job id / namespace */
.ao-jid { font-family: var(--font-mono); font-size: 12px; color: var(--fg); }
.ao-jns { color: var(--fg-faint, var(--fg-muted)); }
.ao-label { font-size: 11px; color: var(--fg-muted); }

/* mode pill */
.ao-mode {
  font-size: 9px;
  font-family: var(--font-mono);
  padding: 1px 5px;
  border-radius: 4px;
  margin-left: 6px;
  vertical-align: middle;
}
.ao-mode.agent { background: var(--primary-soft); color: var(--primary-fg); }
.ao-mode.script { background: var(--systemic-soft); color: var(--systemic); }

/* next fire / ago */
.ao-next { font-family: var(--font-mono); font-size: 12px; }
.ao-next .cd {
  color: var(--primary-fg);
  background: var(--primary-soft);
  padding: 1px 6px;
  border-radius: 4px;
}
.ao-ago { font-family: var(--font-mono); font-size: 11px; color: var(--fg-muted); }
.ao-ago .dur { color: var(--fg-faint, var(--fg-muted)); }

/* 24h cost */
.ao-cost { font-family: var(--font-mono); font-size: 11px; color: var(--achievement); text-align: right; }
.ao-cost.none { color: var(--fg-faint, var(--fg-muted)); }

/* sparkline bars (G-15 — height = duration) */
.ao-bars { display: flex; gap: 2px; align-items: flex-end; height: 22px; }
.ao-bar { width: 5px; border-radius: 1px; background: var(--systemic); min-height: 2px; }
.ao-bar.f { background: var(--danger); }
.ao-bar.s { background: var(--achievement); }
.ao-bar.n { background: var(--border); }
.ao-emptybars { font-size: 10px; color: var(--fg-faint, var(--fg-muted)); font-style: italic; }

/* health badge */
.ao-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 99px;
  white-space: nowrap;
}
.ao-badge .d { width: 6px; height: 6px; border-radius: 99px; }
.b-ok  { background: var(--systemic-soft); color: var(--systemic); }
.b-ok  .d { background: var(--systemic); }
.b-fail { background: var(--danger-soft); color: var(--danger); }
.b-fail .d { background: var(--danger); }
.b-run  { background: var(--primary-soft); color: var(--primary-fg); }
.b-run  .d { background: var(--achievement); animation: ao-pulse 1.3s infinite; }
.b-ext  { background: var(--bg-raised); color: var(--fg-faint, var(--fg-muted)); border: 1px solid var(--border); }
.b-ext  .d { background: var(--fg-faint, var(--fg-muted)); }
.b-off  { background: transparent; color: var(--fg-faint, var(--fg-muted)); border: 1px dashed var(--border); }
.b-off  .d { background: var(--fg-faint, var(--fg-muted)); }
.b-pending { background: var(--bg-raised); color: var(--fg-muted); border: 1px solid var(--border); }
.b-pending .d { background: var(--fg-faint, var(--fg-muted)); }
@keyframes ao-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }

/* consecutive-error alert */
.ao-alert {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--danger);
  font-weight: 700;
  margin-top: 3px;
}

/* controls (hover-reveal) */
.ao-ctrls {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  opacity: 0;
  transition: opacity .12s;
}
tr:hover .ao-ctrls,
tr:focus-within .ao-ctrls { opacity: 1; }

/* external tag */
.ao-ext-tag {
  font-size: 9.5px;
  font-family: var(--font-mono);
  color: var(--fg-faint, var(--fg-muted));
  border: 1px solid var(--border);
  padding: 1px 5px;
  border-radius: 4px;
}

/* toggle switch */
.ao-tog {
  width: 30px;
  height: 17px;
  border-radius: 99px;
  background: var(--systemic);
  position: relative;
  cursor: pointer;
  flex: 0 0 auto;
  border: 0;
}
.ao-tog::after {
  content: '';
  position: absolute;
  width: 13px;
  height: 13px;
  border-radius: 99px;
  background: #fff;
  top: 2px;
  right: 2px;
}
.ao-tog.off { background: var(--border); }
.ao-tog.off::after { right: auto; left: 2px; }

/* ============ BUTTONS ============ */
.ao-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: inherit;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-raised);
  color: var(--fg);
  transition: border-color .12s, color .12s, background .12s, opacity .12s;
}
.ao-btn:hover { border-color: var(--primary); color: var(--primary-fg); }
.ao-btn:disabled { opacity: .4; pointer-events: none; }
.ao-btn.sz-sm { height: 26px; padding: 0 8px; font-size: 11px; }
.ao-btn.sz-md { height: 30px; padding: 0 12px; font-size: 12px; }
.ao-btn.run {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-fg);
}
.ao-btn.run:hover { opacity: .9; }
.ao-btn.run.billable::after { content: ' $'; font-size: 9px; }

/* ============ CONFIRM MODAL (G-13) ============ */
.ao-scrim {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.6);
  place-items: center;
  z-index: 40;
}
.ao-scrim.open { display: grid; }
.ao-modal {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: var(--shadow-3);
  width: 380px;
  padding: 18px;
}
.ao-modal h3 { font-size: 14px; margin: 0 0 4px; }
.ao-modal p { font-size: 12px; color: var(--fg-muted); margin: 0 0 12px; }
.ao-modal .costline {
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 9px 11px;
  font-family: var(--font-mono);
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  margin-bottom: 14px;
}
.ao-modal .costline b { color: var(--achievement); }
.ao-modal .row { display: flex; gap: 8px; justify-content: flex-end; }

/* ============ LEGEND ============ */
.ao-legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 10.5px;
  color: var(--fg-faint, var(--fg-muted));
  margin: 10px 0 0;
}
.ao-legend span { display: inline-flex; align-items: center; gap: 5px; }
.ao-legend i {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  display: inline-block;
}

/* ============ EMPTY / ERROR STATES ============ */
.ao-empty-box {
  margin: 1rem;
  display: flex;
  height: 128px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px dashed var(--border);
  font-size: 13px;
  color: var(--fg-muted);
  text-align: center;
  flex-direction: column;
  gap: 6px;
}
.ao-empty-box .sub { font-size: 11px; color: var(--fg-faint, var(--fg-muted)); font-family: var(--font-mono); }
.ao-error {
  margin: 1rem;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--danger) 50%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  padding: 12px;
  font-size: 13px;
  color: var(--danger);
}
.ao-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 1rem;
  font-size: 13px;
  color: var(--fg-muted);
}

/* ============ PLACEHOLDER VIEWS (WP-11 / WP-13) ============ */
.ao-placeholder {
  flex: 1;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 2rem;
  color: var(--fg-muted);
}
.ao-placeholder .label {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--fg-faint, var(--fg-muted));
  margin-top: 8px;
}

/* ============ SPINNER ============ */
.ao-spin { animation: ao-spin 1s linear infinite; }
@keyframes ao-spin { to { transform: rotate(360deg); } }

/* ============ FOCUS RINGS ============ */
.ao-btn:focus-visible,
.ao-tl-row:focus-visible,
.ao-tog:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
`;
