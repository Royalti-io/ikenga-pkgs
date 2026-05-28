// Done — completed tasks. Ports the design's DONE_HTML (atelier-tasks.html).
// Two distinctions versus the List view's "Auto-closed" group:
//   1. Includes ALL completed tasks (manual + auto-closed), not just sweeper.
//   2. Groups by relative time bucket (Today / This week / Earlier) so the
//      latest completions stay on top without burying older ones.
//
// Schema columns used: id, title, status, priority, completed_at,
// outcome_notes, category. Tasks without `completed_at` fall back to
// `updated_at` so legacy rows still group sensibly.

import { html, Icon, useQuery, useMemo } from '../../lib/ui.js';
import { hostDbQuery } from '../../lib/bridge.js';
import { queryKeys } from '../../lib/query-keys.js';

/** @typedef {import('../../lib/queries.js').Task} Task */

const ONE_DAY = 24 * 60 * 60 * 1000;

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const dt = Date.now() - t;
  const min = Math.round(dt / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const dy = Math.round(hr / 24);
  return `${dy}d ago`;
}

/** @param {Task[]} tasks */
function bucketize(tasks) {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today.getTime() - 7 * ONE_DAY);

  /** @type {{ key: string, label: string, tasks: Task[] }[]} */
  const buckets = [
    { key: 'today', label: 'Today', tasks: [] },
    { key: 'week', label: 'This week', tasks: [] },
    { key: 'earlier', label: 'Earlier', tasks: [] },
  ];

  for (const t of tasks) {
    const when = t.completed_at ?? t.updated_at ?? null;
    const dt = when ? new Date(when).getTime() : 0;
    if (!dt) {
      buckets[2].tasks.push(t);
    } else if (dt >= today.getTime()) {
      buckets[0].tasks.push(t);
    } else if (dt >= weekStart.getTime()) {
      buckets[1].tasks.push(t);
    } else {
      buckets[2].tasks.push(t);
    }
  }
  return buckets.filter((b) => b.tasks.length > 0);
}

export function DoneView() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.tasks.list('done'),
    /** @returns {Promise<Task[]>} */
    queryFn: async () => {
      const rows = await hostDbQuery(
        `SELECT id, title, status, priority, completed_at, updated_at, outcome_notes, category
         FROM tasks
         WHERE status = 'completed'
         ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT 200`,
        [],
      );
      return /** @type {Task[]} */ (rows);
    },
  });

  const buckets = useMemo(() => bucketize(data ?? []), [data]);

  function priClass(p) {
    if (p === 'high') return 'is-high';
    if (p === 'medium') return 'is-medium';
    return 'is-low';
  }

  return html`
    <div class="done-wrap" style=${{
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: 'var(--space-5)',
      maxWidth: '880px',
    }}>
      <div class="tk-section-label" style=${{ marginBottom: 'var(--space-3)' }}>
        Done · completed tasks
      </div>

      ${isLoading && html`
        <div class="tk-loading">
          <${Icon} name="loader" size=${16} className="tk-spin" />
          Loading…
        </div>
      `}
      ${error instanceof Error && html`
        <div class="tk-error">
          <${Icon} name="alert-circle" size=${16} />
          <div>
            <p class="t">Failed to load completed tasks</p>
            <p class="d">${error.message}</p>
          </div>
        </div>
      `}
      ${!isLoading && !error && buckets.length === 0 && html`
        <div style=${{ color: 'var(--fg-muted)', fontSize: 'var(--text-body-sm)', padding: 'var(--space-3) 0' }}>
          Nothing completed yet. Close a task in the List view to see it here.
        </div>
      `}

      ${buckets.map((b) => html`
        <div key=${b.key}>
          <div class="tk-section-label" style=${{
            fontSize: 11.5,
            color: 'var(--fg-faint)',
            margin: 'var(--space-5) 0 var(--space-2)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            ${b.label} · ${b.tasks.length}
          </div>
          ${b.tasks.map((t) => {
            const isAuto = !!t.outcome_notes && t.outcome_notes.startsWith('Auto-closed by task-health');
            const detail = isAuto
              ? t.outcome_notes.replace(/^Auto-closed by task-health:?\s*/, '') || 'auto-closed'
              : null;
            return html`
              <div class="tk-row is-completed" key=${t.id}>
                <span class=${`pri-dot ${priClass(t.priority)}`}></span>
                <div class="body">
                  <div class="title">${t.title}</div>
                  <div class="meta">
                    <span class="tk-badge is-completed"><span class="dot"></span>completed</span>
                    ${isAuto && html`
                      <span class="tk-autoclose">
                        <${Icon} name="check" size=${11} />
                        ${detail}
                      </span>
                    `}
                  </div>
                </div>
                <div class="right">
                  <span class="due">${relTime(t.completed_at ?? t.updated_at)}</span>
                </div>
              </div>
            `;
          })}
        </div>
      `)}
    </div>
  `;
}
