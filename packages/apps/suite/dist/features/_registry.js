// Central feature registry. Each feature exports a default object:
//   { id, label, icon, route, Component }
// To fork: delete a feature dir + remove its import here, or just toggle it
// off in Settings. The Component is what mounts when the user picks the
// feature from the sidebar.

import tasks from '../features/tasks/index.js';
import sales from '../features/sales/index.js';
import outbound from '../features/outbound/index.js';
import email from '../features/email/index.js';

export const FEATURES = [tasks, sales, outbound, email];

export function findFeature(id) {
  return FEATURES.find((f) => f.id === id) ?? null;
}
