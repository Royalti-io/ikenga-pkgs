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
    /** @param {string} id task whose downstream dependents (the "Blocks" lane) we want */
    dependents: (id) => [...queryKeys.tasks.all, 'dependents', id],
    triageCounts: () => [...queryKeys.tasks.all, 'triage-counts'],
  },
};
