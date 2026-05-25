// Task detail pane — ported from routes/tasks/_components/-task-detail-pane.tsx.

import {
  html,
  cn,
  Icon,
  Button,
  useQuery,
  useMutation,
  useQueryClient,
} from '../../lib/ui.js';
import { getSupabase } from '../../lib/supabase.js';
import { queryKeys } from '../../lib/query-keys.js';
import {
  blockingTaskQuery,
  subtasksQuery,
  taskDetailQuery,
} from '../../lib/queries.js';
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

  const updateStatus = useMutation({
    /** @param {TaskStatus} status */
    mutationFn: async (status) => {
      /** @type {{ status: TaskStatus, completed_at?: string | null }} */
      const patch = { status };
      if (status === 'completed') patch.completed_at = new Date().toISOString();
      else if (task?.completed_at) patch.completed_at = null;
      const { error: e } = await getSupabase()
        .from('tasks')
        .update(patch)
        .eq('id', taskId);
      if (e) throw e;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all }),
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
      <div class="tk-det-head">
        <div class="tk-det-topline">
          <span class="id">task · ${shortId(task.id)}</span>
          ${density === 'full' && html`
            <div class="tk-det-actions">
              <${Button} variant="outline" size="sm" type="button">Reschedule</${Button}>
              <${Button} variant="outline" size="sm" type="button">Reassign</${Button}>
              <${Button}
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

        <h2 class="tk-det-title">${task.title}</h2>

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

      <div class="tk-det-body">
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
              <span class="tk-deferred-pill">deferred · UI</span>
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
            <div class="tk-desc">${task.description}</div>
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
                <div class="tk-progress">
                  <span style=${{ width: `${task.progress_pct}%` }}></span>
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

        ${blockingTask && html`
          <div>
            <div class="tk-section-label"><span>Blocked by</span></div>
            <button
              type="button"
              onClick=${() => onNavigateTask?.(blockingTask.id)}
              class="tk-src"
            >
              ${blockingTask.title}
            </button>
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
        <div class="tk-action-bar">
          <${Button} variant="outline" size="sm" type="button">Reschedule</${Button}>
          <span class="spacer"></span>
          <${Button}
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
