// WP-13 CSS — Live tail view.
// Ships alongside agent-ops-runs-css.js (injected in app.js).
// Class naming: .ao-live-*
// All tokens consumed here match the existing set:
//   --fg, --fg-muted, --fg-faint (alias --fg-subtle), --fg-subtle
//   --bg-raised, --bg-sunken, --bg-surface, --border, --border-soft
//   --danger, --systemic, --achievement, --primary, --primary-soft
//   --font-mono, --r
//
// NOTE: CSS comment bodies must NOT contain star-slash sequences — doing so
// breaks the next rule in the string. All comments here are top-level blocks.
export default `
/* ============ LIVE SCREEN ============ */
.ao-live-screen {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.ao-live-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.ao-live-header h1 {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -.01em;
  margin: 0;
}
.ao-live-header .sub {
  font-size: 11px;
  color: var(--fg-muted);
}
.ao-live-header .ao-spacer { flex: 1; }

/* ============ JOB PICKER ============ */
.ao-live-picker {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow-y: auto;
  flex: 1;
}

.ao-live-picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: var(--fg-muted);
  font-size: 13px;
}

.ao-live-job-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
  transition: background .1s;
}
.ao-live-job-row:hover { background: var(--bg-raised); }
.ao-live-job-row.is-running { background: color-mix(in srgb, var(--systemic) 6%, transparent); }

.ao-live-job-id {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ao-live-job-id .ns { color: var(--fg-faint, var(--fg-subtle)); }

.ao-live-job-meta {
  font-size: 11px;
  color: var(--fg-muted);
  flex-shrink: 0;
}

/* ============ CONSOLE AREA ============ */
.ao-live-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.ao-live-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
  background: var(--bg-raised);
}
.ao-live-toolbar .ao-live-target {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ao-live-toolbar .ao-live-target .ns {
  color: var(--fg-faint, var(--fg-subtle));
}
.ao-live-toolbar .ao-spacer { flex: 1; }

.ao-live-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 99px;
  font-weight: 600;
  letter-spacing: .01em;
}
.ao-live-status-badge.running {
  background: color-mix(in srgb, var(--systemic) 14%, transparent);
  color: var(--systemic);
}
.ao-live-status-badge.done {
  background: color-mix(in srgb, var(--fg-muted) 12%, transparent);
  color: var(--fg-muted);
}
.ao-live-status-badge .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.ao-live-status-badge.running .dot {
  animation: ao-live-pulse 1.2s ease-in-out infinite;
}

@keyframes ao-live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .35; }
}

/* ============ CONSOLE PRE ============ */
.ao-live-console-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-sunken);
  position: relative;
}

.ao-live-console {
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-all;
  padding: 14px 16px;
  margin: 0;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
}

/* ============ AGENT MODE NOTICE ============ */
.ao-live-agent-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  padding: 32px 24px;
  text-align: center;
  color: var(--fg-muted);
  font-size: 13px;
  line-height: 1.55;
}
.ao-live-agent-notice .notice-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}

/* ============ FINISH BANNER ============ */
.ao-live-finish-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: color-mix(in srgb, var(--systemic) 8%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--systemic) 20%, transparent);
  font-size: 12px;
  color: var(--fg);
  flex-shrink: 0;
}
.ao-live-finish-bar .ao-spacer { flex: 1; }
.ao-live-finish-bar a {
  color: var(--primary);
  text-decoration: none;
  cursor: pointer;
  font-weight: 500;
}
.ao-live-finish-bar a:hover { text-decoration: underline; }

/* ============ STANDALONE PLACEHOLDER ============ */
.ao-live-standalone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  color: var(--fg-muted);
  font-size: 13px;
  text-align: center;
  padding: 24px;
}
.ao-live-standalone .console-mock {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 16px;
  width: 320px;
  max-width: 100%;
  text-align: left;
  color: var(--fg-muted);
  line-height: 1.6;
  opacity: .7;
}
`;
