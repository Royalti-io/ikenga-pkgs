// In-body view switcher — ported from routes/tasks/_components/-view-tabs.tsx.

import { html, cn, Icon } from '../../lib/ui.js';

/** @typedef {import('../../lib/shared.js').TaskView} TaskView */

/** @type {Array<{ key: TaskView, label: string, icon: string }>} */
const TABS = [
  { key: 'tasks', label: 'Tasks', icon: 'check-square' },
  { key: 'agenda', label: 'Agenda', icon: 'calendar-days' },
  { key: 'triage', label: 'Triage', icon: 'stethoscope' },
];

/**
 * @param {{ view: TaskView, onChange: (v: TaskView) => void, triageCount?: number | null }} props
 */
export function ViewTabs({ view, onChange, triageCount }) {
  return html`
    <div class="ip-tabs" role="tablist" aria-label="Tasks views">
      ${TABS.map(({ key, label, icon }) => html`
        <button
          key=${key}
          type="button"
          role="tab"
          aria-selected=${view === key}
          class=${cn('ip-tab', view === key && 'is-on')}
          onClick=${() => onChange(key)}
        >
          <${Icon} name=${icon} size=${13} />
          <span>${label}</span>
          ${key === 'triage' && triageCount != null && triageCount > 0 && html`
            <span class="ip-tab-badge">${triageCount}</span>
          `}
        </button>
      `)}
    </div>
  `;
}
