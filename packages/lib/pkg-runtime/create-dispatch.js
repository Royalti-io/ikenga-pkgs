// RECIPE-SHARED SHAPE (create-wire) — dispatch-mode creation for domain pkgs.
//
// Lift target: @ikenga/pkg-runtime. Every domain pkg's dead "+ / New <X>"
// buttons route through here so creation is *agent-shaped* — we seed a
// structured creation brief into the shell's active Chi session and let the
// agent do the create through its skill (research, cross-table links, enrich
// fields), instead of the pkg writing a raw client-side husk INSERT.
//
// This is the R4 / R-03 rule made concrete: domain pkgs never run transport or
// CRUD-for-agents directly. Creation of a row that needs enrichment or
// cross-table fan-out is dispatch. A narrow direct-write exception exists —
// see create-wire.md "Decision rule" — for a self-contained, fully
// user-supplied single-table row (the tasks CreateTaskForm case).
//
// SEAM (must exist — do not invent):
//   host.sendToActiveSession({ prompt, source? })
//     → shell handler:  shell/src/components/pkg/pkg-iframe-host.tsx:551
//     → bridge wrapper: lib/bridge.js  (hostSendToActiveSession)
//   Returns { ok, threadId?, reason? }. Refuses with reason:'no-active-session'
//   when no chat pane is focused.
//
// PRECONDITION (currently a shell/contract gap — see create-wire.md pitfall #1):
//   The verb is gated on the `engine:invoke` scope (pkg-iframe-host.tsx:562),
//   which the FE resolves from manifest `permissions.engine` containing
//   'invoke'. Neither the contract PermissionsSchema nor the Rust Permissions
//   struct carries an `engine` key today, so it is stripped and the gate
//   returns scope-denied. Wire it correctly anyway (this file); it lights up
//   the moment the shell adds the key. dispatchCreate swallows the refusal so
//   a blocked gate never throws into the view.

import { hostSendToActiveSession, isStandalone } from './bridge.js';

/**
 * Build a structured creation brief for the Chi.
 *
 * The SHAPE is constant across domains so every "New <X>" reads the same to the
 * agent: a one-line "Create a new <entity>." heading, an optional fielded
 * "Known so far:" block seeded from the click context, and an explicit
 * instruction that names the target table so the agent files it correctly.
 * Domains vary only the entity label, table name, seed fields, and instruction.
 *
 * @param {object} args
 * @param {string} args.entity       Human label, e.g. 'sales deal'.
 * @param {string} args.table        Target table, e.g. 'sales_deals'.
 * @param {Record<string, string|number|null|undefined>} [args.seed]
 *        Pre-filled context from the click (e.g. { stage: 'Proposal' }).
 *        Null/empty values are dropped.
 * @param {string} [args.instruction] What the agent should do before writing.
 *        Defaults to a generic "ask then insert into <table>".
 * @returns {string}
 */
export function buildCreateBrief({ entity, table, seed = {}, instruction }) {
  const lines = [`Create a new ${entity}.`];
  const entries = Object.entries(seed).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  if (entries.length) {
    lines.push('', 'Known so far:');
    for (const [k, v] of entries) lines.push(`- ${k}: ${v}`);
  }
  lines.push(
    '',
    instruction ??
      `Ask me for anything you still need, then add it to the ${table} table.`,
  );
  return lines.join('\n');
}

/**
 * Seed a creation brief into the shell's active Chi session.
 *
 * Fire-and-forget by contract: no-ops (returns false) in standalone preview
 * where there is no host, and never rethrows — a scope-denied / no-active-
 * session refusal is logged, not surfaced as an exception, so a dead gate can
 * never break the calling view. Returns true only when the dispatch call
 * resolved.
 *
 * @param {string} brief   Output of buildCreateBrief.
 * @param {string} source  Provenance tag — pass the pkg id (e.g.
 *                         'com.ikenga.sales') so the shell stamps the audit trail
 *                         with the right origin.
 * @returns {Promise<boolean>}
 */
export async function dispatchCreate(brief, source) {
  if (isStandalone()) return false;
  try {
    await hostSendToActiveSession(brief, source);
    return true;
  } catch (e) {
    console.warn('[create-dispatch] dispatch failed', e);
    return false;
  }
}
