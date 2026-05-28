// Assignee roster — single source of truth for who a task can be owned by, used
// by both the create form (owner field) and the detail pane's Reassign picker.
//
// Two assignee kinds map onto the `tasks` columns: `assigned_to` (the id —
// an email for a human, an agent id like `cfo-agent` for an agent) and
// `assignee_type` ('human' | 'agent'). `assigneeIsAgent` in shared.js also
// treats a trailing `-agent` as the agent convention, so keep agent ids
// suffixed `-agent`.
//
// NOTE: the AGENT_ROSTER below is a curated PLACEHOLDER. The accompanying skill
// will gain a setup/init step that configures the real per-project agent roster;
// when that lands, this constant becomes the fallback/default and the configured
// list takes precedence. Until then these are sensible defaults that mirror the
// sidebar's "By domain" facets (Finance / Mail / Content / Outbound) plus core
// C-suite agents.

// The logged-in human. TODO(hello@royalti.io): thread from
// hostContext.royaltiAuth once it carries the user email (mirrors the same TODO
// in tasks-view.js — this module is now the one place that literal lives).
export const CURRENT_USER = 'hello@royalti.io';

/** @typedef {{ id: string, label: string }} AgentEntry */

/** @type {AgentEntry[]} */
export const AGENT_ROSTER = [
  { id: 'cfo-agent', label: 'CFO · Finance' },
  { id: 'cmo-agent', label: 'CMO · Marketing' },
  { id: 'coo-agent', label: 'COO · Operations' },
  { id: 'content-agent', label: 'Content' },
  { id: 'outbound-agent', label: 'Outbound' },
];

/** @typedef {{ value: string, label: string, type: 'human' | 'agent' }} AssigneeOption */

/**
 * Flat option list for an assignee <select>. "Me" first (human), then each
 * configured agent. The empty-value "Unassigned" sentinel is added by the
 * caller's <select> so this list stays purely the real assignees.
 * @returns {AssigneeOption[]}
 */
export function assigneeOptions() {
  return [
    { value: CURRENT_USER, label: 'Me', type: 'human' },
    ...AGENT_ROSTER.map((a) => ({ value: a.id, label: a.label, type: /** @type {'agent'} */ ('agent') })),
  ];
}

/**
 * Resolve a picked `assigned_to` value back to its `assignee_type`. Falls back
 * to the `-agent` naming convention for ids not in the roster (e.g. legacy rows
 * or a future configured agent not yet reflected here).
 * @param {string} value
 * @returns {'human' | 'agent'}
 */
export function assigneeTypeFor(value) {
  const match = assigneeOptions().find((o) => o.value === value);
  if (match) return match.type;
  return value.endsWith('-agent') ? 'agent' : 'human';
}
