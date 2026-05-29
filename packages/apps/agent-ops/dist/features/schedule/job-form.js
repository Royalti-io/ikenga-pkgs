// Job form modal — WP-14 visual CRUD.
//
// JobFormModal: create ("Add job", job=null) and edit (job=JobView) surface.
// Calls host.agentOps.upsertJob / host.agentOps.deleteJob via bridge wrappers.
// Reuses .ao-scrim/.ao-modal CSS + the new .ao-form-* rules in agent-ops-form-css.js.
//
// AgentOpsJobInput contract (frozen — shell side builds in parallel):
//   { id, label, schedule, timezone?, enabled?, mode?, command, model?, agent?,
//     schedule_dialect?, timeout_ms? }
// Required before calling upsert: id, label, schedule, command (all non-empty).
// id format: /^[\w-]+:[\w-]+$/ (namespace:slug).
//
// Edit mode: id is read-only (disabled). command is REQUIRED with a hint
// explaining the shell replaces the whole job — the user must re-confirm.

import { html, useState, useEffect } from '../../lib/ui.js';
import { hostAgentOpsUpsertJob, hostAgentOpsDeleteJob } from '../../lib/bridge.js';

// ── validation helpers ───────────────────────────────────────────────────────

const JOB_ID_RE = /^[\w-]+:[\w-]+$/;

/**
 * @param {{ id:string, label:string, schedule:string, command:string }} fields
 * @returns {{ id?:string, label?:string, schedule?:string, command?:string }}
 */
function validateFields(fields) {
  /** @type {{ id?:string, label?:string, schedule?:string, command?:string }} */
  const errs = {};
  if (!fields.id.trim()) {
    errs.id = 'Required';
  } else if (!JOB_ID_RE.test(fields.id.trim())) {
    errs.id = 'Format: namespace:slug (letters, digits, _ or -)';
  }
  if (!fields.label.trim()) errs.label = 'Required';
  if (!fields.schedule.trim()) errs.schedule = 'Required';
  if (!fields.command.trim()) errs.command = 'Required';
  return errs;
}

// ── component ────────────────────────────────────────────────────────────────

/**
 * Job create/edit/delete modal.
 *
 * @param {{
 *   job: import('../../lib/view-model.js').JobView | null,
 *   onCancel: () => void,
 *   onSaved: () => void,
 * }} props
 *
 *   job = null   → Add-job mode (empty form, id editable).
 *   job = JobView → Edit-job mode (id read-only, fields prefilled; command required).
 */
export function JobFormModal({ job, onCancel, onSaved }) {
  const isEdit = job != null;

  // ── controlled fields ─────────────────────────────────────────────────────
  const [id, setId] = useState(isEdit ? job.id : '');
  const [label, setLabel] = useState(isEdit ? (job.label ?? '') : '');
  const [schedule, setSchedule] = useState(isEdit ? (job.schedule ?? '') : '');
  const [timezone, setTimezone] = useState(isEdit ? (job.timezone ?? 'Africa/Lagos') : 'Africa/Lagos');
  const [mode, setMode] = useState(/** @type {'agent'|'script'} */ (isEdit ? (job.mode ?? 'agent') : 'agent'));
  const [command, setCommand] = useState('');
  const [model, setModel] = useState(isEdit ? (job.model ?? '') : '');
  const [enabled, setEnabled] = useState(isEdit ? (job.enabled ?? true) : true);
  const [scheduleDialect, setScheduleDialect] = useState(/** @type {'5f'|'6f'} */ (isEdit ? (job.schedule_dialect ?? '5f') : '5f'));

  // ── UI state ──────────────────────────────────────────────────────────────
  /** @type {[{ id?:string, label?:string, schedule?:string, command?:string }, Function]} */
  const [fieldErrs, setFieldErrs] = useState({});
  const [submitErr, setSubmitErr] = useState(/** @type {string|null} */ (null));
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Close on Escape.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Re-derive errors whenever relevant fields change (for live disable of Save).
  const currentErrs = validateFields({ id, label, schedule, command });
  const hasErrors = Object.keys(currentErrs).length > 0;

  // ── map host error code to friendly message ────────────────────────────────
  /**
   * @param {string|undefined} code
   * @param {string|undefined} error
   */
  function upsertErrorMsg(code, error) {
    switch (code) {
      case 'io_error':     return 'Couldn\'t write config — check disk permissions';
      case 'not_found':    return `Job not found: ${error ?? code}`;
      case 'unauthorized':
      case 'forbidden':    return 'Not authorized';
      case 'invalid':      return `Invalid job: ${error ?? code}`;
      default:             return error ?? code ?? 'Unknown error';
    }
  }

  // ── save handler ───────────────────────────────────────────────────────────
  async function handleSave() {
    const errs = validateFields({ id, label, schedule, command });
    setFieldErrs(errs);
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    setSubmitErr(null);
    try {
      /** @type {import('../../lib/bridge.js').AgentOpsJobInput} */
      const jobInput = {
        id: id.trim(),
        label: label.trim(),
        schedule: schedule.trim(),
        command: command.trim(),
        timezone: timezone.trim() || 'Africa/Lagos',
        enabled,
        mode,
        schedule_dialect: scheduleDialect,
      };
      // Only include model when mode is agent and a value was entered.
      if (mode === 'agent' && model.trim()) {
        jobInput.model = model.trim();
      }

      const res = await hostAgentOpsUpsertJob(jobInput);
      if (res && res.ok === true) {
        onSaved();
      } else {
        setSubmitErr(upsertErrorMsg(res?.code, res?.error));
      }
    } catch (err) {
      setSubmitErr(String(err));
    } finally {
      setSaving(false);
    }
  }

  // ── delete handler ─────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!job) return;
    setDeleting(true);
    setSubmitErr(null);
    try {
      const res = await hostAgentOpsDeleteJob(job.id);
      if (res && res.ok === true) {
        onSaved();
      } else {
        setSubmitErr(upsertErrorMsg(res?.code, res?.error));
        setShowDeleteConfirm(false);
      }
    } catch (err) {
      setSubmitErr(String(err));
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return html`
    <div
      class="ao-scrim open"
      onClick=${(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ao-jobform-title"
    >
      <div class="ao-modal ao-form-modal">
        <h3 id="ao-jobform-title">
          ${isEdit ? 'Edit job' : 'Add job'}
        </h3>

        ${submitErr && html`
          <div class="ao-form-submit-err" role="alert">${submitErr}</div>
        `}

        <!-- id -->
        <div class="ao-form-row">
          <label for="ao-field-id">Job ID</label>
          <input
            id="ao-field-id"
            class=${`ao-input${fieldErrs.id ? ' has-error' : ''}`}
            type="text"
            value=${id}
            disabled=${isEdit}
            placeholder="namespace:slug"
            onInput=${(e) => { setId(e.target.value); setFieldErrs((p) => ({ ...p, id: undefined })); }}
          />
          ${fieldErrs.id && html`<span class="ao-form-err">${fieldErrs.id}</span>`}
          <span class="ao-hint">Format: namespace:slug — e.g. pa:email-triage</span>
        </div>

        <!-- label -->
        <div class="ao-form-row">
          <label for="ao-field-label">Label</label>
          <input
            id="ao-field-label"
            class=${`ao-input${fieldErrs.label ? ' has-error' : ''}`}
            type="text"
            value=${label}
            placeholder="Human-readable job name"
            onInput=${(e) => { setLabel(e.target.value); setFieldErrs((p) => ({ ...p, label: undefined })); }}
          />
          ${fieldErrs.label && html`<span class="ao-form-err">${fieldErrs.label}</span>`}
        </div>

        <!-- schedule -->
        <div class="ao-form-row">
          <label for="ao-field-schedule">Schedule (cron)</label>
          <input
            id="ao-field-schedule"
            class=${`ao-input${fieldErrs.schedule ? ' has-error' : ''}`}
            type="text"
            value=${schedule}
            placeholder="5 8,12,17 * * *"
            onInput=${(e) => { setSchedule(e.target.value); setFieldErrs((p) => ({ ...p, schedule: undefined })); }}
          />
          ${fieldErrs.schedule && html`<span class="ao-form-err">${fieldErrs.schedule}</span>`}
          <span class="ao-hint">5-field or 6-field cron expression · dialect auto-detected</span>
        </div>

        <!-- schedule_dialect -->
        <div class="ao-form-row">
          <label for="ao-field-dialect">Schedule dialect</label>
          <select
            id="ao-field-dialect"
            class="ao-select"
            value=${scheduleDialect}
            onChange=${(e) => setScheduleDialect(/** @type {'5f'|'6f'} */ (e.target.value))}
          >
            <option value="5f">5-field (standard cron)</option>
            <option value="6f">6-field (with seconds)</option>
          </select>
        </div>

        <!-- timezone -->
        <div class="ao-form-row">
          <label for="ao-field-tz">Timezone</label>
          <input
            id="ao-field-tz"
            class="ao-input"
            type="text"
            value=${timezone}
            placeholder="Africa/Lagos"
            onInput=${(e) => setTimezone(e.target.value)}
          />
          <span class="ao-hint">IANA timezone — e.g. Africa/Lagos, UTC, America/New_York</span>
        </div>

        <!-- mode -->
        <div class="ao-form-row">
          <label for="ao-field-mode">Mode</label>
          <select
            id="ao-field-mode"
            class="ao-select"
            value=${mode}
            onChange=${(e) => setMode(/** @type {'agent'|'script'} */ (e.target.value))}
          >
            <option value="agent">agent — billable claude -p run</option>
            <option value="script">script — local command, no API cost</option>
          </select>
        </div>

        <!-- model (agent-only) -->
        ${mode === 'agent' && html`
          <div class="ao-form-row">
            <label for="ao-field-model">Model</label>
            <input
              id="ao-field-model"
              class="ao-input"
              type="text"
              value=${model}
              placeholder="sonnet"
              onInput=${(e) => setModel(e.target.value)}
            />
            <span class="ao-hint">e.g. sonnet, opus, haiku — leave blank for default</span>
          </div>
        `}

        <!-- command -->
        <div class="ao-form-row">
          <label for="ao-field-command">Command</label>
          <input
            id="ao-field-command"
            class=${`ao-input${fieldErrs.command ? ' has-error' : ''}`}
            type="text"
            value=${command}
            placeholder=${isEdit ? 'Re-enter the command to run (required)' : 'e.g. /path/to/script.sh or --agent rex'}
            onInput=${(e) => { setCommand(e.target.value); setFieldErrs((p) => ({ ...p, command: undefined })); }}
          />
          ${fieldErrs.command && html`<span class="ao-form-err">${fieldErrs.command}</span>`}
          ${isEdit && html`
            <span class="ao-hint">
              The host replaces the entire job definition — you must re-confirm the command.
            </span>
          `}
        </div>

        <!-- enabled -->
        <div class="ao-form-check">
          <input
            id="ao-field-enabled"
            type="checkbox"
            checked=${enabled}
            onChange=${(e) => setEnabled(e.target.checked)}
          />
          <label for="ao-field-enabled">Enabled (schedule active immediately)</label>
        </div>

        <!-- delete confirm inline (edit mode only) -->
        ${isEdit && showDeleteConfirm && html`
          <div class="ao-delete-confirm" role="alert">
            <span>Delete <strong>${job.id}</strong>? This cannot be undone.</span>
            <div class="ao-delete-confirm-btns">
              <button
                class="ao-btn sz-sm v-outline"
                onClick=${() => setShowDeleteConfirm(false)}
                disabled=${deleting}
              >Cancel</button>
              <button
                class="ao-btn sz-sm v-danger"
                onClick=${handleDelete}
                disabled=${deleting}
              >${deleting ? 'Deleting…' : 'Confirm delete'}</button>
            </div>
          </div>
        `}

        <!-- footer -->
        <div class="ao-form-footer">
          ${isEdit && !showDeleteConfirm && html`
            <button
              class="ao-btn sz-sm v-danger"
              onClick=${() => setShowDeleteConfirm(true)}
              disabled=${saving}
            >Delete job</button>
          `}
          <span class="ao-form-footer-spacer"></span>
          <button
            class="ao-btn sz-sm v-outline"
            onClick=${onCancel}
            disabled=${saving || deleting}
          >Cancel</button>
          <button
            class="ao-btn sz-sm v-primary"
            onClick=${handleSave}
            disabled=${hasErrors || saving || deleting}
          >${saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add job'}</button>
        </div>
      </div>
    </div>
  `;
}
