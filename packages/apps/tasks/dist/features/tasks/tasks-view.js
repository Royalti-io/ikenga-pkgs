// Tasks main view — ported from views/TasksView.tsx. List + filter bar +
// grouped rows + master/detail split + in-body view switcher (Tasks/Agenda/
// Triage) with localStorage persistence.

import { html, cn, Icon, Button, useState, useMemo, useEffect, useQuery } from '../../lib/ui.js';
import { getSupabase } from '../../lib/supabase.js';
import { hostSendToActiveSession, isStandalone } from '../../lib/bridge.js';
import { queryKeys } from '../../lib/query-keys.js';
import { TASKS_LIST_COLUMNS, triageCountsQuery } from '../../lib/queries.js';
import { groupTasks } from '../../lib/shared.js';
import { TaskRow } from './task-row.js';
import { TaskDetailPane } from './task-detail-pane.js';
import { ViewTabs } from './view-tabs.js';
import { AgendaView } from './agenda-view.js';
import { TriageView } from './triage-view.js';

/** @typedef {import('../../lib/queries.js').Task} Task */
/** @typedef {import('../../lib/queries.js').TaskStatus} TaskStatus */
/** @typedef {import('../../lib/shared.js').GroupKey} GroupKey */
/** @typedef {import('../../lib/shared.js').TaskView} TaskView */

const VIEW_STORAGE_KEY = 'ikenga-tasks-view';

/** @returns {TaskView} */
function loadView() {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    if (v === 'tasks' || v === 'agenda' || v === 'triage') return v;
  } catch {
    /* localStorage unavailable (sandboxed iframe) — fall through */
  }
  return 'tasks';
}

/** @type {Array<{ value: '' | TaskStatus, label: string }>} */
const STATUS_OPTIONS = [
  { value: '', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'completed', label: 'Completed' },
];

/** @param {{ activeFeature?: string | null }} props */
export function TasksView({ activeFeature } = {}) {
  /** @type {[string | null, (v: string | null) => void]} */
  const [selectedId, setSelectedId] = useState(/** @type {string | null} */ (null));
  /** @type {['' | TaskStatus, (v: '' | TaskStatus) => void]} */
  const [statusFilter, setStatusFilter] = useState(/** @type {'' | TaskStatus} */ (''));
  const [ownerFilter, setOwnerFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showAutoClosed, setShowAutoClosed] = useState(true);
  /** @type {[Set<GroupKey>, (f: (prev: Set<GroupKey>) => Set<GroupKey>) => void]} */
  const [collapsed, setCollapsed] = useState(/** @type {Set<GroupKey>} */ (new Set(['later'])));
  const [view, setView] = useState(loadView);

  /** @param {TaskView} v */
  function changeView(v) {
    setView(v);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }

  // Shell side-menu selection (host.pkg.setMenu → royaltiSuite.activeFeature).
  // View ids switch the mounted view; `f:<group>` filter ids jump the Tasks
  // list to that group (expanding it, surfacing auto-closed when relevant).
  useEffect(() => {
    if (!activeFeature) return;
    if (activeFeature === 'tasks' || activeFeature === 'agenda' || activeFeature === 'triage') {
      setView(activeFeature);
      return;
    }
    if (activeFeature.startsWith('f:')) {
      const key = /** @type {GroupKey} */ (activeFeature.slice(2)); // today|overdue|autoclosed
      setView('tasks');
      if (key === 'autoclosed') setShowAutoClosed(true);
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      // Defer so the Tasks view + group are mounted before we scroll to it.
      requestAnimationFrame(() => {
        const el = document.querySelector(`.tk-list [data-group="${key}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [activeFeature]);

  // Server-side health counts — drive the Triage tab badge (and the Triage
  // view's stat cards), correct independent of the list filter + 200-row cap.
  const { data: triageCounts } = useQuery(triageCountsQuery());
  const triageBadge = triageCounts ? triageCounts.needsAttention : null;

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.tasks.list(
      `${statusFilter || 'open'}|${ownerFilter}|${categoryFilter}|${showAutoClosed ? 'ac' : 'no-ac'}`,
    ),
    /** @returns {Promise<Task[]>} */
    queryFn: async () => {
      let q = getSupabase()
        .from('tasks')
        .select(TASKS_LIST_COLUMNS)
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(200);

      if (statusFilter) {
        q = q.eq('status', statusFilter);
      } else if (showAutoClosed) {
        q = q.or(
          'status.in.(pending,in_progress,blocked),and(status.eq.completed,outcome_notes.ilike.Auto-closed by task-health%)',
        );
      } else {
        q = q.in('status', ['pending', 'in_progress', 'blocked']);
      }
      if (ownerFilter) q = q.eq('assigned_to', ownerFilter);
      if (categoryFilter) q = q.eq('category', categoryFilter);
      if (search.trim()) q = q.ilike('title', `%${search.trim()}%`);

      const { data: rows, error: e } = await q;
      if (e) throw e;
      return /** @type {Task[]} */ (rows ?? []);
    },
  });

  const groups = useMemo(
    () => (data ? groupTasks(data, showAutoClosed) : []),
    [data, showAutoClosed],
  );

  const openCount = useMemo(
    () => data?.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length ?? 0,
    [data],
  );
  const autoClosedCount = useMemo(
    () =>
      data?.filter(
        (t) =>
          t.status === 'completed' &&
          !!t.outcome_notes &&
          t.outcome_notes.startsWith('Auto-closed by task-health'),
      ).length ?? 0,
    [data],
  );

  const filterActive = !!statusFilter || !!ownerFilter || !!categoryFilter || !!search.trim();

  const [creating, setCreating] = useState(false);

  // Create = dispatch, NOT anon insert. Anon RLS on `tasks` only grants UPDATE
  // of status/completed_at — never INSERT — so a new task cannot be written
  // client-side. Instead we seed a user turn into the shell's active Claude
  // session (host.sendToActiveSession); the agent creates the task via its
  // privileged path. Disabled in standalone (no host to dispatch to).
  async function createTask() {
    if (creating || isStandalone()) return;
    setCreating(true);
    try {
      await hostSendToActiveSession(
        'Create a new task. Ask me for the title, owner, priority, and due date, then add it to the tasks table.',
      );
    } catch (e) {
      console.warn('[tasks] create dispatch failed', e);
    } finally {
      setCreating(false);
    }
  }

  /** @param {GroupKey} key */
  function toggleGroup(key) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return html`
    <div class="tk-screen">
      <div class="tk-frame" style=${{ flex: 1 }}>
        <div class="tk-frame-head">
          <div class="tk-frame-title-wrap">
            <${Icon} name="check-square" size=${18} className="tk-frame-title-mark" />
            <div>
              <h2 class="tk-frame-title">
                Tasks
                <span class="tk-frame-count">(${openCount} open · ${autoClosedCount} auto-closed)</span>
              </h2>
              <div class="tk-frame-sub">
                Cross-cutting work — humans + agents. Click a row to inspect.
              </div>
            </div>
          </div>
          <div style=${{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <${Button}
              size="sm"
              type="button"
              disabled=${creating || isStandalone()}
              title=${isStandalone() ? 'Dispatch unavailable in standalone preview' : 'Dispatch a task to your Chi'}
              onClick=${createTask}
            >
              <${Icon} name=${creating ? 'loader' : 'plus'} size=${12} className=${creating ? 'tk-spin' : undefined} />
              ${creating ? 'Dispatching…' : 'New task'}
            </${Button}>
          </div>
        </div>

        ${isStandalone() &&
        html`<${ViewTabs} view=${view} onChange=${changeView} triageCount=${triageBadge} />`}

        ${view === 'agenda' && html`<${AgendaView} tasks=${data ?? []} filterActive=${filterActive} />`}
        ${view === 'triage' && html`<${TriageView} listTasks=${data ?? []} />`}

        ${view === 'tasks' && html`
          <div class="tk-filterbar">
            <div class="input-search-wrap">
              <${Icon} name="search" size=${13} />
              <input
                type="text"
                value=${search}
                onInput=${(e) => setSearch(e.target.value)}
                placeholder="Search title…"
              />
            </div>
            <span class="label">Status</span>
            <select
              value=${statusFilter}
              onChange=${(e) => setStatusFilter(/** @type {'' | TaskStatus} */ (e.target.value))}
            >
              ${STATUS_OPTIONS.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
            </select>
            <span class="label">Owner</span>
            <select value=${ownerFilter} onChange=${(e) => setOwnerFilter(e.target.value)}>
              <option value="">Anyone</option>
              <option value="nedjamez">Me</option>
              <option value="cfo-agent">cfo-agent</option>
              <option value="cmo-agent">cmo-agent</option>
              <option value="cto-agent">cto-agent</option>
              <option value="cpo-agent">cpo-agent</option>
              <option value="vp-sales-agent">vp-sales-agent</option>
              <option value="blog-writer">blog-writer</option>
            </select>
            <span class="label">Category</span>
            <select value=${categoryFilter} onChange=${(e) => setCategoryFilter(e.target.value)}>
              <option value="">All</option>
              <option value="sales">sales</option>
              <option value="finance">finance</option>
              <option value="marketing">marketing</option>
              <option value="technical">technical</option>
              <option value="product">product</option>
              <option value="communication">communication</option>
              <option value="operations">operations</option>
            </select>
            <button
              type="button"
              class=${cn('tk-toggle', showAutoClosed && 'is-on')}
              onClick=${() => setShowAutoClosed((v) => !v)}
            >
              <span class="checkbox"></span>
              Show auto-closed
            </button>
            <div class="spacer"></div>
            <span class="label">${openCount} open · ${autoClosedCount} auto-closed</span>
          </div>

          <div class="tk-split">
            <div class="tk-list">
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
                    <p class="t">Failed to load tasks</p>
                    <p class="d">${error.message}</p>
                  </div>
                </div>
              `}
              ${data && data.length === 0 && !isLoading && html`
                <div class="tk-empty-box">No tasks match.</div>
              `}
              ${groups.map((g) => {
                const isCollapsed = collapsed.has(g.key);
                return html`
                  <div key=${g.key}>
                    <div
                      role="button"
                      tabIndex=${0}
                      aria-expanded=${!isCollapsed}
                      data-group=${g.key}
                      class=${cn(
                        'tk-group-head',
                        g.key === 'overdue' && 'is-overdue',
                        g.key === 'autoclosed' && 'is-autoclosed',
                        isCollapsed && 'is-collapsed',
                      )}
                      onClick=${() => toggleGroup(g.key)}
                      onKeyDown=${(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleGroup(g.key);
                        }
                      }}
                    >
                      <span class="tk-group-label">
                        <${Icon} name="chevron-down" size=${10} className="chev" />
                        ${g.label}
                      </span>
                      <span class="ct">${g.tasks.length}</span>
                    </div>
                    ${!isCollapsed &&
                    g.tasks.map((t) => html`
                      <${TaskRow}
                        key=${t.id}
                        task=${t}
                        selected=${selectedId === t.id}
                        onSelect=${setSelectedId}
                      />
                    `)}
                  </div>
                `;
              })}
            </div>

            <div class="tk-divider"></div>

            <div class="tk-detail">
              ${selectedId
                ? html`<${TaskDetailPane} taskId=${selectedId} density="full" onNavigateTask=${setSelectedId} />`
                : html`<div class="tk-empty">Select a task</div>`}
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}
