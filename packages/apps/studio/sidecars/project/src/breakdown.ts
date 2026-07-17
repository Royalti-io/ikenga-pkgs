/**
 * `breakdown.run` — the DETERMINISTIC subset of a script breakdown
 * (plans/studio/19, D-2 + D-8).
 *
 * There are two breakdowns, deliberately:
 *
 *   • The `studio-breakdown` SKILL (packages/skills/studio-breakdown) is prose
 *     executed by an LLM. Shot-type inference, camera calls, first-draft prompts,
 *     character/location/prop extraction — and, per D-8, MATCHING an existing
 *     board's cells to the script's paragraphs — are JUDGMENT. There is no
 *     algorithm to lift, and this sidecar has no LLM access (no SDK, no
 *     sampling, no `claude` subprocess).
 *   • This module is the MECHANICAL part only.
 *
 * TWO MODES, auto-selected by whether the project already has cells (D-8):
 *
 *   SCAFFOLD (board is empty) — parse `script.fountain`, mint one rung-0 cell
 *     per action paragraph with OTIO ids, and write the matching `[[sc1_sh1]]`
 *     shot tags back into the script.
 *
 *   RETAG (board has cells) — create NOTHING. Match action paragraphs to the
 *     cells that are already there and write only the `[[tag]]`s. This exists
 *     because `planShots` mints scene-scoped ids (`sc1_sh1, sc2_sh1, …` across
 *     the forge script's 6 scenes) that can never equal a real project's flat
 *     `c1-forge…c6-alive`, so the old `cells-exist` refusal fired FOREVER on
 *     any board a human or the skill had authored.
 *
 * WHERE THE JUDGMENT BOUNDARY SITS. Retag auto-matches ONLY when the reading is
 * forced: paragraph count === cell count and no authored tag contradicts that
 * order. Anything else (the real forge project: 8 paragraphs, 6 cells) returns
 * `outcome: 'ambiguous-needs-chi'` and hands the matching to Chi. D-1a killed
 * the positional fallback in the UI precisely because a disclosed guess is
 * still a wrong answer — it badged `c1-forge` onto a paragraph describing the
 * room. Do not reintroduce that guess here.
 *
 * NO INVENTED NUMBERS. Every count in the result is measured from something
 * this module actually read or wrote. `scenes` / `paragraphs` / `cell_count`
 * are `null` when the script was never parsed; `script_bytes` is `null` when
 * nothing was written. There is no placeholder value anywhere in this file.
 *
 * So every field that would require a guess is left at its honest default:
 * `shot_type: 'unset'`, `camera_move: 'unset'`, `prompt: ''`, `anchors: []`,
 * `duration_ms: 0`. Chi fills those in through the skill. We do NOT pre-fill
 * them with plausible-looking fiction.
 *
 * ZERO SPEND, BY CONSTRUCTION. This module imports no renderer and no queue; it
 * cannot reach `render.enqueue` or `anchor.generate`. `breakdown.run` is safe to
 * call without an approval gate, and must stay that way.
 *
 * NOT DESTRUCTIVE. Neither mode ever deletes or overwrites a cell, and retag
 * never overwrites an authored `[[tag]]` — a tag that disagrees with the order
 * match makes the whole call ambiguous instead.
 */

import { join } from 'node:path';

import { CellSchema, rungDir, type Cell, type Project } from '@ikenga/studio-schema';
import {
  parseFountain,
  writeShotTags,
  type FountainBlock,
  type FountainDoc,
} from '@ikenga/studio-schema/fountain';

import { createCell, readFountain, writeFountain } from './storyboard.js';
import { readProject } from './storyboard-fs.js';
import type { StoryboardResult } from './storyboard.js';

/**
 * What this call actually did. The UI branches on THIS, not on `ok` — every
 * partial and every hand-off has its own value, so a caller that switches on
 * `outcome` cannot accidentally render a success it didn't get.
 *
 *  • `scaffolded`          — board was empty; cells created and tags written.
 *  • `retagged`            — board had cells; nothing created, tags written.
 *  • `already-tagged`      — board had cells and every paragraph was already
 *                            tagged correctly. A true no-op; nothing written.
 *  • `ambiguous-needs-chi` — board had cells but the paragraph→cell mapping is
 *                            judgment. Nothing written. See `ambiguous`.
 *  • `script-write-failed` — cells may have been created (see `created`) but
 *                            script.fountain could not be written. See
 *                            `script_error`.
 *  • `planned`             — dry run. NOTHING happened. See `would_create` /
 *                            `would_tag`.
 */
export type BreakdownOutcome =
  | 'scaffolded'
  | 'retagged'
  | 'already-tagged'
  | 'ambiguous-needs-chi'
  | 'script-write-failed'
  | 'planned';

/** Why retag refused to auto-match. Each value is a fact about the script and
 *  the board, never a judgment about which reading is right. */
export type AmbiguityReason = 'count-mismatch' | 'tag-order-conflict' | 'unresolved-tag';

/** One planned shot: the mechanical projection of an action paragraph.
 *  SCAFFOLD MODE ONLY — retag plans nothing. */
interface PlannedShot {
  /** OTIO shot id `sc<N>_sh<M>` — doubles as the cell uid, so a re-run is idempotent. */
  uid: string;
  /** OTIO scene id `sc<N>`. */
  sceneId: string;
  /** Document-wide 0-based index over action paragraphs — the exact index
   *  `writeShotTags` wants, and the ordinal Canvas/Breakdown sort on. */
  paragraphIndex: number;
  action: string;
}

/** Every action paragraph, document-wide, in the exact order `writeShotTags`
 *  indexes on and Breakdown's rail flattens to. This is the ONE ordering the
 *  whole module counts in. */
function actionParagraphs(doc: FountainDoc): FountainBlock[] {
  return doc.scenes.flatMap((s) => s.blocks).filter((b) => b.kind === 'action');
}

/**
 * Project the parsed script onto shots. Scene numbering is 1-based over
 * `doc.scenes` in document order; shot numbering restarts per scene. Only
 * `action` blocks become shots — dialogue and transitions are script furniture,
 * not photography.
 *
 * `paragraphIndex` is counted document-wide across ALL scenes (not per scene),
 * because that is what `writeShotTags` indexes on and what Breakdown's
 * `actionParagraphs` flattens to.
 */
function planShots(doc: FountainDoc): PlannedShot[] {
  const shots: PlannedShot[] = [];
  let paragraphIndex = 0;

  doc.scenes.forEach((scene, sceneIdx) => {
    const sceneId = `sc${sceneIdx + 1}`;
    let shotNo = 0;
    for (const block of scene.blocks) {
      if (block.kind !== 'action') continue;
      shotNo += 1;
      shots.push({
        uid: `${sceneId}_sh${shotNo}`,
        sceneId,
        paragraphIndex: paragraphIndex++,
        action: block.text,
      });
    }
  });

  return shots;
}

/** Build the full Cell record for a planned shot. Every judgment field stays at
 *  its schema default — see the module header. */
function toCellInput(shot: PlannedShot, now: string): unknown {
  return {
    uid: shot.uid,
    // OTIO scene id: cells from the same scene share a beat, which is what the
    // beat rail (real-mcp `deriveBeats`) groups on.
    beat_id: shot.sceneId,
    rung: '0_beat_sheet',
    // Document-wide ordinal — Breakdown/Canvas sort shots on `index` globally,
    // and archetypes.ts already writes a global running index.
    index: shot.paragraphIndex,
    // Breakdown reads `cell.label || cell.beat_id || cell.uid` for the shot id.
    label: shot.uid,
    time: { start: 0, end: 0 },
    frames: { start: 0, end: 0 },
    // The action paragraph, verbatim. This is the one field that carries real
    // information out of the script.
    action: shot.action,
    // Left unset ON PURPOSE — inference is the skill's job (D-2).
    shot_type: 'unset',
    camera_move: 'unset',
    prompt: '',
    anchors: [],
    duration_ms: 0,
    content_path: join('cells', rungDir('0_beat_sheet'), shot.uid, 'content.html'),
    rungs: {
      '0_beat_sheet': { status: 'pending' },
      '1_lofi': { status: 'pending' },
      '2_hifi': { status: 'pending' },
    },
    last_edited: now,
  };
}

/** The key Breakdown's rail joins a `[[tag]]` on for a given cell, mirroring
 *  `Breakdown.tsx`'s `shotId: cell.label || cell.beat_id || cell.uid`. */
function shotIdOf(cell: Cell): string {
  return cell.label || cell.beat_id || cell.uid;
}

/** Resolve an authored `[[tag]]` to a cell the same way the rail does: uid
 *  first (Breakdown inserts uid last into its lookup, so uid wins a collision),
 *  then shotId. Returns undefined for a tag naming nothing on this board. */
function resolveTag(tag: string, cells: Cell[]): Cell | undefined {
  return cells.find((c) => c.uid === tag) ?? cells.find((c) => shotIdOf(c) === tag);
}

/** Existing cells in the one order the board is read in: `index` ascending,
 *  ties broken by document position (stable). This is the order retag matches
 *  paragraphs against, and it is the same ordinal Canvas/Breakdown sort on. */
function cellsInBoardOrder(cells: Cell[]): Cell[] {
  return cells
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.index - b.c.index || a.i - b.i)
    .map((x) => x.c);
}

export interface BreakdownRunOptions {
  /** Plan only: report what WOULD be created + tagged, touch nothing on disk. */
  dryRun?: boolean;
}

/** A shot as it crosses the wire. */
export interface BreakdownShotWire {
  uid: string;
  beat_id: string;
  action: string;
}

/**
 * The `ok:true` result of `breakdown.run`, in full. `outcome` is the
 * discriminant — switch on it. Every count here is measured from something this
 * module read or wrote; there are no placeholders and no estimates.
 *
 * Declared as a `type`, not an `interface`, on purpose: `StoryboardResult.result`
 * is a `Record<string, unknown>`, and only a type alias carries the implicit
 * index signature that makes it assignable there. An interface would force every
 * return site back to an untyped literal, which is exactly the checking this
 * shape exists to get.
 */
export type BreakdownRunResult = {
  ok: true;
  outcome: BreakdownOutcome;
  mode: 'scaffold' | 'retag';
  dry_run: boolean;
  /** Distinct scenes the parser found in script.fountain. */
  scenes: number;
  /** Action paragraphs the parser found in script.fountain. */
  paragraphs: number;
  /** Cells on the board when the call started. */
  cell_count: number;
  /** The shots the script projects to. SCAFFOLD MODE ONLY — `[]` in retag,
   *  which plans nothing because it creates nothing. */
  planned: BreakdownShotWire[];
  /** uids of cells created this call. Always `[]` in retag mode and on a dry run. */
  created: string[];
  /** The newly created Cell records. Scaffold mode only, absent on a dry run. */
  cells?: Cell[];
  /** Existing cells left untouched. In retag mode that is every cell. */
  skipped: string[];
  /** Dry run only — uids that WOULD be created. */
  would_create?: string[];
  /** Dry run only — uids whose tag WOULD be written. */
  would_tag?: string[];
  /** uids whose `[[tag]]` THIS call wrote into script.fountain. */
  tagged: string[];
  /** uids whose paragraph already carried the right tag — left untouched. */
  already_tagged: string[];
  /** Did script.fountain actually get written this call? */
  script_written: boolean;
  /** Byte size of script.fountain after the write, or `null` when nothing was
   *  written. Never a placeholder — do not render a number when this is null. */
  script_bytes: number | null;
  /** Present iff `outcome === 'script-write-failed'`. */
  script_error?: string;
  /** Present iff `outcome === 'ambiguous-needs-chi'` — the facts that made the
   *  paragraph→cell mapping a judgment call, for the UI to state plainly. */
  ambiguous?: {
    paragraphs: number;
    cells: number;
    reason: AmbiguityReason;
    detail: string;
  };
};

/**
 * Scaffold or retag a board from `<root>/script.fountain`. See the module
 * header for the mode split (D-8) and the judgment boundary.
 *
 * Spends nothing. Deletes nothing. Overwrites no cell and no authored tag.
 */
export function run(projectRoot: string, opts: BreakdownRunOptions = {}): StoryboardResult {
  const fountain = readFountain(projectRoot).result as { exists: boolean; text: string };
  if (!fountain.exists || fountain.text.trim() === '') {
    return {
      result: {
        ok: false,
        error: 'no-script',
        message: 'project has no script.fountain on disk (or it is empty); nothing to break down',
      },
    };
  }

  const doc = parseFountain(fountain.text);
  const paragraphs = actionParagraphs(doc);
  if (paragraphs.length === 0) {
    return {
      result: {
        ok: false,
        error: 'no-action-paragraphs',
        message: 'script.fountain parsed with zero action paragraphs; nothing to scaffold',
      },
    };
  }

  const project = readProject(projectRoot);
  // THE MODE SWITCH (D-8). A board with cells is never scaffolded onto — we
  // only ever add tags to it.
  return project.cells.length === 0
    ? scaffold(projectRoot, fountain.text, doc, project, opts)
    : retag(projectRoot, fountain.text, doc, project.cells, opts);
}

// ─── scaffold mode: empty board ───────────────────────────────────────────

function scaffold(
  projectRoot: string,
  rawScript: string,
  doc: FountainDoc,
  project: Project,
  opts: BreakdownRunOptions,
): StoryboardResult {
  const shots = planShots(doc);
  const base = {
    ok: true as const,
    mode: 'scaffold' as const,
    scenes: doc.scenes.length,
    paragraphs: shots.length,
    cell_count: 0,
    planned: shots.map((s) => ({ uid: s.uid, beat_id: s.sceneId, action: s.action })),
    skipped: [] as string[],
    already_tagged: [] as string[],
  };

  if (opts.dryRun) {
    const result: BreakdownRunResult = {
      ...base,
      outcome: 'planned',
      dry_run: true,
      created: [],
      would_create: shots.map((s) => s.uid),
      would_tag: shots.map((s) => s.uid),
      tagged: [],
      script_written: false,
      script_bytes: null,
    };
    return { result };
  }

  const now = new Date().toISOString();
  const created: Cell[] = [];
  let latest = project;
  for (const shot of shots) {
    const parsed = CellSchema.safeParse(toCellInput(shot, now));
    if (!parsed.success) {
      // A validation failure here is a bug in toCellInput, not user input —
      // surface it verbatim rather than half-scaffolding in silence.
      return {
        result: {
          ok: false,
          error: 'invalid-args',
          message: `cell ${shot.uid} failed CellSchema: ${parsed.error.message}`,
          created: created.map((c) => c.uid),
        },
        project: latest,
      };
    }
    const r = createCell(projectRoot, parsed.data);
    if (r.result.ok !== true) {
      return {
        result: { ...r.result, created: created.map((c) => c.uid) },
        project: latest,
      };
    }
    created.push(parsed.data);
    if (r.project) latest = r.project;
  }

  const write = applyTags(
    projectRoot,
    rawScript,
    shots.map((s) => ({ paragraphIndex: s.paragraphIndex, tag: s.uid })),
  );

  if (!write.ok) {
    // Cells landed; the script didn't. Say BOTH — the board really did change,
    // so `created` is real, but nothing was tagged and there is no byte count.
    const result: BreakdownRunResult = {
      ...base,
      outcome: 'script-write-failed',
      dry_run: false,
      created: created.map((c) => c.uid),
      cells: created,
      tagged: [],
      script_written: false,
      script_bytes: null,
      script_error: write.error,
    };
    return { result, project: latest };
  }

  const result: BreakdownRunResult = {
    ...base,
    outcome: 'scaffolded',
    dry_run: false,
    created: created.map((c) => c.uid),
    cells: created,
    tagged: shots.map((s) => s.uid),
    script_written: write.written,
    script_bytes: write.bytes,
  };
  return { result, project: latest };
}

// ─── retag mode: the board already exists (D-8) ───────────────────────────

function retag(
  projectRoot: string,
  rawScript: string,
  doc: FountainDoc,
  cells: Cell[],
  opts: BreakdownRunOptions,
): StoryboardResult {
  const paragraphs = actionParagraphs(doc);
  const ordered = cellsInBoardOrder(cells);
  const base = {
    ok: true as const,
    mode: 'retag' as const,
    scenes: doc.scenes.length,
    paragraphs: paragraphs.length,
    cell_count: ordered.length,
    // Retag plans nothing and creates nothing; every existing cell is skipped.
    planned: [] as BreakdownShotWire[],
    created: [] as string[],
    skipped: ordered.map((c) => c.uid),
  };

  const bail = (reason: AmbiguityReason, detail: string): StoryboardResult => {
    const result: BreakdownRunResult = {
      ...base,
      outcome: 'ambiguous-needs-chi',
      dry_run: Boolean(opts.dryRun),
      tagged: [],
      already_tagged: [],
      script_written: false,
      script_bytes: null,
      ambiguous: { paragraphs: paragraphs.length, cells: ordered.length, reason, detail },
    };
    return { result };
  };

  // ── the only unambiguous reading: one paragraph per cell, in order ──
  if (paragraphs.length !== ordered.length) {
    return bail(
      'count-mismatch',
      `the script has ${paragraphs.length} action paragraph(s) and the board has ` +
        `${ordered.length} shot(s). Which paragraph belongs to which shot is a judgment ` +
        'call — breakdown.run will not guess it. Ask your Chi to match them (the ' +
        'studio-breakdown skill), or even up the counts.',
    );
  }

  const toWrite: Array<{ paragraphIndex: number; tag: string }> = [];
  const alreadyTagged: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const target = ordered[i];
    const existing = paragraphs[i]?.tag;
    if (target === undefined) continue;

    if (existing !== undefined) {
      // An authored tag is the author's judgment. We never overwrite it — if it
      // disagrees with the order match, the order match is not the only reading,
      // so the whole call is ambiguous.
      const resolved = resolveTag(existing, ordered);
      if (!resolved) {
        return bail(
          'unresolved-tag',
          `action paragraph ${i + 1} is tagged [[${existing}]], which names no shot on this ` +
            'board. Someone tagged it deliberately against something else; overwriting that ' +
            'in-place would be a guess. Ask your Chi to reconcile it.',
        );
      }
      if (resolved.uid !== target.uid) {
        return bail(
          'tag-order-conflict',
          `action paragraph ${i + 1} is tagged [[${existing}]] (shot ${resolved.uid}), but in ` +
            `board order that paragraph lines up with shot ${target.uid}. The existing tags and ` +
            'the paragraph order disagree, so neither is the obvious reading. Ask your Chi.',
        );
      }
      alreadyTagged.push(target.uid);
      continue;
    }
    toWrite.push({ paragraphIndex: i, tag: target.uid });
  }

  if (opts.dryRun) {
    const result: BreakdownRunResult = {
      ...base,
      outcome: 'planned',
      dry_run: true,
      would_create: [],
      would_tag: toWrite.map((t) => t.tag),
      tagged: [],
      already_tagged: alreadyTagged,
      script_written: false,
      script_bytes: null,
    };
    return { result };
  }

  if (toWrite.length === 0) {
    // Every paragraph already carries the right tag. Nothing to do, and we say
    // exactly that rather than reporting a write we didn't perform.
    const result: BreakdownRunResult = {
      ...base,
      outcome: 'already-tagged',
      dry_run: false,
      tagged: [],
      already_tagged: alreadyTagged,
      script_written: false,
      script_bytes: null,
    };
    return { result };
  }

  const write = applyTags(projectRoot, rawScript, toWrite);
  if (!write.ok) {
    const result: BreakdownRunResult = {
      ...base,
      outcome: 'script-write-failed',
      dry_run: false,
      tagged: [],
      already_tagged: alreadyTagged,
      script_written: false,
      script_bytes: null,
      script_error: write.error,
    };
    return { result };
  }

  const result: BreakdownRunResult = {
    ...base,
    outcome: 'retagged',
    dry_run: false,
    tagged: toWrite.map((t) => t.tag),
    already_tagged: alreadyTagged,
    script_written: write.written,
    script_bytes: write.bytes,
  };
  return { result };
}

// ─── tag write ────────────────────────────────────────────────────────────

type TagWrite =
  | { ok: true; written: boolean; bytes: number | null }
  | { ok: false; error: string };

/**
 * Read → mutate → wholesale overwrite; there is no patch API for a Fountain
 * source. `writeShotTags` is idempotent and leaves paragraphs it wasn't given
 * byte-for-byte alone, so this never churns the file.
 *
 * When the tagged text is identical to what's on disk we skip the write and
 * report `written:false, bytes:null` — we will not report a byte count for a
 * write that didn't happen.
 */
function applyTags(
  projectRoot: string,
  rawScript: string,
  tags: Array<{ paragraphIndex: number; tag: string }>,
): TagWrite {
  const tagged = writeShotTags(rawScript, tags);
  if (tagged === rawScript) return { ok: true, written: false, bytes: null };

  const w = writeFountain(projectRoot, tagged).result as {
    ok: boolean;
    bytes?: number;
    message?: string;
  };
  if (w.ok !== true) {
    return { ok: false, error: w.message ?? 'writeFountain rejected the tagged script' };
  }
  return { ok: true, written: true, bytes: w.bytes ?? null };
}
