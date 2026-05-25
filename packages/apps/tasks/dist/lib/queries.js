// Query layer — ported from src/lib/queries/tasks.ts. JSDoc carries the TS
// types. Schema verified (commit 0) against royalti-pa migrations 003/004:
// every selected column exists on the real `tasks` table — TASKS_LIST_COLUMNS
// is NOT narrowed.

import { getSupabase } from './supabase.js';
import { queryKeys } from './query-keys.js';

/** @typedef {'pending'|'in_progress'|'completed'|'cancelled'|'blocked'} TaskStatus */
/** @typedef {'critical'|'high'|'medium'|'low'} TaskPriority */
/** @typedef {'human'|'agent'} AssigneeType */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {string|null} description
 * @property {TaskStatus} status
 * @property {TaskPriority} priority
 * @property {string|null} assigned_to
 * @property {AssigneeType|null} assignee_type
 * @property {string|null} category
 * @property {string[]|null} tags
 * @property {string|null} due_date
 * @property {string|null} completed_at
 * @property {string} created_at
 * @property {string} updated_at
 * @property {number|null} progress_pct
 * @property {string|null} outcome_notes
 * @property {string|null} parent_task_id
 * @property {string|null} blocked_by_task_id
 * @property {string|null} source_email_id
 * @property {string|null} agent_source
 * @property {string|null} initiative_id
 * @property {string|null} risk_id
 * @property {string|null} effort_estimate
 * @property {'autonomous'|'report'|'approval_required'|null} execution_mode
 * @property {string|null} task_result
 * @property {string|null} claude_session_id
 * @property {string|null} working_dir
 */

export const TASKS_LIST_COLUMNS =
  'id, title, description, status, priority, assigned_to, assignee_type, category, due_date, created_at, updated_at, progress_pct, outcome_notes, execution_mode';

/** @type {readonly TaskStatus[]} */
const ACTIVE_STATUSES = ['pending', 'in_progress', 'blocked'];
const STALE_DAYS = 7;

/**
 * @typedef {Object} TriageCounts
 * @property {number} overdue
 * @property {number} stale
 * @property {number} unassigned
 * @property {number} blocked
 * @property {number} needsAttention Deduplicated overdue-OR-unassigned badge total.
 */

/**
 * Server-side health counts for the Triage badge (R16-followup: server-side,
 * so the badge is correct independent of the list's filter + 200-row cap).
 * Four `head:true` count() selects, run in parallel (+ the deduped total).
 */
export function triageCountsQuery() {
  return {
    queryKey: queryKeys.tasks.triageCounts(),
    /** @returns {Promise<TriageCounts>} */
    queryFn: async () => {
      const sb = getSupabase();
      // "Overdue" = due before the start of today, matching the app's own
      // convention (groupTasks / dueLabel treat a task due *today* as "Today",
      // not overdue, until the day rolls over).
      const startOfTodayIso = (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
      })();
      const staleIso = new Date(
        Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const head = () => sb.from('tasks').select('*', { count: 'exact', head: true });

      const [overdue, stale, unassigned, blocked, needsAttention] = await Promise.all([
        head().in('status', ACTIVE_STATUSES).lt('due_date', startOfTodayIso),
        head().in('status', ACTIVE_STATUSES).lt('updated_at', staleIso),
        head().in('status', ACTIVE_STATUSES).is('assigned_to', null),
        head().eq('status', 'blocked'),
        // overdue OR unassigned, counted once (the deduplicated badge total).
        head()
          .in('status', ACTIVE_STATUSES)
          .or(`due_date.lt.${startOfTodayIso},assigned_to.is.null`),
      ]);

      for (const r of [overdue, stale, unassigned, blocked, needsAttention]) {
        if (r.error) throw r.error;
      }
      return {
        overdue: overdue.count ?? 0,
        stale: stale.count ?? 0,
        unassigned: unassigned.count ?? 0,
        blocked: blocked.count ?? 0,
        needsAttention: needsAttention.count ?? 0,
      };
    },
  };
}

/** @param {string} id */
export function taskDetailQuery(id) {
  return {
    queryKey: queryKeys.tasks.detail(id),
    /** @returns {Promise<Task|null>} */
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('tasks')
        .select('*')
        .eq('id', id)
        .single();
      if (error) {
        if (error.code === 'PGRST116') return null; // not found
        throw error;
      }
      return /** @type {Task} */ (data);
    },
  };
}

/** @param {string} parentId */
export function subtasksQuery(parentId) {
  return {
    queryKey: queryKeys.tasks.subtasks(parentId),
    /** @returns {Promise<Task[]>} */
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('tasks')
        .select('*')
        .eq('parent_task_id', parentId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return /** @type {Task[]} */ (data ?? []);
    },
  };
}

/** @param {string|null} blockingId */
export function blockingTaskQuery(blockingId) {
  return {
    queryKey: queryKeys.tasks.detail(blockingId ?? 'none'),
    /** @returns {Promise<Task|null>} */
    queryFn: async () => {
      if (!blockingId) return null;
      const { data, error } = await getSupabase()
        .from('tasks')
        .select('*')
        .eq('id', blockingId)
        .single();
      if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
      }
      return /** @type {Task} */ (data);
    },
    enabled: !!blockingId,
  };
}
