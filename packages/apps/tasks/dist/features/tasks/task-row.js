// Task list row — ported from routes/tasks/_components/-task-row.tsx.

import { html, cn, Icon } from '../../lib/ui.js';
import {
  assigneeIsAgent,
  autoCloseSignal,
  avatarInitial,
  dueLabel,
  execModeLabel,
  isAutoClosed,
  priorityClass,
  relativeAgo,
  statusClass,
} from '../../lib/shared.js';

/** @typedef {import('../../lib/queries.js').Task} Task */

/**
 * @param {{ task: Task, selected: boolean, onSelect: (id: string) => void }} props
 */
export function TaskRow({ task, selected, onSelect }) {
  const isAgent = assigneeIsAgent(task);
  const autoClosed = isAutoClosed(task);
  const due = autoClosed
    ? { label: relativeAgo(task.completed_at), cls: '' }
    : dueLabel(task.due_date);
  const signal = autoCloseSignal(task.outcome_notes);

  return html`
    <button
      type="button"
      class=${cn('tk-row', selected && 'is-on', autoClosed && 'is-completed')}
      onClick=${() => onSelect(task.id)}
    >
      <span class=${cn('pri-dot', priorityClass(task.priority))}></span>
      <div class="body">
        <div class="title">${task.title}</div>
        <div class="meta">
          <span class=${cn('tk-badge', statusClass(task.status))}>
            <span class="dot"></span>
            ${task.status.replace('_', ' ')}
          </span>
          ${autoClosed && signal && html`
            <span class="tk-autoclose">
              <${Icon} name="check-circle" size=${9} strokeWidth=${2.5} />
              ${signal}
            </span>
          `}
          ${task.assigned_to && html`
            <span class=${cn('tk-assignee', isAgent && 'is-agent')}>
              ${isAgent
                ? html`<span class="dot"></span>`
                : html`<span class="avatar">${avatarInitial(task.assigned_to)}</span>`}
              ${task.assigned_to}
            </span>
          `}
          ${task.category && html`<span class="cat">${task.category}</span>`}
          ${task.execution_mode && html`
            <span class=${cn('tk-execmode', `is-${task.execution_mode}`)}>
              ${execModeLabel(task.execution_mode)}
            </span>
          `}
        </div>
      </div>
      <div class="right">
        <span class=${cn('due', due.cls)}>${due.label}</span>
      </div>
    </button>
  `;
}
