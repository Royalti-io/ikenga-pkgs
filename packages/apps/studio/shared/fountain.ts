// com.ikenga.studio · Fountain parser (shared)
//
// ONE parser, two consumers: the iframe UI (`src/studio/lib/fountain.ts` is a
// thin re-export shim) and the project sidecar (`breakdown.run`), which reaches
// it through `@ikenga/studio-schema/fountain`. Per plans/studio/19 D-6 — the
// sidecar needs the same segmentation the pane shows, so there is no drift
// between "what Breakdown draws" and "what breakdown.run scaffolds".
//
// Still deliberately lightweight: no PDF export, no lock-step with Final Draft.
// It recognizes the title page, scene headings (INT./EXT./INT.-EXT./I/E.),
// transitions (ALL CAPS lines ending "TO:"), character cues followed by
// dialogue, Fountain notes `[[sc1_sh1]]` used as shot tags, and falls back to
// action for everything else.
//
// The load-bearing difference from the pre-19 parser: it classifies CHUNKS
// (blank-line-delimited paragraphs), not physical lines. Real scripts are
// hard-wrapped at ~72 chars; the old line-based parse turned an 8-paragraph
// script into 26 action blocks and emptied Breakdown's rail.

export type FountainBlockKind = 'action' | 'dialogue' | 'transition';

export interface FountainBlock {
  kind: FountainBlockKind;
  /** Only present on `dialogue` blocks — the character cue line above it. */
  character?: string;
  /** Paragraph text. Wrapped source lines are joined with a single space, and
   *  any `[[note]]` has been stripped out (see `tag`). */
  text: string;
  /** Shot tag lifted from a Fountain note `[[sc1_sh1]]` on an action chunk.
   *  This is the exact script-line ↔ shot link; absent means "untagged". */
  tag?: string;
}

export interface FountainScene {
  id: string;
  /** The raw scene heading line, e.g. "INT. STUDIO LOFT - DAY". */
  heading: string;
  blocks: FountainBlock[];
}

export interface FountainDoc {
  /** Parsed `Key: Value` title page, or null when the script has none. Keys are
   *  verbatim from the source (`Title`, `Credit`, `Draft date`, `Notes`, …). */
  titlePage: Record<string, string> | null;
  scenes: FountainScene[];
}

const SCENE_RE = /^(INT|EXT|INT\.\/EXT|I\/E)[.\s]/i;
const TRANSITION_RE = /^[A-Z0-9 .'-]{2,30}TO:$/;
// A character cue is a short, all-caps, non-scene, non-transition line with
// at least one letter (so plain punctuation/numbers don't qualify).
const CHARACTER_RE = /^[A-Z0-9 .'()-]{1,40}$/;
const PAGE_BREAK_RE = /^={3,}$/;
const TITLE_KEY_RE = /^([A-Za-z][A-Za-z0-9 _'-]*):[ \t]*(.*)$/;
/** Fountain note syntax. Used here strictly as a shot tag on action chunks. */
const NOTE_RE = /\[\[([^\]]*)\]\]/g;

function isCharacterCue(line: string): boolean {
  return (
    CHARACTER_RE.test(line) &&
    line === line.toUpperCase() &&
    /[A-Z]/.test(line) &&
    !SCENE_RE.test(line) &&
    !TRANSITION_RE.test(line)
  );
}

// ─── chunking ───────────────────────────────────────────────────────────────

/** A blank-line-delimited paragraph. `idxs` are absolute indices back into the
 *  raw line array so `writeShotTags` can rewrite the exact source lines. */
interface Chunk {
  lines: string[];
  idxs: number[];
}

type ChunkKind = 'scene' | 'transition' | 'dialogue' | 'orphan-cue' | 'action';

function scanChunks(rawLines: string[], bodyStart: number): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Chunk | null = null;
  for (let i = bodyStart; i < rawLines.length; i++) {
    const line = (rawLines[i] ?? '').trim();
    // A blank line ends a chunk; so does a forced page break (`===`), which is
    // typography, not content — it never reaches the block list.
    if (!line || PAGE_BREAK_RE.test(line)) {
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { lines: [], idxs: [] };
      chunks.push(cur);
    }
    cur.lines.push(line);
    cur.idxs.push(i);
  }
  return chunks;
}

function classify(lines: string[]): ChunkKind {
  const first = lines[0] ?? '';
  if (SCENE_RE.test(first)) return 'scene';
  if (lines.length === 1 && TRANSITION_RE.test(first)) return 'transition';
  if (isCharacterCue(first)) {
    // A cue is only a cue if dialogue follows it inside the same chunk.
    return lines.length > 1 ? 'dialogue' : 'orphan-cue';
  }
  return 'action';
}

// ─── title page ─────────────────────────────────────────────────────────────

/** A Fountain title page is a leading block of `Key: Value` lines terminated by
 *  a `===` page break. Anything less well-formed than that (a scene heading
 *  first, no page break, a non-`Key:` line in the block) is treated as body,
 *  so we never swallow real content on a guess. */
function findTitlePage(rawLines: string[]): {
  titlePage: Record<string, string> | null;
  bodyStart: number;
} {
  const none = { titlePage: null, bodyStart: 0 } as const;

  let breakIdx = -1;
  for (let i = 0; i < rawLines.length; i++) {
    const line = (rawLines[i] ?? '').trim();
    if (!line) continue;
    if (PAGE_BREAK_RE.test(line)) {
      breakIdx = i;
      break;
    }
    // Body started before any page break ⇒ there is no title page.
    if (SCENE_RE.test(line)) return none;
  }
  if (breakIdx < 0) return none;

  const titlePage: Record<string, string> = {};
  let lastKey: string | null = null;
  for (let i = 0; i < breakIdx; i++) {
    const raw = rawLines[i] ?? '';
    const line = raw.trim();
    if (!line) continue;

    const m = TITLE_KEY_RE.exec(line);
    if (m) {
      lastKey = (m[1] ?? '').trim();
      titlePage[lastKey] = (m[2] ?? '').trim();
      continue;
    }
    // Fountain allows an indented continuation of the previous key's value.
    if (lastKey !== null && /^\s/.test(raw)) {
      const prev = titlePage[lastKey] ?? '';
      titlePage[lastKey] = prev ? `${prev} ${line}` : line;
      continue;
    }
    return none;
  }
  if (lastKey === null) return none;

  return { titlePage, bodyStart: breakIdx + 1 };
}

// ─── tags ───────────────────────────────────────────────────────────────────

function extractTag(text: string): { text: string; tag?: string } {
  let tag: string | undefined;
  const stripped = text.replace(NOTE_RE, (_m, inner: string) => {
    if (tag === undefined) {
      const t = inner.trim();
      if (t) tag = t;
    }
    return '';
  });
  return { text: stripped.replace(/\s+/g, ' ').trim(), tag };
}

// ─── the action-block predicate (ONE definition, two walks) ─────────────────

/** Build the action block a chunk's lines yield, or `null` when they yield
 *  nothing at all (a chunk that is only an empty note — `[[]]`, `[[  ]]` —
 *  strips to no text and no tag).
 *
 *  **This is the single source of truth for "does this chunk count as action
 *  paragraph N".** `parseFountain` uses it to decide what to emit and
 *  `writeShotTags` uses it to decide what to number, so the two walks cannot
 *  disagree about which chunk index N names. They previously each carried
 *  their own version of the condition and drifted: `writeShotTags` numbered
 *  empty-note chunks that `parseFountain` dropped, so every tag after one
 *  landed a paragraph early — orphan notes in the script, a phantom
 *  `{text:'', tag}` block on re-parse, and drifting shot uids downstream.
 *  Do not re-inline this check at either call site. */
function actionBlockFrom(lines: string[]): FountainBlock | null {
  const { text, tag } = extractTag(lines.join(' '));
  if (!text && tag === undefined) return null;
  const block: FountainBlock = { kind: 'action', text };
  if (tag !== undefined) block.tag = tag;
  return block;
}

// ─── parse ──────────────────────────────────────────────────────────────────

/** Parse a raw `.fountain` string into a title page + scene cards.
 *
 *  Blank lines delimit paragraphs; a scene heading starts a new scene (an
 *  implicit "UNTITLED" scene absorbs any body content before the first
 *  heading — the title page no longer lands there). Wrapped lines inside a
 *  paragraph are joined with a single space. */
export function parseFountain(raw: string): FountainDoc {
  const rawLines = raw.split(/\r?\n/);
  const { titlePage, bodyStart } = findTitlePage(rawLines);
  const chunks = scanChunks(rawLines, bodyStart);

  const scenes: FountainScene[] = [];
  let current: FountainScene | null = null;
  let sceneIdx = 0;

  const ensureScene = (): FountainScene => {
    if (current) return current;
    const scene: FountainScene = { id: `scene-${++sceneIdx}`, heading: 'UNTITLED', blocks: [] };
    scenes.push(scene);
    current = scene;
    return scene;
  };

  const pushAction = (scene: FountainScene, lines: string[]): void => {
    const block = actionBlockFrom(lines);
    if (block) scene.blocks.push(block);
  };

  for (const chunk of chunks) {
    const first = chunk.lines[0] ?? '';
    switch (classify(chunk.lines)) {
      case 'scene': {
        const scene: FountainScene = { id: `scene-${++sceneIdx}`, heading: first, blocks: [] };
        scenes.push(scene);
        current = scene;
        // Tolerate a heading glued to its action with no blank line between.
        if (chunk.lines.length > 1) pushAction(scene, chunk.lines.slice(1));
        break;
      }
      case 'transition':
        ensureScene().blocks.push({ kind: 'transition', text: first });
        break;
      case 'dialogue':
        ensureScene().blocks.push({
          kind: 'dialogue',
          character: first,
          text: chunk.lines.slice(1).join(' '),
        });
        break;
      case 'orphan-cue':
        // A solitary ALL-CAPS line with nothing under it ("THE END", "MONTAGE").
        // Dropped, matching the pre-19 parser: it is not dialogue (no lines
        // follow), and emitting it as action would mint a paragraph no shot
        // corresponds to — shifting every downstream action index, which is the
        // index `writeShotTags` tags against. Still load-bearing: don't "fix"
        // this into an action block without re-checking that round-trip.
        break;
      case 'action':
        pushAction(ensureScene(), chunk.lines);
        break;
    }
  }

  return { titlePage, scenes };
}

// ─── serialize ──────────────────────────────────────────────────────────────

/** Insert or replace `[[tag]]` notes on the Nth action paragraph and return the
 *  full new file text. `paragraphIndex` is the document-wide index over action
 *  blocks in `parseFountain` order (i.e. `scenes.flatMap(s => s.blocks).filter(
 *  b => b.kind === 'action')`), so it lines up 1:1 with Breakdown's rail.
 *
 *  Paragraphs not named in `tags` are left byte-for-byte alone. The round trip
 *  is stable: `parseFountain(writeShotTags(raw, tags))` yields those tags. */
export function writeShotTags(
  raw: string,
  tags: Array<{ paragraphIndex: number; tag: string }>,
): string {
  const rawLines = raw.split(/\r?\n/);
  const { bodyStart } = findTitlePage(rawLines);
  const chunks = scanChunks(rawLines, bodyStart);

  const wanted = new Map<number, string>();
  for (const t of tags) wanted.set(t.paragraphIndex, t.tag);

  // `null` marks a line that existed only to hold a note and is now empty —
  // it's dropped at the end so it can't split a paragraph in two on re-parse.
  const out: Array<string | null> = [...rawLines];
  let actionIdx = 0;

  for (const chunk of chunks) {
    const kind = classify(chunk.lines);
    let lines: string[] | null = null;
    let idxs: number[] | null = null;
    if (kind === 'action') {
      lines = chunk.lines;
      idxs = chunk.idxs;
    } else if (kind === 'scene' && chunk.lines.length > 1) {
      // A heading glued to its action — the action half is the paragraph.
      lines = chunk.lines.slice(1);
      idxs = chunk.idxs.slice(1);
    }
    if (!lines || !idxs) continue;
    // Same predicate `parseFountain` emits under, so `actionIdx` counts exactly
    // the chunks that become action blocks — no empty-note chunk burns an index.
    if (!actionBlockFrom(lines)) continue;

    const tag = wanted.get(actionIdx++);
    if (tag === undefined) continue;
    applyTag(out, idxs, tag);
  }

  return out.filter((l): l is string => l !== null).join('\n');
}

function applyTag(out: Array<string | null>, idxs: number[], tag: string): void {
  for (const i of idxs) {
    const before = out[i] ?? '';
    const cleaned = before.replace(/[ \t]*\[\[[^\]]*\]\]/g, '').replace(/[ \t]+$/, '');
    out[i] = cleaned.trim() === '' ? null : cleaned;
  }

  let target = -1;
  for (let k = idxs.length - 1; k >= 0; k--) {
    const i = idxs[k] ?? -1;
    if (i >= 0 && out[i] !== null) {
      target = i;
      break;
    }
  }
  // Every line in the chunk was note-only: revive the first and make it the tag.
  if (target < 0) {
    target = idxs[0] ?? 0;
    out[target] = '';
  }
  out[target] = `${out[target] ?? ''} [[${tag}]]`.trim();
}
