// Form-modal CSS for agent-ops WP-14 (job create/edit/delete).
// Ships as a JS string (no-build: WebKitGTK can't load link/fetch subresources
// from about:srcdoc). app.js injects this after agent-ops-css.js.
// Reuses .ao-scrim/.ao-modal (confirm-modal base); adds form-specific rules.
export default `
/* ============ JOB FORM MODAL (WP-14) ============ */

/* Wider modal for the form */
.ao-modal.ao-form-modal {
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
}

.ao-form-modal h3 {
  font-size: 14px;
  font-weight: 700;
  margin: 0 0 14px;
}

/* Form row: label + input stacked */
.ao-form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.ao-form-row label {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: .05em;
}
.ao-form-row .ao-hint {
  font-size: 10.5px;
  color: var(--fg-faint, var(--fg-muted));
  margin-top: 2px;
}

/* Text / number inputs */
.ao-input {
  height: 32px;
  padding: 0 10px;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: var(--r, 6px);
  color: var(--fg);
  font-size: 12.5px;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
  outline: none;
  transition: border-color .1s;
}
.ao-input:focus { border-color: var(--primary); }
.ao-input:disabled {
  opacity: .55;
  cursor: not-allowed;
  background: var(--bg-surface);
}
.ao-input.has-error { border-color: var(--danger); }
.ao-input::placeholder { color: var(--fg-faint, var(--fg-muted)); }

/* Select */
.ao-select {
  height: 32px;
  padding: 0 10px;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: var(--r, 6px);
  color: var(--fg);
  font-size: 12.5px;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
  outline: none;
  cursor: pointer;
  transition: border-color .1s;
  appearance: auto;
}
.ao-select:focus { border-color: var(--primary); }

/* Checkbox row */
.ao-form-check {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 12px;
}
.ao-form-check input[type="checkbox"] {
  width: 15px;
  height: 15px;
  accent-color: var(--primary);
  cursor: pointer;
}
.ao-form-check label {
  font-size: 12.5px;
  cursor: pointer;
}

/* Inline field error */
.ao-form-err {
  font-size: 10.5px;
  color: var(--danger);
  margin-top: 2px;
}

/* Submit error banner */
.ao-form-submit-err {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
  border-radius: var(--r, 6px);
  padding: 8px 10px;
  font-size: 12px;
  color: var(--danger);
  margin-bottom: 12px;
}

/* Footer row */
.ao-form-footer {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}
.ao-form-footer .ao-form-footer-spacer { flex: 1; }

/* Danger button variant (delete) */
.ao-btn.v-danger {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-color: var(--danger);
  color: var(--danger);
}
.ao-btn.v-danger:hover { opacity: .85; }

/* Outline button variant (cancel) */
.ao-btn.v-outline {
  background: transparent;
  border-color: var(--border);
  color: var(--fg-muted);
}
.ao-btn.v-outline:hover { border-color: var(--fg-muted); color: var(--fg); }

/* Primary button variant (save) */
.ao-btn.v-primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-fg);
}
.ao-btn.v-primary:hover { opacity: .9; }
.ao-btn.v-primary:disabled { opacity: .4; pointer-events: none; }

/* Delete-confirm inline banner inside edit modal */
.ao-delete-confirm {
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  border-radius: var(--r, 6px);
  padding: 10px 12px;
  font-size: 12px;
  color: var(--danger);
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ao-delete-confirm .ao-delete-confirm-btns {
  display: flex;
  gap: 8px;
}
`;
