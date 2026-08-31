import { MeetingActionItem, SqlExecutor } from '@ikenga/meetings-contract';
import crypto from 'node:crypto';

export interface TaskSyncResult {
  syncedCount: number;
  taskIds: string[];
}

/**
 * Syncs user-approved meeting action items into the production `tasks` table.
 * Enforces that sync is explicitly user-initiated (D10 / WP-08).
 */
export async function syncActionItemsToTasks(
  actionItems: MeetingActionItem[],
  executor: SqlExecutor
): Promise<TaskSyncResult> {
  const taskIds: string[] = [];

  for (const item of actionItems) {
    if (item.status === 'synced_to_tasks') {
      continue;
    }

    const taskId = item.task_id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    // Insert into tasks table
    await executor.exec(
      `INSERT INTO tasks (
        id, title, description, status, priority, assigned_to,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        item.title,
        `Extracted from meeting action item (Assignee: ${item.assignee ?? 'Unassigned'})`,
        'pending',
        'medium',
        item.assignee ?? null,
        now,
        now,
      ]
    );

    // Update meeting action item status
    await executor.exec(
      'UPDATE meeting_action_items SET status = ?, task_id = ? WHERE id = ?',
      ['synced_to_tasks', taskId, item.id]
    );

    taskIds.push(taskId);
  }

  return {
    syncedCount: taskIds.length,
    taskIds,
  };
}
