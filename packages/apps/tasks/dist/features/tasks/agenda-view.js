// Agenda / Today rail — ported from routes/tasks/_components/-agenda-view.tsx.

import { html, cn, Icon } from '../../lib/ui.js';
import {
  assigneeIsAgent,
  avatarInitial,
  buildAgenda,
  dueLabel,
  execModeLabel,
} from '../../lib/shared.js';

/** @typedef {import('../../lib/queries.js').Task} Task */
/** @typedef {import('../../lib/shared.js').AgendaBlock} AgendaBlock */

/** @param {{ block: AgendaBlock }} props */
function BlockCard({ block }) {
  const { task, lane, done } = block;
  const isAgent = assigneeIsAgent(task);
  const due = dueLabel(task.due_date);
  return html`
    <div class=${cn('ag-block', `is-${lane}`, done && 'is-done')}>
      <div class="t">${task.title}</div>
      <div class="m">
        <span class=${cn('tk-badge', `is-${task.status}`)}>
          <span class="dot"></span>
          ${task.status.replace('_', ' ')}
        </span>
        ${task.assigned_to && html`
          <span class=${cn('tk-assignee', isAgent && 'is-agent')}>
            ${isAgent
              ? html`<span class="dot"></span>`
              : html`<span class="avatar">${avatarInitial(task.assigned_to)}</span>`}
            ${task.assigned_to}
          </span>
        `}
        ${task.execution_mode && html`
          <span class=${cn('tk-execmode', `is-${task.execution_mode}`)}>
            ${execModeLabel(task.execution_mode)}
          </span>
        `}
        ${done
          ? html`
              <span class="tk-autoclose">
                <${Icon} name="check-circle" size=${9} strokeWidth=${2.5} />
                done
              </span>
            `
          : html`<span class=${cn('due', due.cls)}>${due.label}</span>`}
      </div>
    </div>
  `;
}

/** @param {{ tasks: Task[], filterActive?: boolean }} props */
export function AgendaView({ tasks, filterActive }) {
  const now = new Date();
  const slots = buildAgenda(tasks, now);
  const nowHour = now.getHours();
  const nowIdx = slots.findIndex((s) => s.hour >= 0 && s.hour >= nowHour);

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  if (slots.length === 0) {
    return html`
      <div class="ag-wrap">
        <div class="ag-head">
          <span class="ag-date">${dateLabel}</span>
          ${filterActive && html`<span class="ag-filter-note">filtered view</span>`}
        </div>
        <div class="tk-empty" style=${{ minHeight: 160 }}>
          ${filterActive
            ? 'Nothing scheduled for today in the current filter'
            : 'Nothing scheduled for today'}
        </div>
      </div>
    `;
  }

  const scheduled = slots.reduce(
    (n, s) => n + (s.key === 'overdue' ? 0 : s.blocks.length),
    0,
  );
  const overdueCount = slots.find((s) => s.key === 'overdue')?.blocks.length ?? 0;

  return html`
    <div class="ag-wrap">
      <div class="ag-head">
        <span class="ag-date">${dateLabel}</span>
        <span class="ag-summary">
          ${scheduled} scheduled
          ${overdueCount > 0 && html`${' · '}<b>${overdueCount} overdue pulled forward</b>`}
          ${filterActive && html`${' · '}<span class="ag-filter-note">filtered view</span>`}
        </span>
      </div>
      <div class="ag-grid">
        ${slots.map((slot, i) => html`
          <div key=${slot.key} class="ag-slot-row" style=${{ display: 'contents' }}>
            ${nowIdx === i && html`<div class="ag-now"></div>`}
            <div class="ag-time">${slot.time}</div>
            <div class="ag-lane">
              ${slot.blocks.map((b) => html`<${BlockCard} key=${b.task.id} block=${b} />`)}
            </div>
          </div>
        `)}
        ${nowIdx === -1 && html`<div class="ag-now"></div>`}
      </div>
    </div>
  `;
}
