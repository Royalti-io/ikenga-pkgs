// TanStack Query cache keys — ported from src/lib/query-keys.ts.

export const queryKeys = {
  tasks: {
    all: ['tasks'],
    /** @param {string} filter */
    list: (filter) => [...queryKeys.tasks.all, 'list', filter],
    /** @param {string} id */
    detail: (id) => [...queryKeys.tasks.all, 'detail', id],
    /** @param {string} parentId */
    subtasks: (parentId) => [...queryKeys.tasks.all, 'subtasks', parentId],
    triageCounts: () => [...queryKeys.tasks.all, 'triage-counts'],
  },
};
