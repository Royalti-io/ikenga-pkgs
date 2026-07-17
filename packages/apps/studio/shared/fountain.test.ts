// com.ikenga.studio · shared/fountain.ts gates
//
//   node --test --experimental-strip-types "*.test.ts"   (from shared/)
//   pnpm --filter @ikenga/studio-schema test
//
// Three of these are regression gates, not exploratory tests:
//   · DEMO_FOUNTAIN → exactly 6 action paragraphs (Breakdown's demo rail links
//     6 paragraphs to 6 DEMO_SHOTS; 6 is load-bearing).
//   · FOUNTAIN_SAMPLE → block-for-block identical to the PRE-19 line-based
//     parser, which is inlined verbatim below as `parseFountainLegacy`. The
//     sample is blank-line-delimited single-line paragraphs, so chunk-joining
//     must be a no-op for it. If this fails, the rewrite changed Script.tsx's
//     rendering and that is a bug, not a new baseline.
//   · fixtures/script/forge.fountain (a byte copy of the real
//     ~/ikenga-forge/script.fountain) → title page + 6 scenes + 8 action
//     paragraphs. This is the case the old parser got wrong (26 paragraphs,
//     phantom UNTITLED scene).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { parseFountain, writeShotTags, type FountainScene } from './fountain.ts';
import { FOUNTAIN_SAMPLE } from '../src/studio/__mocks__/script.ts';

const FORGE = readFileSync(
  fileURLToPath(new URL('../fixtures/script/forge.fountain', import.meta.url)),
  'utf8',
);

// Copied verbatim from views/Breakdown.tsx (it lives inline in a .tsx, so it
// can't be imported here). Keep in sync if that constant ever changes.
const DEMO_FOUNTAIN = `INT. THE WORKSHOP - NIGHT

The forge glows low and orange in the dark. Embers drift upward like slow stars.

Adaora stands at the anvil, soot on her hands, hammer raised, firelight carving her face out of shadow.

Close on the anvil: an iron mask, half-formed, catches sparks as it turns beneath the hammer's shadow.

The hammer falls. Sparks burst toward camera — a shower of white fire against black.

The mask's eyes catch the firelight. A flicker. Almost alive.

Adaora steps back. Between her hands the mask glows, held like something newborn.
`;

const actions = (scenes: FountainScene[]) =>
  scenes.flatMap((s) => s.blocks).filter((b) => b.kind === 'action');

// ─── the pre-19 parser, verbatim, as the FOUNTAIN_SAMPLE oracle ─────────────

interface LegacyBlock {
  kind: 'action' | 'dialogue' | 'transition';
  character?: string;
  text: string;
}
interface LegacyScene {
  id: string;
  heading: string;
  blocks: LegacyBlock[];
}

function parseFountainLegacy(raw: string): LegacyScene[] {
  const SCENE_RE = /^(INT|EXT|INT\.\/EXT|I\/E)[.\s]/i;
  const TRANSITION_RE = /^[A-Z0-9 .'-]{2,30}TO:$/;
  const CHARACTER_RE = /^[A-Z0-9 .'()-]{1,40}$/;
  const isCharacterCue = (line: string): boolean =>
    CHARACTER_RE.test(line) &&
    line === line.toUpperCase() &&
    /[A-Z]/.test(line) &&
    !SCENE_RE.test(line) &&
    !TRANSITION_RE.test(line);

  const lines = raw.split(/\r?\n/);
  const scenes: LegacyScene[] = [];
  let current: LegacyScene | null = null;
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

// ─── gates ──────────────────────────────────────────────────────────────────

test('FOUNTAIN_SAMPLE is byte-identical to the pre-19 parser (regression gate)', () => {
  const { titlePage, scenes } = parseFountain(FOUNTAIN_SAMPLE);
  assert.equal(titlePage, null, 'the sample has no title page');
  // Deep-equal against the OLD parser's actual output, not a hand-written copy.
  assert.deepEqual(scenes, parseFountainLegacy(FOUNTAIN_SAMPLE));

  // Belt-and-braces on the shape the oracle is asserting.
  assert.equal(scenes.length, 3);
  assert.deepEqual(
    scenes.map((s) => s.heading),
    ['INT. STUDIO LOFT - DAY', 'EXT. ROOFTOP - GOLDEN HOUR', 'INT. CONTROL ROOM - CONTINUOUS'],
  );
  assert.equal(actions(scenes).length, 3);
  assert.deepEqual(
    scenes.flatMap((s) => s.blocks).map((b) => b.kind),
    ['action', 'dialogue', 'transition', 'action', 'dialogue', 'transition', 'action', 'dialogue'],
  );
});

test('DEMO_FOUNTAIN still parses to exactly 6 action paragraphs', () => {
  const { titlePage, scenes } = parseFountain(DEMO_FOUNTAIN);
  assert.equal(titlePage, null);
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0]!.heading, 'INT. THE WORKSHOP - NIGHT');
  assert.equal(actions(scenes).length, 6, 'Breakdown demo rail links 6 paragraphs to 6 shots');
  assert.deepEqual(scenes, parseFountainLegacy(DEMO_FOUNTAIN), 'unchanged vs the pre-19 parser');
});

test('real forge script: title page + 6 scenes + 8 action paragraphs', () => {
  const { titlePage, scenes } = parseFountain(FORGE);

  assert.deepEqual(titlePage, {
    Title: 'The Forge',
    Credit: 'An Ikenga Studio piece',
    'Draft date': '2026-07-15',
    Notes: 'Ember-noir. Six beats. A blacksmith gives life to an iron mask.',
  });

  assert.equal(scenes.length, 6);
  assert.ok(
    !scenes.some((s) => s.heading === 'UNTITLED'),
    'the title page must not leak into a phantom UNTITLED scene',
  );
  assert.equal(actions(scenes).length, 8);

  // The whole point of chunking: wrapped lines join, no mid-sentence breaks.
  assert.equal(
    actions(scenes)[0]!.text,
    'A dim ironworking workshop at night. A glowing forge at the center of the room. ' +
      'Hanging tools in silhouette against the dark. Embers drift slowly in the air. ' +
      'Warm orange key light carves through deep shadow. Cinematic, shallow depth of field.',
  );

  // The old parser produced 26 action paragraphs on this exact input.
  assert.equal(actions(parseFountainLegacy(FORGE) as FountainScene[]).length, 26);
});

test('trailing solitary ALL-CAPS cue ("THE END") is dropped, not emitted as action', () => {
  const { scenes } = parseFountain(FORGE);
  const texts = actions(scenes).map((b) => b.text);
  assert.ok(!texts.includes('THE END'));
  // ...but a cue WITH dialogue under it is still dialogue.
  const { scenes: d } = parseFountain('INT. A - DAY\n\nADAORA\nSay it again.\n');
  assert.deepEqual(d[0]!.blocks, [{ kind: 'dialogue', character: 'ADAORA', text: 'Say it again.' }]);
});

test('shot tags parse off action chunks and strip out of the text', () => {
  const { scenes } = parseFountain(
    'INT. A - DAY\n\nThe forge glows. [[sc1_sh1]]\n\nEmbers drift\nupward. [[sc1_sh2]]\n',
  );
  assert.deepEqual(actions(scenes), [
    { kind: 'action', text: 'The forge glows.', tag: 'sc1_sh1' },
    { kind: 'action', text: 'Embers drift upward.', tag: 'sc1_sh2' },
  ]);
});

test('writeShotTags round-trips: parse(writeShotTags(x)) yields the tags', () => {
  const tags = [
    { paragraphIndex: 0, tag: 'sc1_sh1' },
    { paragraphIndex: 1, tag: 'sc1_sh2' },
    { paragraphIndex: 7, tag: 'sc6_sh1' },
  ];
  const written = writeShotTags(FORGE, tags);
  const { titlePage, scenes } = parseFountain(written);

  // Structure survives the write untouched.
  assert.equal(scenes.length, 6);
  assert.equal(actions(scenes).length, 8);
  assert.deepEqual(titlePage, parseFountain(FORGE).titlePage);

  assert.deepEqual(
    actions(scenes).map((b) => b.tag),
    ['sc1_sh1', 'sc1_sh2', undefined, undefined, undefined, undefined, undefined, 'sc6_sh1'],
  );

  // Tagging must not disturb the prose.
  assert.deepEqual(
    actions(scenes).map((b) => b.text),
    actions(parseFountain(FORGE).scenes).map((b) => b.text),
  );

  // Idempotent: re-writing the same tags is a no-op on the file text.
  assert.equal(writeShotTags(written, tags), written);

  // Replacing an existing tag replaces rather than appends.
  const replaced = writeShotTags(written, [{ paragraphIndex: 0, tag: 'sc1_shX' }]);
  assert.equal(actions(parseFountain(replaced).scenes)[0]!.tag, 'sc1_shX');
  assert.equal((replaced.match(/\[\[/g) ?? []).length, 3);

  // Untouched paragraphs keep their existing tags.
  assert.deepEqual(
    actions(parseFountain(replaced).scenes).map((b) => b.tag),
    ['sc1_shX', 'sc1_sh2', undefined, undefined, undefined, undefined, undefined, 'sc6_sh1'],
  );
});

test('writeShotTags on an untitled, tagless script', () => {
  const written = writeShotTags(DEMO_FOUNTAIN, [{ paragraphIndex: 2, tag: 'sc1_sh3' }]);
  const tagged = actions(parseFountain(written).scenes);
  assert.equal(tagged.length, 6);
  assert.deepEqual(
    tagged.map((b) => b.tag),
    [undefined, undefined, 'sc1_sh3', undefined, undefined, undefined],
  );
});

// ─── empty-note chunks must not desync the two walks ────────────────────────
//
// `parseFountain` drops a chunk that strips to no text and no tag; before the
// shared `actionBlockFrom` predicate, `writeShotTags` still NUMBERED it. Every
// tag after such a chunk landed one paragraph early, leaving an orphan note in
// the script and minting a phantom `{text:'', tag}` block on re-parse — which
// drifted shot uids and wedged `breakdown.run` on cells-exist forever after.

const EMPTY_NOTE_SCRIPT = 'INT. A - DAY\n\nFirst para.\n\n[[  ]]\n\nSecond para.\n';

test('an empty-note chunk does not consume an action index (writeShotTags/parse desync)', () => {
  // The parser sees two action paragraphs; the `[[  ]]` chunk yields nothing.
  assert.deepEqual(
    actions(parseFountain(EMPTY_NOTE_SCRIPT).scenes).map((b) => b.text),
    ['First para.', 'Second para.'],
  );

  const written = writeShotTags(EMPTY_NOTE_SCRIPT, [
    { paragraphIndex: 0, tag: 'X1' },
    { paragraphIndex: 1, tag: 'X2' },
  ]);

  // Index 1 is "Second para." — not the empty note, and not nothing.
  assert.match(written, /First para\. \[\[X1\]\]/);
  assert.match(written, /Second para\. \[\[X2\]\]/);

  // No orphan: X2 must not have been written onto the empty-note line.
  assert.ok(
    !/^\s*\[\[X2\]\]\s*$/m.test(written),
    'X2 must land on a real paragraph, never on the empty-note chunk',
  );
  assert.equal((written.match(/\[\[/g) ?? []).length, 3, 'X1, X2, and the untouched [[  ]]');

  // Re-parsing yields no phantom `{text:'', tag:'X2'}` block: still 2 paragraphs,
  // each carrying its own tag, prose intact.
  assert.deepEqual(actions(parseFountain(written).scenes), [
    { kind: 'action', text: 'First para.', tag: 'X1' },
    { kind: 'action', text: 'Second para.', tag: 'X2' },
  ]);
});

test('round-trip is stable with an empty-note chunk present', () => {
  const tags = [
    { paragraphIndex: 0, tag: 'X1' },
    { paragraphIndex: 1, tag: 'X2' },
  ];
  const written = writeShotTags(EMPTY_NOTE_SCRIPT, tags);

  // Idempotent on the file text, so repeated `breakdown.run` retags can't drift.
  assert.equal(writeShotTags(written, tags), written);

  // ...and stable through a full parse→write→parse cycle.
  const twice = writeShotTags(written, tags);
  assert.deepEqual(parseFountain(twice), parseFountain(written));
  assert.equal(parseFountain(twice).scenes.length, 1);
  assert.equal(actions(parseFountain(twice).scenes).length, 2);

  // Replacing a tag still targets the same paragraph the second time around.
  const replaced = writeShotTags(written, [{ paragraphIndex: 1, tag: 'X9' }]);
  assert.deepEqual(
    actions(parseFountain(replaced).scenes).map((b) => b.tag),
    ['X1', 'X9'],
  );
});

test('a `===` with no well-formed Key: block above it is not a title page', () => {
  const { titlePage, scenes } = parseFountain('Just some prose.\n\n===\n\nINT. A - DAY\n\nAction.\n');
  assert.equal(titlePage, null);
  assert.deepEqual(
    scenes.map((s) => s.heading),
    ['UNTITLED', 'INT. A - DAY'],
  );
  assert.equal(actions(scenes).length, 2, 'the prose is kept as body, the === is dropped');
});
