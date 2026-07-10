// com.ikenga.studio · script mock
//
// The beat-ordered VO/action list the Script view renders until the real MCP
// plumb-through lands (`project.script` off storyboard.json — script.md
// §"API"). uid/beat/start_ms/duration_ms deliberately mirror
// __mocks__/composition.ts's COMPOSITION_TIMELINE (same retention-explainer
// fixture, same 6 cells) so clicking a Script row and scrubbing Composition
// land on the same beat — the cross-link contract's whole point.
//
// Schema conformance (script.md §"Ground truth"): ScriptBeat { id, scene_id?,
// shot_id?, vo, on_screen_text?, action?, duration_ms, sfx: string[],
// transition?, metadata }. `accent`/`start_ms` are presentation-only —
// same rule as __mocks__/cells.ts and __mocks__/composition.ts.

import type { BeatAccent, TransitionKind } from './composition';

export interface MockScriptBeat {
  /** Matches the Cell uid this beat projects to (c01..c06) — same fixture as
   *  __mocks__/cells.ts and __mocks__/composition.ts. */
  uid: string;
  beat: string;
  accent: BeatAccent;
  start_ms: number;
  duration_ms: number;
  /** Narration voice-over text. Undefined ⇒ no VO for this beat (visual-only). */
  vo?: string;
  on_screen_text?: string;
  /** Action/blocking note — shown when there's no VO, so the row isn't empty. */
  action?: string;
  sfx: string[];
  transition?: TransitionKind;
}

export const SCRIPT_BEATS: MockScriptBeat[] = [
  {
    uid: 'c01', beat: 'hook', accent: 'amber', start_ms: 0, duration_ms: 4_000,
    action: 'Open on a spinning vinyl record, gold sparks catching the light.',
    sfx: ['icon-pop'],
  },
  {
    uid: 'c02', beat: 'problem', accent: 'rose', start_ms: 4_000, duration_ms: 8_000,
    vo: 'Most labels still treat retention as an afterthought.',
    sfx: [],
    transition: 'cut',
  },
  {
    uid: 'c03', beat: 'agitate', accent: 'rose', start_ms: 12_000, duration_ms: 8_000,
    vo: 'They treat retention as an afterthought — until the catalog stops earning.',
    sfx: [],
    transition: 'smash-cut',
  },
  {
    uid: 'c04', beat: 'solution', accent: 'emerald', start_ms: 20_000, duration_ms: 15_000,
    action: 'Screen capture — dashboard reveal, cursor highlights the retention graph.',
    on_screen_text: 'retention, automated',
    sfx: [],
    transition: 'fade',
  },
  {
    uid: 'c05', beat: 'proof', accent: 'sky', start_ms: 35_000, duration_ms: 12_000,
    action: 'Testimonial cutaway — client logo wall, lower-third quote.',
    sfx: [],
    transition: 'cut',
  },
  {
    uid: 'c06', beat: 'cta', accent: 'violet', start_ms: 47_000, duration_ms: 13_000,
    action: 'Logo + drop date + handle. Hold 2s.',
    on_screen_text: 'royalti.io/retention',
    sfx: ['icon-pop', 'data-reveal', 'outro-resolve'],
    transition: 'cut',
  },
];

/** Composition-level metadata for the pane header + the Script/Fountain mode
 *  toggle. `archetype` gates the toggle (script.md §"Chrome & Navigation":
 *  the toggle — and Fountain rendering — is visible only when
 *  `archetype === 'narrative'`). The retention-explainer fixture above is an
 *  `explainer`-archetype project, so by default the toggle stays hidden; flip
 *  this to `'narrative'` locally to exercise the Fountain path against
 *  FOUNTAIN_SAMPLE. */
export const SCRIPT_META = {
  title: 'retention-explainer',
  archetype: 'explainer' as 'explainer' | 'narrative' | 'product' | 'musicvideo',
};

/** A short `.fountain` sample for the narrative archetype's Fountain mode
 *  (script.md §"Fountain mode"). Not tied to SCRIPT_BEATS above — a narrative
 *  project reads its script.fountain directly rather than a JSON beat list. */
export const FOUNTAIN_SAMPLE = `INT. STUDIO LOFT - DAY

A pair of hands rest on a mixing console. Dawn light rakes through the blinds.

NARRATOR (V.O.)
Most labels still treat retention as an afterthought.

CUT TO:

EXT. ROOFTOP - GOLDEN HOUR

Talent stands at the edge, city sprawled below. The camera cranes down.

NARRATOR (V.O.)
Until the catalog stops earning — and by then it's too late to ask why.

SMASH CUT TO:

INT. CONTROL ROOM - CONTINUOUS

A dashboard resolves on screen: retention curves, one per release.

NARRATOR (V.O.)
Royalti watches every catalog, every day, so you don't have to.
`;
