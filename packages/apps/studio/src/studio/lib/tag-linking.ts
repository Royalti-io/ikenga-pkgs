// com.ikenga.studio · script↔board linking on `[[tags]]`, keyed by uid (D-1a)
//
// ONE linking mechanism, two consumers: the Breakdown rail (script line ↔ shot
// card) and the node canvas's beat → shot edges. Plan 25 G-57 is explicit about
// why this file exists:
//
//   "`beat_id` is null on every real project … the beat → shot edge cannot be
//    derived from the FK. Breakdown already solved it by linking on `[[tags]]`
//    keyed by `uid` … Reuse that mechanism; do not invent a second one."
//
// The rule that makes it trustworthy is the same one Breakdown states: a
// paragraph or a shot we cannot link EXACTLY is left unlinked. Nothing is
// linked speculatively and nothing positional is inferred, so an untagged
// script honestly draws no edges rather than drawing wrong ones.

import type { FountainBlock, FountainDoc, FountainScene } from './fountain';

/** The minimum a shot must expose to be linkable. `shotId` is the human label
 *  (`Cell.label`), `uid` the stable id and the exact text a `[[tag]]` carries. */
export interface LinkableShot {
  uid: string;
  shotId: string;
}

/** `tag` — at least one paragraph carries a `[[tag]]`, so links are exact.
 *  `none` — no tags at all, so there is nothing we can link honestly. There is
 *  deliberately no third mode: a positional fallback is off-by-one on real
 *  scripts (labels are not `sc<N>_sh<M>`), which is why it was deleted. */
export type LinkMode = 'tag' | 'none';

export interface Linking {
  mode: LinkMode;
  /** Per action-paragraph index → the shot uid it links to (or undefined). */
  paraLink: Array<string | undefined>;
  /** Per shot index → the shot uid, when that shot is linked to a paragraph. */
  shotLink: Array<string | undefined>;
  /** The ids with BOTH ends present — exactly what the Breakdown rail draws. */
  railIds: string[];
  /** How many action paragraphs carry a `[[tag]]` at all. */
  taggedParagraphs: number;
}

/** Index shots by every key a `[[tag]]` might legitimately name. `uid` is
 *  inserted last so it wins over a `shotId` collision. */
export function shotKeyIndex(shots: LinkableShot[]): Map<string, number> {
  const byKey = new Map<string, number>();
  shots.forEach((s, i) => { if (s.shotId) byKey.set(s.shotId, i); });
  shots.forEach((s, i) => { byKey.set(s.uid, i); });
  return byKey;
}

/** Tag-only (D-1a). The one rule that matters: a paragraph or a shot we cannot
 *  link EXACTLY is left unlinked — never linked speculatively, and never used
 *  to suppress the links we do have. An all-unlinked result is a legitimate
 *  answer ("this script carries no tags yet"), not a failure to paper over. */
export function computeLinking(actionBlocks: FountainBlock[], shots: LinkableShot[]): Linking {
  const paraLink: Array<string | undefined> = new Array(actionBlocks.length).fill(undefined);
  const shotLink: Array<string | undefined> = new Array(shots.length).fill(undefined);
  const taggedParagraphs = actionBlocks.filter((b) => b.tag).length;

  const byKey = shotKeyIndex(shots);

  let mode: LinkMode = 'none';

  if (taggedParagraphs > 0) {
    mode = 'tag';
    actionBlocks.forEach((b, i) => {
      if (!b.tag) return;
      const si = byKey.get(b.tag);
      if (si == null) return;            // tag names a shot that doesn't exist
      if (shotLink[si] !== undefined) return; // duplicate tag — first wins
      paraLink[i] = shots[si].uid;
      shotLink[si] = shots[si].uid;
    });
  }

  const railIds = paraLink.filter((v): v is string => v !== undefined);
  return { mode, paraLink, shotLink, railIds, taggedParagraphs };
}

// ─── beat → shot (Plan 25 G-57) ──────────────────────────────────────────

/** The minimum a beat must expose. `id` matches `Cell.beat_id` in the schema's
 *  intent; `scene_id` / `shot_id` are the OTIO ids (`sc3`, `sc3_sh2A`) beats
 *  carry so external tools can round-trip. */
export interface LinkableBeat {
  id: string;
  scene_id?: string;
  shot_id?: string;
}

export interface BeatShotLink {
  beatId: string;
  cellUid: string;
}

/** `sc1_sh3` → `sc1`. The OTIO shot-id convention `breakdown.run` itself mints
 *  when it scaffolds a board from a script — so a tag written by that path
 *  already names its own scene. Anything without the `_sh` infix yields null
 *  rather than a guess. */
export function otioSceneOf(tag: string): string | null {
  const m = /^(.+?)_sh[^_]*$/.exec(tag);
  return m ? m[1] : null;
}

/** Fountain scene ids are minted as `scene-<n>` by the parser; a beat's OTIO
 *  scene id is `sc<n>`. Both are 1-based ordinals over the same scene list, so
 *  this is a naming translation, not a positional guess about content. */
function sceneAliases(scene: FountainScene, ordinal: number): string[] {
  return [scene.id, `sc${ordinal}`, scene.heading];
}

/**
 * Derive beat → shot pairs from the `[[tags]]` in the fountain, keyed by uid
 * (G-57). NOT from `Cell.beat_id`, which is null on every real project.
 *
 * Both ends must resolve exactly or no edge is emitted:
 *
 *  • The SHOT end is `computeLinking`'s own rule — the tag must name a real
 *    shot by uid (or by its label).
 *  • The BEAT end is resolved by exact key lookup, in falling order of
 *    directness: the tag itself naming a beat, the tag's OTIO scene prefix
 *    (`sc1_sh3` → `sc1`), then the enclosing fountain scene's own ids.
 *
 * A tagged paragraph in a script whose beats we cannot name honestly produces
 * no edge — the same "leave it unlinked" contract the rail lives by.
 */
export function deriveBeatShotLinks(
  doc: FountainDoc | null,
  shots: LinkableShot[],
  beats: LinkableBeat[],
): BeatShotLink[] {
  if (!doc || shots.length === 0 || beats.length === 0) return [];

  const shotByKey = shotKeyIndex(shots);

  const beatByKey = new Map<string, string>();
  for (const b of beats) {
    if (b.shot_id) beatByKey.set(b.shot_id, b.id);
    if (b.scene_id) beatByKey.set(b.scene_id, b.id);
    beatByKey.set(b.id, b.id);
  }

  const links: BeatShotLink[] = [];
  const claimed = new Set<string>(); // a shot links to at most one beat

  doc.scenes.forEach((scene, sceneIdx) => {
    const aliases = sceneAliases(scene, sceneIdx + 1);
    for (const block of scene.blocks) {
      if (block.kind !== 'action' || !block.tag) continue;
      const si = shotByKey.get(block.tag);
      if (si == null) continue;                 // tag names no shot on this board
      const cellUid = shots[si].uid;
      if (claimed.has(cellUid)) continue;       // duplicate tag — first wins

      const candidates = [block.tag, otioSceneOf(block.tag), ...aliases];
      let beatId: string | undefined;
      for (const key of candidates) {
        if (!key) continue;
        const found = beatByKey.get(key);
        if (found) { beatId = found; break; }
      }
      if (!beatId) continue;                    // no beat we can name → no edge

      claimed.add(cellUid);
      links.push({ beatId, cellUid });
    }
  });

  return links;
}
