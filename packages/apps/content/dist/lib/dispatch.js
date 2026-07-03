// Recipe-shared shape — atelier-parity RECIPE 1 · dispatch-wire.
//
// Lift-ready for a future @ikenga/pkg-runtime extraction: this module is the
// ONE place a domain pkg (content / research / strategy / sales) turns an
// operator "Approve & run" / "Confirm & run" click into a real host dispatch.
// It depends ONLY on hostSendToActiveSession + isStandalone from ./bridge.js
// (both present in every domain pkg's bridge copy), so it copies verbatim.
//
// SEAM RATIONALE (why sendToActiveSession, not a direct run):
//   The shell's iframe host dispatcher (shell/src/components/pkg/
//   pkg-iframe-host.tsx `dispatchHostCall`) supports exactly these host verbs:
//     host.sendToActiveSession   (line 551)  ← the ONLY agent-run seam
//     host.navigate, host.pkg.setMenu, host.dbQuery, host.dbExec,
//     host.openSessionDialog, host.agentOps.*, host.fetch, host.invoke
//   There is NO direct-run verb. `host.paActionsRun` and `host.paActions.*`
//   both fall through to `return errResult('unknown host tool: ${name}')`
//   (pkg-iframe-host.tsx:830) — do NOT wire to them. So BOTH ux_modes seed a
//   structured user turn into the active Claude session; the agent performs
//   the run through its own privileged path (same pattern the Tasks pkg uses to
//   "create" work — see bridge.js hostSendToActiveSession docstring).
//
// APPROVE-RUN GAP (feeds WP-18 / the contract work):
//   'approve' cannot honestly run-without-a-turn today — there is no host verb
//   that commits an action headlessly for a domain row. What 'approve' CAN do
//   is frame the seeded turn as "operator has authority, run it now" so the
//   agent proceeds without a back-and-forth. A true headless approve-run needs
//   a new shell verb (e.g. host.paActions.commit actually wired in
//   dispatchHostCall, or a domain-run verb). Until then approve == a
//   differently-framed sendToActiveSession.

import { hostSendToActiveSession, isStandalone } from './bridge.js';

// Frame the seeded turn per ux_mode.
//   approve → operator has authority, wants it done now (agent proceeds).
//   confirm → operator wants the agent to confirm/plan before running.
const MODE_FRAME = {
  approve: (label) => `Approve and run the next action for ${label}.`,
  confirm: (label) => `Confirm the next action for ${label} with me before running it.`,
};

/**
 * Build the structured user-turn prompt for an item's next action.
 *
 * `item` is the recipe-shared descriptor — each domain pkg maps its own row
 * into this shape (see pieceToDispatchItem in content-view.js for the pattern):
 *   {
 *     kind:       string   human label for the entity ('content piece', 'deal', ...)
 *     title:      string   the entity title
 *     stage?:     string   current pipeline stage (already display-labelled)
 *     nextAction?:string   the next_action text shown in the UI
 *     facts?:     [k, v][] extra context lines ([['Channel','x'], ...]); nullish v skipped
 *   }
 *
 * Pure + side-effect-free so it is unit-testable without a bridge.
 */
export function buildActionPrompt(item, mode) {
  const kind = item.kind ?? 'item';
  const label = item.title ? `the ${kind} "${item.title}"` : `this ${kind}`;
  const frame = (MODE_FRAME[mode] ?? MODE_FRAME.confirm)(label);
  const lines = [frame, ''];
  if (item.stage) lines.push(`Stage: ${item.stage}`);
  if (item.nextAction) lines.push(`Next action: ${item.nextAction}`);
  for (const [k, v] of item.facts ?? []) {
    if (v != null && v !== '') lines.push(`${k}: ${v}`);
  }
  return lines.join('\n');
}

/**
 * Dispatch an item's next action to the shell's active Claude session.
 *
 * Fire-and-forget seam: seeds a user turn via host.sendToActiveSession. Callers
 * should still `.catch(() => {})` at the click site so a closed/failed bridge
 * never throws into the handler (mirrors outbound-view.js `sendToChat`).
 * No-ops in standalone (no parent shell). Returns the prompt that was sent (or
 * null when standalone) so callers/tests can assert on it.
 *
 *   item:   descriptor (see buildActionPrompt)
 *   mode:   'approve' | 'confirm'  (anything else → confirm framing)
 *   source: string  provenance tag — pass the pkg id (e.g. 'com.ikenga.content')
 */
export async function dispatchItemAction(item, mode, source) {
  if (isStandalone()) return null;
  const prompt = buildActionPrompt(item, mode);
  await hostSendToActiveSession(prompt, source);
  return prompt;
}
