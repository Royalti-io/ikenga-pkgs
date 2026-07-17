/**
 * `breakdown.*` tools — the DETERMINISTIC half of a script breakdown
 * (plans/studio/19, D-2 + D-8).
 *
 * This is deliberately NOT the `studio-breakdown` skill. The skill is prose an
 * LLM executes: it infers shot types and camera moves, drafts prompts, extracts
 * characters/locations/props into anchors, and — per D-8 — matches an existing
 * board's shots to the script's paragraphs. All judgment. This MCP server has
 * no LLM access, so `breakdown.run` does only the mechanical subset and leaves
 * every judgment call to Chi. The two compose: `run` scaffolds or tags the
 * board, Chi enriches it and resolves anything ambiguous.
 *
 * Zero spend: the sidecar handler imports no renderer and no queue.
 */

import { SidecarClient } from '../sidecar-client.js';
import { callSidecar } from './project.js';
import type { ToolDef } from './types.js';

export function breakdownTools(sidecar: SidecarClient): ToolDef[] {
  return [
    {
      name: 'breakdown.run',
      description:
        "Deterministically link the project's script.fountain to its storyboard. TWO MODES, chosen automatically by whether the board already has cells. (1) SCAFFOLD (board empty): mint one rung-0 cell per action paragraph with OTIO ids (scene sc<N>, shot sc<N>_sh<M>, used as the cell uid + label) and write the matching [[sc<N>_sh<M>]] tags back into script.fountain. (2) RETAG (board has cells): create NOTHING — match action paragraphs to the cells already there and write only the [[tag]]s, using each cell's uid as the tag. Retag auto-matches ONLY when the reading is forced (one paragraph per cell, in order, with no authored tag contradicting it); otherwise it returns outcome 'ambiguous-needs-chi' with the real counts and refuses to guess, because matching paragraphs to shots is judgment and belongs to the `studio-breakdown` skill (an LLM), not this server. MECHANICAL ONLY — shot_type/camera_move are left 'unset', prompt is '', anchors is [] and duration_ms is 0. Spends NOTHING: never enqueues a render or generates an anchor, so it needs no approval. NON-DESTRUCTIVE: never deletes or overwrites a cell, and never overwrites an authored [[tag]]. Branch on `outcome`: 'scaffolded' | 'retagged' | 'already-tagged' | 'ambiguous-needs-chi' | 'script-write-failed' | 'planned' (dry run). Returns { ok, outcome, mode, dry_run, scenes, paragraphs, cell_count, planned[], created[], cells[], skipped[], tagged[], already_tagged[], script_written, script_bytes, script_error?, ambiguous? }. `tagged` is the list of uids actually written, not an estimate; `script_bytes` is null when nothing was written — do not report a byte count in that case.",
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          dry_run: {
            type: 'boolean',
            description:
              "Plan only — report what WOULD be created and tagged, write nothing to disk. Returns the same shape with outcome:'planned', dry_run:true, created:[], and the would_create[] / would_tag[] projections.",
          },
        },
        required: ['projectId'],
        additionalProperties: false,
      },
      handler: (args) =>
        callSidecar(sidecar, 'breakdown.run', {
          projectId: args.projectId,
          dry_run: args.dry_run,
        }),
    },
  ];
}
