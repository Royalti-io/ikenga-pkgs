// com.ikenga.studio · real Script row model
//
// Builds the Script view's beat rows from a HYDRATED project (the `Script`
// block on the storyboard.json doc + the cells read via `storyboard.read`) so
// real mode renders THAT project's beats instead of the __mocks__/script.ts
// fixture. This is the Script-side twin of composition-model's
// `buildTimelineModel` (which does the same schema→presentation bridge for the
// Composition timeline) — same source of truth (`storyboard-store.projectDoc`
// + `.cells`), no second fetch path.
//
// Cross-view identity (requirement 5): a `ScriptBeat` is keyed by `id`
// (== the beat label, e.g. 'hook'), NOT the cell uid. Clicking a row must
// select the matching CELL on Canvas, so we resolve each beat's cell uid via
// the `beat_id → uid` map off the hydrated cells. A beat with no materialised
// cell yet keeps `cellUid: null` (honest — nothing to select on Canvas).
//
// Presentation-only fields (beat accent) are NOT on the schema — same rule as
// composition-model. Accents reuse composition-model's exact BEAT_ACCENTS
// cycle in first-seen order, so a beat tints the SAME colour on the Script
// list, the Canvas grid and the Composition rail (contract §5).
//
// start_ms is derived as a contiguous running sum of durations — identical to
// buildTimelineModel — so a Script row and the Composition scrub land on the
// same window for the same beat (the cross-link contract).

import type { Cell, Script, ScriptBeat } from '../mcp-types';
import type { BeatAccent, TransitionKind } from '../__mocks__/composition';
import type { MockScriptBeat } from '../__mocks__/script';
import { BEAT_ACCENTS } from './composition-model';

/** One beat row the Script view renders. Real fields only — presentation
 *  extras (`accent`, `start_ms`) are derived, never invented data. */
export interface ScriptRowModel {
  /** Cell uid this beat projects to (for the Canvas/Composition cross-link).
   *  null when no cell has been materialised for this beat yet. */
  cellUid: string | null;
  /** ScriptBeat.id — the beat label shown in the accent chip (e.g. 'hook'). */
  beatId: string;
  accent: BeatAccent;
  /** Composition-absolute start, running sum of prior beat durations. */
  start_ms: number;
  duration_ms: number;
  vo?: string;
  on_screen_text?: string;
  action?: string;
  sfx: string[];
  transition?: TransitionKind;
}

const KNOWN_TRANSITIONS: TransitionKind[] = ['cut', 'fade', 'smash-cut', 'j-cut', 'l-cut'];

/** Only surface a transition chip for a recognised kind — an unknown/absent
 *  value carries no marker (mirrors composition-model's readTransition). */
function knownTransition(raw: string | undefined): TransitionKind | undefined {
  return raw && (KNOWN_TRANSITIONS as string[]).includes(raw) ? (raw as TransitionKind) : undefined;
}

/**
 * Build the real Script rows from the hydrated `Script` block + the project's
 * cells. Returns `[]` when there is no script / no beats (drives the empty
 * state). Beat order IS the read order — the schema carries no separate script
 * ordering.
 */
export function buildScriptModel(script: Script | null | undefined, cells: Cell[]): ScriptRowModel[] {
  if (!script || !Array.isArray(script.beats) || script.beats.length === 0) return [];

  // beat_id → cell uid (first cell wins; a beat maps to one storyboard cell).
  const cellByBeat = new Map<string, string>();
  for (const c of cells) {
    if (c.beat_id && !cellByBeat.has(c.beat_id)) cellByBeat.set(c.beat_id, c.uid);
  }

  const accentByBeat = new Map<string, BeatAccent>();
  let accentIdx = 0;
  let cursor = 0;

  return script.beats.map((beat: ScriptBeat) => {
    let accent = accentByBeat.get(beat.id);
    if (!accent) {
      accent = BEAT_ACCENTS[accentIdx % BEAT_ACCENTS.length];
      accentByBeat.set(beat.id, accent);
      accentIdx += 1;
    }
    const duration_ms = typeof beat.duration_ms === 'number' && beat.duration_ms > 0 ? beat.duration_ms : 0;
    const start_ms = cursor;
    cursor += duration_ms;
    const vo = beat.vo?.trim() ? beat.vo : undefined;
    const transition = knownTransition(beat.transition);
    return {
      cellUid: cellByBeat.get(beat.id) ?? null,
      beatId: beat.id,
      accent,
      start_ms,
      duration_ms,
      ...(vo ? { vo } : {}),
      ...(beat.on_screen_text ? { on_screen_text: beat.on_screen_text } : {}),
      ...(beat.action ? { action: beat.action } : {}),
      sfx: beat.sfx ?? [],
      ...(transition ? { transition } : {}),
    };
  });
}

/** Adapt the standalone/mock fixture into the same row shape so the view
 *  renders one code path for both. Mock beats already carry a cell uid + a
 *  precomputed start_ms; keep them verbatim. */
export function mockScriptRows(beats: MockScriptBeat[]): ScriptRowModel[] {
  return beats.map((b) => ({
    cellUid: b.uid,
    beatId: b.beat,
    accent: b.accent,
    start_ms: b.start_ms,
    duration_ms: b.duration_ms,
    ...(b.vo ? { vo: b.vo } : {}),
    ...(b.on_screen_text ? { on_screen_text: b.on_screen_text } : {}),
    ...(b.action ? { action: b.action } : {}),
    sfx: b.sfx,
    ...(b.transition ? { transition: b.transition } : {}),
  }));
}
