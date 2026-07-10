// com.ikenga.studio · lightweight Fountain parser
//
// Client-side, read-only. No PDF export, no lock-step with Final Draft — per
// script.md §"Gaps": "Fountain renderer uses a lightweight parser (no
// server-side PDF export — out of scope P1)." Recognizes scene headings
// (INT./EXT./INT.-EXT./I/E.), transitions (ALL CAPS lines ending "TO:"),
// character cues (a solitary ALL CAPS line) followed by dialogue, and falls
// back to action for everything else. Good enough to render the `narrative`
// archetype's script.fountain as scene cards (Script.tsx §"Fountain mode");
// not a spec-complete Fountain implementation.

export type FountainBlockKind = 'action' | 'dialogue' | 'transition';

export interface FountainBlock {
  kind: FountainBlockKind;
  /** Only present on `dialogue` blocks — the character cue line above it. */
  character?: string;
  text: string;
}

export interface FountainScene {
  id: string;
  /** The raw scene heading line, e.g. "INT. STUDIO LOFT - DAY". */
  heading: string;
  blocks: FountainBlock[];
}

const SCENE_RE = /^(INT|EXT|INT\.\/EXT|I\/E)[.\s]/i;
const TRANSITION_RE = /^[A-Z0-9 .'-]{2,30}TO:$/;
// A character cue is a short, all-caps, non-scene, non-transition line with
// at least one letter (so plain punctuation/numbers don't qualify).
const CHARACTER_RE = /^[A-Z0-9 .'()-]{1,40}$/;

function isCharacterCue(line: string): boolean {
  return (
    CHARACTER_RE.test(line) &&
    line === line.toUpperCase() &&
    /[A-Z]/.test(line) &&
    !SCENE_RE.test(line) &&
    !TRANSITION_RE.test(line)
  );
}

/** Parse a raw `.fountain` string into scene cards. Blank lines separate
 *  blocks; a scene heading starts a new scene (an implicit "UNTITLED" scene
 *  absorbs any content before the first heading). */
export function parseFountain(raw: string): FountainScene[] {
  const lines = raw.split(/\r?\n/);
  const scenes: FountainScene[] = [];
  let current: FountainScene | null = null;
  let pendingCharacter: string | null = null;
  let sceneIdx = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pendingCharacter = null;
      continue;
    }

    if (SCENE_RE.test(line)) {
      current = { id: `scene-${++sceneIdx}`, heading: line, blocks: [] };
      scenes.push(current);
      pendingCharacter = null;
      continue;
    }

    if (!current) {
      current = { id: `scene-${++sceneIdx}`, heading: 'UNTITLED', blocks: [] };
      scenes.push(current);
    }

    if (TRANSITION_RE.test(line)) {
      current.blocks.push({ kind: 'transition', text: line });
      pendingCharacter = null;
      continue;
    }

    if (pendingCharacter) {
      current.blocks.push({ kind: 'dialogue', character: pendingCharacter, text: line });
      pendingCharacter = null;
      continue;
    }

    if (isCharacterCue(line)) {
      pendingCharacter = line;
      continue;
    }

    current.blocks.push({ kind: 'action', text: line });
  }

  return scenes;
}
