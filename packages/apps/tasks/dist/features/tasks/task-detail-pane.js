// Task detail pane — ported from routes/tasks/_components/-task-detail-pane.tsx.

import {
  html,
  cn,
  Icon,
  Button,
  useState,
  useQuery,
  useMutation,
  useQueryClient,
} from '../../lib/ui.js';
import { queryKeys } from '../../lib/query-keys.js';
import {
  blockingTaskQuery,
  dependentTasksQuery,
  reassignTask,
  subtasksQuery,
  taskDetailQuery,
  updateTaskStatus,
} from '../../lib/queries.js';
import { assigneeOptions } from '../../lib/assignees.js';
import { getContext } from '../../lib/bridge.js';
import {
  assigneeIsAgent,
  autoCloseSignal,
  avatarInitial,
  dueLabel,
  isAutoClosed,
  priorityClass,
  relativeAgo,
  shortId,
  statusClass,
} from '../../lib/shared.js';

/** @typedef {import('../../lib/queries.js').Task} Task */
/** @typedef {import('../../lib/queries.js').TaskStatus} TaskStatus */

/** @type {TaskStatus[]} */
const STATUS_OPTIONS = ['pending', 'in_progress', 'blocked', 'completed', 'cancelled'];

/**
 * @param {{ taskId: string, density?: import('../../lib/shared.js').Density, onNavigateTask?: (id: string) => void }} props
 */
export function TaskDetailPane({ taskId, density = 'full', onNavigateTask }) {
  const queryClient = useQueryClient();

  const { data: task, isLoading, error } = useQuery(taskDetailQuery(taskId));
  const { data: subtasks } = useQuery(subtasksQuery(taskId));
  const { data: blockingTask } = useQuery(
    blockingTaskQuery(task?.blocked_by_task_id ?? null),
  );
  // Downstream dependents — the "Blocks" lane. Tasks naming this one as their
  // blocker are waiting on it.
  const { data: dependentTasks } = useQuery(dependentTasksQuery(taskId));

  const updateStatus = useMutation({
    /** @param {TaskStatus} status */
    mutationFn: async (status) => {
      await updateTaskStatus(taskId, status);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
  });

  // Reassign — toggled open by the head's Reassign button (was dead until now).
  const [reassignOpen, setReassignOpen] = useState(false);
  const reassign = useMutation({
    /** @param {string} value picked assigned_to ('' = unassign) */
    mutationFn: async (value) => {
      const picked = assigneeOptions(getContext()).find((o) => o.value === value);
      await reassignTask(taskId, value || null, picked ? picked.type : null);
    },
    onSuccess: () => {
      // tasks.all covers every list view (assigned_to is shown across them);
      // detail covers this pane's own query.
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
      setReassignOpen(false);
    },
  });

  if (isLoading) {
    return html`
      <div class=${cn('tk-detail-pane', `is-${density}`)}>
        <div class="tk-empty">
          <${Icon} name="loader" size=${16} className="tk-spin" />
        </div>
      </div>
    `;
  }
  if (error instanceof Error) {
    return html`
      <div class=${cn('tk-detail-pane', `is-${density}`)}>
        <div class="tk-empty" style=${{ color: 'var(--danger)', flexDirection: 'column', gap: 8 }}>
          <${Icon} name="alert-circle" size=${20} />
          <span>${error.message}</span>
        </div>
      </div>
    `;
  }
  if (!task) {
    return html`
      <div class=${cn('tk-detail-pane', `is-${density}`)}>
        <div class="tk-empty">task not found</div>
      </div>
    `;
  }

  const isAgent = assigneeIsAgent(task);
  const autoClosed = isAutoClosed(task);
  const signal = autoCloseSignal(task.outcome_notes);
  const due = dueLabel(task.due_date);
  const dueDate = task.due_date
    ? new Date(task.due_date).toISOString().slice(0, 10)
    : null;

  return html`
    <div class=${cn('tk-detail-pane', `is-${density}`)}>
      <div class="ip-head">
        <div class="ip-topline">
          <span class="id">task · ${shortId(task.id)}</span>
          ${density === 'full' && html`
            <div class="ip-topline-actions">
              ${/* Reschedule is a visual stub (no scheduler dialog yet) —
                    disabled so it doesn't read as actionable (F-07). */ ''}
              <${Button}
                variant="outline"
                size="sm"
                type="button"
                disabled
                title="Rescheduling is not wired up yet"
              >Reschedule</${Button}>
              <${Button}
                variant=${reassignOpen ? 'default' : 'outline'}
                size="sm"
                type="button"
                onClick=${() => setReassignOpen((v) => !v)}
              >Reassign</${Button}>
              <${Button}
                variant="affirmative"
                size="sm"
                type="button"
                disabled=${updateStatus.isPending || task.status === 'completed'}
                onClick=${() => updateStatus.mutate('completed')}
              >
                <${Icon} name="check" size=${12} /> Mark complete
              </${Button}>
            </div>
          `}
        </div>

        ${density === 'full' && reassignOpen && html`
          <div
            style=${{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
              padding: '8px 10px',
              background: 'var(--bg-sunken)',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <span
              style=${{
                fontFamily: 'var(--font-mono)',
                fontSize: 10.5,
                color: 'var(--fg-faint)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >Assign to</span>
            <select
              value=${task.assigned_to ?? ''}
              disabled=${reassign.isPending}
              onChange=${(e) => reassign.mutate(e.target.value)}
              style=${{
                height: 26,
                fontSize: 11.5,
                padding: '0 6px',
                background: 'var(--bg-base)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--fg)',
                fontFamily: 'inherit',
              }}
            >
              <option value="">Unassigned</option>
              ${task.assigned_to && !assigneeOptions(getContext()).some((o) => o.value === task.assigned_to) &&
                html`<option value=${task.assigned_to}>${task.assigned_to} (current)</option>`}
              ${assigneeOptions(getContext()).map(
                (o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`,
              )}
            </select>
            ${reassign.isPending && html`<${Icon} name="loader" size=${12} className="tk-spin" />`}
            ${reassign.isError && html`
              <span style=${{ color: 'var(--danger)', fontSize: 11 }}>
                ${(/** @type {Error} */ (reassign.error)).message}
              </span>
            `}
          </div>
        `}

        <h2 class="ip-title">${task.title}</h2>

        <div class="tk-det-meta-row">
          <span class=${cn('tk-badge', statusClass(task.status))}>
            <span class="dot"></span> ${task.status.replace('_', ' ')}
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
              ${task.execution_mode === 'approval_required' ? 'approval req' : task.execution_mode}
            </span>
          `}
          ${task.priority && html`
            <span class="sep">priority</span>
            <span class=${cn('pri-label', priorityClass(task.priority))}>
              <span class="dot"></span>
              ${task.priority}
            </span>
          `}
          ${task.category && html`
            <span class="sep">·</span>
            <span style=${{ color: 'var(--fg-muted)' }}>${task.category}</span>
          `}
          ${dueDate && html`
            <span class="sep">·</span>
            <span class=${cn('due-text', due.cls)}>
              due ${dueDate}${due.cls === 'is-overdue' ? ` · ${due.label}` : ''}
            </span>
          `}
        </div>
      </div>

      <div class="ip-body">
        ${autoClosed && task.outcome_notes && html`
          <div class="tk-evidence">
            <div class="tk-evidence-head">
              <span class="rule-chip">
                <${Icon} name="check" size=${10} strokeWidth=${2.5} />
                ${signal ?? 'auto-closed'}
              </span>
              <span class="timestamp">${relativeAgo(task.completed_at)}</span>
            </div>
            <div class="body">${task.outcome_notes}</div>
          </div>
        `}

        ${(task.source_email_id || task.claude_session_id || task.initiative_id) && html`
          <div>
            <div class="tk-section-label">
              <span>Source & context</span>
            </div>
            <div class="tk-source-row">
              ${task.source_email_id && html`
                <button type="button" class="tk-src is-email">
                  <${Icon} name="mail" size=${11} />
                  email · ${shortId(task.source_email_id)}
                </button>
              `}
              ${task.claude_session_id && html`
                <button type="button" class="tk-src is-session" disabled>
                  <${Icon} name="terminal" size=${11} />
                  session · ${shortId(task.claude_session_id)}
                </button>
              `}
              ${task.initiative_id && html`
                <button type="button" class="tk-src is-git">
                  <${Icon} name="git-branch" size=${11} />
                  initiative · ${task.initiative_id}
                </button>
              `}
            </div>
          </div>
        `}

        ${task.description && html`
          <div>
            <div class="tk-section-label"><span>Description</span></div>
            <div class="ip-desc">${task.description}</div>
          </div>
        `}

        <div>
          <div class="tk-section-label"><span>Fields</span></div>
          <dl class="tk-det-grid">
            <dt>Status</dt>
            <dd>
              <select
                value=${task.status}
                disabled=${updateStatus.isPending}
                onChange=${(e) => updateStatus.mutate(/** @type {TaskStatus} */ (e.target.value))}
                style=${{
                  height: 24,
                  fontSize: 11.5,
                  padding: '0 6px',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-xs)',
                  color: 'var(--fg)',
                  fontFamily: 'inherit',
                }}
              >
                ${STATUS_OPTIONS.map((s) => html`
                  <option key=${s} value=${s}>${s.replace('_', ' ')}</option>
                `)}
              </select>
            </dd>
            ${task.progress_pct !== null && html`
              <dt>Progress</dt>
              <dd>
                <div class="ip-progress">
                  <span class="ip-progress-fill" style=${{ width: `${task.progress_pct}%` }}></span>
                </div>
                <span style=${{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-muted)' }}>
                  ${task.progress_pct}%
                </span>
              </dd>
            `}
            ${task.effort_estimate && html`
              <dt>Effort</dt>
              <dd><code>${task.effort_estimate}</code></dd>
            `}
            ${task.tags && task.tags.length > 0 && html`
              <dt>Tags</dt>
              <dd>
                ${task.tags.map((tag) => html`
                  <span
                    key=${tag}
                    style=${{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      background: 'var(--bg-sunken)',
                      border: '1px solid var(--border-soft)',
                      color: 'var(--fg-muted)',
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-xs)',
                    }}
                  >${tag}</span>
                `)}
              </dd>
            `}
            ${task.working_dir && html`
              <dt>Working dir</dt>
              <dd><code>${task.working_dir}</code></dd>
            `}
            <dt>Created</dt>
            <dd style=${{ color: 'var(--fg-muted)' }}>
              ${new Date(task.created_at).toLocaleString()}
              ${task.agent_source && html`
                ${' by '}
                <span style=${{ color: 'var(--agent)', fontFamily: 'var(--font-mono)' }}>
                  ${task.agent_source}
                </span>
              `}
            </dd>
          </dl>
        </div>

        ${(blockingTask || (dependentTasks && dependentTasks.length > 0)) && html`
          <div>
            <div class="tk-section-label"><span>Dependencies</span></div>
            ${blockingTask && html`
              <div class="tk-dep-lane">Blocked by</div>
              <div class="tk-dep-list">
                <button
                  type="button"
                  class=${cn('tk-dep-row', blockingTask.status === 'completed' ? 'is-resolved' : 'is-up')}
                  onClick=${() => onNavigateTask?.(blockingTask.id)}
                >
                  ${blockingTask.status === 'completed'
                    ? html`<${Icon} name="check" size=${13} strokeWidth=${2.2} className="arr" />`
                    : html`<${Icon} name="alert-circle" size=${13} className="arr" />`}
                  <span class="name">${blockingTask.title}</span>
                  <span class=${cn('tk-badge', statusClass(blockingTask.status))}>
                    <span class="dot"></span>
                    ${blockingTask.status === 'completed' ? 'resolved' : blockingTask.status.replace('_', ' ')}
                  </span>
                </button>
              </div>
            `}
            ${dependentTasks && dependentTasks.length > 0 && html`
              <div class="tk-dep-lane">Blocks</div>
              <div class="tk-dep-list">
                ${dependentTasks.map((d) => html`
                  <button
                    type="button"
                    key=${d.id}
                    class=${cn('tk-dep-row', d.status === 'completed' ? 'is-resolved' : 'is-down')}
                    onClick=${() => onNavigateTask?.(d.id)}
                  >
                    ${d.status === 'completed'
                      ? html`<${Icon} name="check" size=${13} strokeWidth=${2.2} className="arr" />`
                      : html`<${Icon} name="arrow-down" size=${13} className="arr" />`}
                    <span class="name">${d.title}</span>
                    <span class=${cn('tk-badge', statusClass(d.status))}>
                      <span class="dot"></span>
                      ${d.status === 'completed'
                        ? 'resolved'
                        : d.status === 'pending'
                          ? 'waiting'
                          : d.status.replace('_', ' ')}
                    </span>
                  </button>
                `)}
              </div>
            `}
          </div>
        `}

        ${subtasks && subtasks.length > 0 && html`
          <div>
            <div class="tk-section-label">
              <span>Subtasks</span>
              <span class="ct">
                ${subtasks.filter((s) => s.status === 'completed').length}/${subtasks.length}
              </span>
            </div>
            <div class="tk-subtasks">
              ${subtasks.map((s) => html`
                <button
                  type="button"
                  key=${s.id}
                  class=${cn('tk-sub-row', s.status === 'completed' && 'is-completed')}
                  onClick=${() => onNavigateTask?.(s.id)}
                >
                  <span class=${cn('tk-badge', statusClass(s.status))}>
                    <span class="dot"></span>
                    ${s.status === 'completed'
                      ? 'done'
                      : s.status === 'in_progress'
                        ? 'now'
                        : s.status.replace('_', ' ')}
                  </span>
                  <span class="name">${s.title}</span>
                  <span class="due">
                    ${s.completed_at
                      ? relativeAgo(s.completed_at)
                      : s.status === 'in_progress'
                        ? 'in flight'
                        : ''}
                  </span>
                </button>
              `)}
            </div>
          </div>
        `}

        ${density !== 'side' && html`
          <div>
            <div class="tk-section-label">
              <span>Activity</span>
              <span class="tk-deferred-pill">deferred · audit table</span>
            </div>
            <div class="tk-timeline">
              <div class="tk-tl-item is-mark">
                <span class="when">
                  ${new Date(task.created_at).toLocaleString(undefined, {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                ${task.agent_source && html`<span class="actor is-agent">${task.agent_source}</span>`}
                created${task.assigned_to ? ` · assigned to ${task.assigned_to}` : ''}
              </div>
              ${task.completed_at && html`
                <div class="tk-tl-item is-ok">
                  <span class="when">
                    ${new Date(task.completed_at).toLocaleString(undefined, {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span class="actor">
                    ${autoClosed ? 'task-health' : task.assigned_to ?? 'system'}
                  </span>
                  ${autoClosed ? 'auto-closed' : 'completed'}
                </div>
              `}
            </div>
          </div>
        `}
      </div>

      ${density !== 'full' && html`
        <div class="ip-action-bar">
          <${Button}
            variant="outline"
            size="sm"
            type="button"
            disabled
            title="Rescheduling is not wired up yet"
          >Reschedule</${Button}>
          <span class="ip-action-bar-spacer"></span>
          <${Button}
            variant="affirmative"
            size="sm"
            type="button"
            disabled=${updateStatus.isPending || task.status === 'completed'}
            onClick=${() => updateStatus.mutate('completed')}
          >Mark complete</${Button}>
        </div>
      `}

      ${updateStatus.isError && html`
        <p class="tk-mut-error">
          Failed: ${(/** @type {Error} */ (updateStatus.error)).message}
        </p>
      `}
    </div>
  `;
}
