// Assignee roster — single source of truth for who a task can be owned by, used
// by both the create form (owner field) and the detail pane's Reassign picker.
//
// Two assignee kinds map onto the `tasks` columns: `assigned_to` (the id —
// an email for a human, an agent id like `cfo-agent` for an agent) and
// `assignee_type` ('human' | 'agent'). `assigneeIsAgent` in shared.js also
// treats a trailing `-agent` as the agent convention, so keep agent ids
// suffixed `-agent`.
//
// ## Roster resolution
//
// The roster is INJECTABLE via `hostContext.royaltiSuite.tasksRoster` at
// iframe-mount time. The shell delivers hostContext through the AppBridge
// `connectBridge` return value and the `onContextChange` callback (see
// bridge.js / app.js). The expected shape is:
//
//   hostContext.royaltiSuite.tasksRoster = {
//     humans: [{ value: string, label: string }],  // email → display name
//     agents: [{ id: string, label: string }],      // agent-id → display name
//   }
//
// When `tasksRoster` is present and well-formed (both arrays non-empty) the
// configured list takes full precedence over the static defaults below.
// When absent or malformed the static CURRENT_USER + AGENT_ROSTER fallback
// remains active — so the pkg works unchanged today and on every future
// install that hasn't run `skill-tasks setup` yet.
//
// ## Shell hook needed (WP-10 contract side)
//
// The shell must read `.atelier/skill-tasks/roster.json` from the current
// project dir (the directory passed as --project / CLAUDE_PROJECT_DIR) and
// inject it as `hostContext.royaltiSuite.tasksRoster` when building the
// hostContext object for this pkg's iframe (pkg-iframe-host.tsx). The JSON
// file shape mirrors the `tasksRoster` field above:
//   { "humans": [{"value":"...", "label":"..."}],
//     "agents": [{"id":"...",   "label":"..."}] }
// Written by `skill-tasks` `setup` (WP-06 setup lifecycle); the shell need
// only pass it through — it must not transform or cache it.

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
 * @typedef {{ value: string, label: string }} HumanEntry
 * @typedef {{ humans: HumanEntry[], agents: AgentEntry[] }} TasksRoster
 */

/**
 * Validate and return a configured roster from `hostContext.royaltiSuite.tasksRoster`,
 * or `null` if absent / malformed. A valid roster has both `humans` and `agents`
 * as non-empty arrays.
 *
 * @param {unknown} [hostContext]
 * @returns {TasksRoster | null}
 */
export function resolveRoster(hostContext) {
  const raw = /** @type {any} */ (hostContext)?.royaltiSuite?.tasksRoster;
  if (!raw) return null;
  const { humans, agents } = raw;
  if (
    !Array.isArray(humans) || humans.length === 0 ||
    !Array.isArray(agents) || agents.length === 0
  ) {
    return null;
  }
  // Basic per-entry shape validation — skip malformed entries rather than reject.
  const validHumans = humans.filter(
    (h) => h && typeof h.value === 'string' && typeof h.label === 'string',
  );
  const validAgents = agents.filter(
    (a) => a && typeof a.id === 'string' && typeof a.label === 'string',
  );
  if (validHumans.length === 0 || validAgents.length === 0) return null;
  return { humans: validHumans, agents: validAgents };
}

/**
 * Flat option list for an assignee <select>. "Me" first (human), then each
 * configured agent. The empty-value "Unassigned" sentinel is added by the
 * caller's <select> so this list stays purely the real assignees.
 *
 * Accepts an optional `hostContext` object. When it carries a valid
 * `royaltiSuite.tasksRoster`, the configured roster wins. Without it (or when
 * the roster is absent/malformed) the static CURRENT_USER + AGENT_ROSTER
 * defaults are used, so existing call sites calling the no-arg form remain
 * correct without modification.
 *
 * @param {unknown} [hostContext]
 * @returns {AssigneeOption[]}
 */
export function assigneeOptions(hostContext) {
  const roster = resolveRoster(hostContext);
  if (roster) {
    return [
      ...roster.humans.map((h) => ({ value: h.value, label: h.label, type: /** @type {'human'} */ ('human') })),
      ...roster.agents.map((a) => ({ value: a.id, label: a.label, type: /** @type {'agent'} */ ('agent') })),
    ];
  }
  // Static fallback — unchanged behaviour.
  return [
    { value: CURRENT_USER, label: 'Me', type: 'human' },
    ...AGENT_ROSTER.map((a) => ({ value: a.id, label: a.label, type: /** @type {'agent'} */ ('agent') })),
  ];
}

/**
 * Resolve a picked `assigned_to` value back to its `assignee_type`. Falls back
 * to the `-agent` naming convention for ids not in the roster (e.g. legacy rows
 * or a future configured agent not yet reflected here).
 *
 * Accepts an optional `hostContext`; threads it through to `assigneeOptions` so
 * the configured roster (when present) is consulted first.
 *
 * @param {string} value
 * @param {unknown} [hostContext]
 * @returns {'human' | 'agent'}
 */
export function assigneeTypeFor(value, hostContext) {
  const match = assigneeOptions(hostContext).find((o) => o.value === value);
  if (match) return match.type;
  return value.endsWith('-agent') ? 'agent' : 'human';
}
