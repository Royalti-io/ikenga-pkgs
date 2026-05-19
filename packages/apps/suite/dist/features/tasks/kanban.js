// Tasks kanban — three live columns over Supabase `tasks` table. The
// task_comments table is wired but not surfaced in v0.1; add a detail sheet
// when you need it.

import { html, useState, useEffect, useCallback } from '../../lib/ui.js';
import { getSupabase } from '../../lib/supabase.js';

const STATUSES = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'blocked', label: 'Blocked' },
];
const ALL_STATUSES = [...STATUSES.map((s) => s.id), 'done', 'cancelled'];

export function Kanban() {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState('');

  const refresh = useCallback(async () => {
    try {
      const sb = getSupabase();
      const { data, error: err } = await sb
        .from('tasks')
        .select('id, title, status, created_at')
        .in('status', STATUSES.map((s) => s.id))
        .order('created_at', { ascending: false });
      if (err) throw err;
      setTasks(data ?? []);
      setError(null);
    } catch (e) {
      setError(e.message ?? String(e));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onCreate = useCallback(async (e) => {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    setTitle('');
    try {
      const sb = getSupabase();
      const { error: err } = await sb.from('tasks').insert({ title: value, status: 'open' });
      if (err) throw err;
      refresh();
    } catch (e) {
      setError(e.message ?? String(e));
    }
  }, [title, refresh]);

  const onStatusChange = useCallback(async (id, status) => {
    try {
      const sb = getSupabase();
      const { error: err } = await sb.from('tasks').update({ status }).eq('id', id);
      if (err) throw err;
      refresh();
    } catch (e) {
      setError(e.message ?? String(e));
    }
  }, [refresh]);

  const grouped = STATUSES.map((col) => ({
    ...col,
    rows: tasks.filter((t) => t.status === col.id),
  }));

  return html`
    <div class="kanban">
      <form class="composer" onSubmit=${onCreate}>
        <input
          placeholder="New task title…"
          value=${title}
          onChange=${(e) => setTitle(e.target.value)}
          autoComplete="off"
        />
        <button type="submit">Add</button>
      </form>

      ${error && html`<div class="error">${error}</div>`}

      <div class="board">
        ${grouped.map((col) => html`
          <section class="column" key=${col.id}>
            <header><span>${col.label}</span><span class="count">${col.rows.length}</span></header>
            <div class="cards">
              ${col.rows.length === 0
                ? html`<div class="empty">—</div>`
                : col.rows.map((t) => html`
                    <article class="card" key=${t.id}>
                      <div class="title">${t.title}</div>
                      <select
                        value=${t.status}
                        onChange=${(e) => onStatusChange(t.id, e.target.value)}
                      >
                        ${ALL_STATUSES.map((s) => html`<option key=${s} value=${s}>${s.replace('_', ' ')}</option>`)}
                      </select>
                    </article>
                  `)}
            </div>
          </section>
        `)}
      </div>

      <style>${STYLES}</style>
    </div>
  `;
}

const STYLES = `
  .kanban { padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
  .composer { display: flex; gap: 0.5rem; }
  .composer input { flex: 1; padding: 0.5rem 0.75rem; border: 1px solid var(--suite-border); border-radius: 6px; background: transparent; color: inherit; font: inherit; }
  .composer button { padding: 0.5rem 1rem; border: 1px solid var(--suite-border); border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  .composer button:hover { background: var(--suite-hover); }
  .error { color: var(--suite-danger); font-size: 0.85rem; }
  .board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
  .column { border: 1px solid var(--suite-border); border-radius: 8px; min-height: 200px; display: flex; flex-direction: column; }
  .column header { padding: 0.625rem 0.875rem; font-size: 0.85rem; font-weight: 500; display: flex; justify-content: space-between; }
  .column .count { font-size: 0.7rem; opacity: 0.5; }
  .cards { padding: 0 0.5rem 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; flex: 1; }
  .card { padding: 0.625rem 0.75rem; border: 1px solid var(--suite-border); border-radius: 6px; background: transparent; }
  .card .title { font-weight: 500; }
  .card select { margin-top: 0.4rem; width: 100%; padding: 0.25rem; border: 1px solid var(--suite-border); border-radius: 4px; background: transparent; color: inherit; font: inherit; font-size: 0.8rem; }
  .empty { padding: 1.5rem 0; opacity: 0.5; font-size: 0.85rem; text-align: center; }
`;
