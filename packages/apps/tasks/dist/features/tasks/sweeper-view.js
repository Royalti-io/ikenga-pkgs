// Sweeper — auto-close review queue. Ports the design's SWEEPER_HTML
// (atelier-tasks.html). The full design surfaces a confidence band: ≥ 0.9
// auto-closes silently; 0.6–0.9 waits here for human sign-off. The ikenga.db
// schema does not yet have a `task_signals` table to carry that signal, so
// this first cut shows two cohorts:
//
//   1. "Awaiting your call" — open tasks whose `outcome_notes` carry a
//      sweeper hint (`Needs review by task-health`) but aren't auto-closed yet.
//   2. "Recently auto-closed" — completed tasks where `outcome_notes` begins
//      `Auto-closed by task-health`. These are silent closes the design says
//      should still be visible for a window so you can reopen if wrong.
//
// Schema columns used: id, title, status, priority, outcome_notes,
// completed_at, updated_at. All present in royalti-pa/migrations/003/004.

import { html, Icon, Button, useQuery } from '../../lib/ui.js';
import { hostDbQuery } from '../../lib/bridge.js';
import { queryKeys } from '../../lib/query-keys.js';

/** @typedef {import('../../lib/queries.js').Task} Task */

/**
 * @param {string} iso
 * @returns {string}
 */
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

export function SweeperView() {
  // Two queries. Both narrow on `outcome_notes` to keep the result set bounded
  // to sweeper-flagged rows — the broader `tasks` table is already exposed by
  // the List view.
  const awaiting = useQuery({
    queryKey: queryKeys.tasks.list('sweeper:awaiting'),
    /** @returns {Promise<Task[]>} */
    queryFn: async () => {
      const rows = await hostDbQuery(
        `SELECT id, title, status, priority, outcome_notes, due_date, updated_at, category
         FROM tasks
         WHERE status IN ('pending','in_progress','blocked')
           AND outcome_notes LIKE 'Needs review by task-health%'
         ORDER BY updated_at DESC LIMIT 50`,
        [],
      );
      return /** @type {Task[]} */ (rows);
    },
  });

  const recent = useQuery({
    queryKey: queryKeys.tasks.list('sweeper:recent'),
    /** @returns {Promise<Task[]>} */
    queryFn: async () => {
      const rows = await hostDbQuery(
        `SELECT id, title, status, priority, outcome_notes, completed_at, category
         FROM tasks
         WHERE status = 'completed'
           AND outcome_notes LIKE 'Auto-closed by task-health%'
         ORDER BY completed_at DESC LIMIT 50`,
        [],
      );
      return /** @type {Task[]} */ (rows);
    },
  });

  const awaitingRows = awaiting.data ?? [];
  const recentRows = recent.data ?? [];

  function priClass(p) {
    if (p === 'high') return 'is-high';
    if (p === 'medium') return 'is-medium';
    return 'is-low';
  }

  return html`
    <div class="sweeper-wrap" style=${{
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: 'var(--space-5)',
      maxWidth: '880px',
    }}>
      <div class="tk-section-label" style=${{ marginBottom: 'var(--space-3)' }}>
        Auto-close sweeper · review queue
      </div>
      <p style=${{
        fontSize: 'var(--text-body-sm)',
        color: 'var(--fg-muted)',
        margin: '0 0 var(--space-5)',
        maxWidth: '62ch',
        lineHeight: 1.55,
      }}>
        The sweeper closes a task when its side-effect is observed — reply sent, post published,
        deal closed, commit landed. Confidence ≥ 0.9 auto-closes silently; 0.6–0.9 waits here
        for your sign-off.
      </p>

      ${awaitingRows.length > 0 && html`
        <div class="tk-section-label" style=${{
          fontSize: 11.5,
          color: 'var(--fg-faint)',
          margin: 'var(--space-5) 0 var(--space-2)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Awaiting your call · ${awaitingRows.length}
        </div>
        ${awaitingRows.map((t) => html`
          <div class="dense-row dense-row--task" key=${t.id}>
            <span class=${`dense-row-dot ${priClass(t.priority)}`}></span>
            <div class="dense-row-body">
              <div class="dense-row-title">${t.title}</div>
              <div class="meta">
                <span class="tk-autoclose" style=${{ color: 'var(--achievement)' }}>
                  <${Icon} name="alert-circle" size=${11} />
                  ${t.outcome_notes ?? 'needs review'}
                </span>
              </div>
            </div>
            <div class="dense-row-right" style=${{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <${Button} size="sm" variant="ghost">Keep open</${Button}>
              <${Button} size="sm" variant="affirmative">Approve close</${Button}>
            </div>
          </div>
        `)}
      `}

      <div class="tk-section-label" style=${{
        fontSize: 11.5,
        color: 'var(--fg-faint)',
        margin: 'var(--space-5) 0 var(--space-2)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}>
        Recently auto-closed · ${recentRows.length}
      </div>
      ${recentRows.length === 0 && html`
        <div style=${{ color: 'var(--fg-muted)', fontSize: 'var(--text-body-sm)', padding: 'var(--space-3) 0' }}>
          No silent closes yet. When the sweeper closes a task above 0.9 confidence it'll show here for 7d.
        </div>
      `}
      ${recentRows.map((t) => html`
        <div class="dense-row dense-row--task is-completed" key=${t.id}>
          <span class=${`pri-dot ${priClass(t.priority)}`}></span>
          <div class="body">
            <div class="title">${t.title}</div>
            <div class="meta">
              <span class="tk-badge is-completed"><span class="dot"></span>completed</span>
              <span class="tk-autoclose">
                <${Icon} name="check" size=${11} />
                ${(t.outcome_notes ?? '').replace(/^Auto-closed by task-health:?\s*/, '') || 'auto-closed'}
              </span>
            </div>
          </div>
          <div class="dense-row-right"><span class="dense-row-due">${relTime(t.completed_at)}</span></div>
        </div>
      `)}
    </div>
  `;
}
