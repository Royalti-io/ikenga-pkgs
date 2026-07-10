// com.ikenga.studio · composition mock
//
// The timeline slice the Composition view renders until the real MCP plumb-
// through lands (commit 12+). Presentation-only fields (accent, synthetic
// waveform bar heights) live here, not on the schema entities — same rule as
// __mocks__/cells.ts.
//
// Schema conformance (contract §6): render statuses use the frozen enum
// ('queued' | 'running' | 'done' | 'failed' | 'cancelled') — NO 'idle', and
// the design's 'rendering'/'pending' mock bugs are corrected: a clip with a
// render is 'running'; a clip with no render record at all is UI-local
// "pending" (status omitted → dimmed). Narration mirrors NarrationBlock
// (`audio` + `words[{word,start_ms,end_ms}]` + `duration_ms` + `generated_at`).

import type { RenderStatus } from '../mcp-types';

export type BeatAccent = 'amber' | 'rose' | 'emerald' | 'sky' | 'violet' | 'fuchsia';
export type TransitionKind = 'cut' | 'fade' | 'smash-cut' | 'j-cut' | 'l-cut';

/** One cell laid out on the composition timeline. `status` omitted ⇒ the cell
 *  has no render record yet (UI-local "pending"): dimmed, not scrubbable to a
 *  preview. Otherwise a schema RenderStatus. */
export interface TimelineClip {
  uid: string;
  beat: string;
  accent: BeatAccent;
  start_ms: number;
  duration_ms: number;
  transition?: TransitionKind;
  status?: Extract<RenderStatus, 'queued' | 'running' | 'done' | 'failed' | 'cancelled'>;
}

export const COMPOSITION_TOTAL_MS = 60_000;

export const COMPOSITION_TIMELINE: TimelineClip[] = [
  { uid: 'c01', beat: 'hook',     accent: 'amber',   start_ms: 0,      duration_ms: 4_000,  status: 'done' },
  { uid: 'c02', beat: 'problem',  accent: 'rose',    start_ms: 4_000,  duration_ms: 8_000,  transition: 'cut',       status: 'done' },
  { uid: 'c03', beat: 'agitate',  accent: 'rose',    start_ms: 12_000, duration_ms: 8_000,  transition: 'smash-cut', status: 'done' },
  { uid: 'c04', beat: 'solution', accent: 'emerald', start_ms: 20_000, duration_ms: 15_000, transition: 'fade',      status: 'running' },
  { uid: 'c05', beat: 'proof',    accent: 'sky',     start_ms: 35_000, duration_ms: 12_000, transition: 'cut',       status: 'queued' },
  // c06 cta — no render record yet → UI-local pending (status omitted).
  { uid: 'c06', beat: 'cta',      accent: 'violet',  start_ms: 47_000, duration_ms: 13_000, transition: 'cut' },
];

// ─── Narration (NarrationBlock-shaped, §6) ───────────────────────────────

export interface MockNarrationWord {
  word: string;
  start_ms: number;
  end_ms: number;
}

export interface MockNarrationBlock {
  audio: { uri: string };
  words: MockNarrationWord[];
  duration_ms: number;
  generated_at: string;
}

export const COMPOSITION_NARRATION: MockNarrationBlock = {
  audio: { uri: 'narration.mp3' },
  duration_ms: COMPOSITION_TOTAL_MS,
  generated_at: '2026-07-10T00:00:00.000Z',
  words: [
    { word: 'Most',         start_ms: 4_200,  end_ms: 4_500 },
    { word: 'labels',       start_ms: 4_500,  end_ms: 4_900 },
    { word: 'still',        start_ms: 4_900,  end_ms: 5_200 },
    { word: 'treat',        start_ms: 12_200, end_ms: 12_500 },
    { word: 'retention',    start_ms: 12_500, end_ms: 13_100 },
    { word: 'as',           start_ms: 13_100, end_ms: 13_300 },
    { word: 'afterthought', start_ms: 13_300, end_ms: 14_000 },
  ],
};

/** Composition-level metadata for the header + engine tabs row. */
export const COMPOSITION_META = {
  name: 'retention-explainer',
  aspect: '16:9',
  resolution: { w: 1920, h: 1080 },
  rung: '2_hifi' as const,
};

// ─── Synthetic waveform (presentation-only) ──────────────────────────────
//
// 80 bar heights (0–100), generated deterministically by the same formula the
// composition.html mockup used, so the strip is stable across renders. Real
// waveform peaks come from Project.audio_analysis (P2).

export const WAVEFORM_BAR_COUNT = 80;

export const WAVEFORM_BARS: number[] = Array.from(
  { length: WAVEFORM_BAR_COUNT },
  (_, i) => {
    const t = i / WAVEFORM_BAR_COUNT;
    const edge = t > 0.05 && t < 0.95 ? 1 : 0.2;
    const amp = 0.3 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.3)) * 0.6 * edge;
    return Math.round(amp * 1000) / 10; // one decimal, 0–100
  },
);
