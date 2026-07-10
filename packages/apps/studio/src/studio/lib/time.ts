// com.ikenga.studio · time-frame model (FROZEN — G-TIME-MODEL, 2026-07-10)
//
// The ONE place time math lives. Pure, dependency-free, no imports. Every
// transport / timeline / scrubber / waveform / ruler part imports these —
// none re-implement `fmt()`. (The four mockups carried four divergent `fmt`
// copies; this module kills them.)
//
// `DEFAULT_FPS = 30` is the sanctioned P1 bridge. The frozen schema carries
// no `fps` field on Project / Cell / RenderRecord (only loosely in
// RenderRecord.metadata); `Cell.time` is seconds and `Cell.frames` is an int
// count with nothing tying them. This module is that tie for P1. Remotion
// overrides fps per-composition in P2 — hence every fn takes an `fps` param
// that defaults to DEFAULT_FPS. Do NOT invent a second convention.
//
// Contract: plans/studio/13-wp07-resume-contract.md §3.

/** Frames per second for the P1 HF / Excalidraw path. Remotion overrides
 *  per-composition (P2) by passing an explicit `fps` to each fn below. */
export const DEFAULT_FPS = 30;

/** ms → whole frame index (rounded to the nearest frame). */
export const msToFrames = (ms: number, fps: number = DEFAULT_FPS): number =>
  Math.round((ms / 1000) * fps);

/** frame index → ms (exact; not rounded — callers snap when they need a grid). */
export const framesToMs = (frames: number, fps: number = DEFAULT_FPS): number =>
  (frames / fps) * 1000;

/** Snap an arbitrary ms value onto the nearest frame boundary. The single
 *  quantiser every seek passes through so the playhead never lands between
 *  frames. `snapMsToFrame(framesToMs(f)) === framesToMs(f)`. */
export const snapMsToFrame = (ms: number, fps: number = DEFAULT_FPS): number =>
  framesToMs(msToFrames(ms, fps), fps);

/** Clock display — "M:SS.t" (tenths). e.g. 8400 → "0:08.4", 60000 → "1:00.0".
 *  Used by the timecode readout, the scrubber aria-valuetext, and the header. */
export const fmtClock = (ms: number): string => {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((safe % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
};

/** SMPTE timecode — "HH:MM:SS:FF" (frame-of-second). P2 display surface.
 *  e.g. 8400ms @ 30fps → "00:00:08:12" (0.4s = 12 frames). */
export const fmtTimecode = (ms: number, fps: number = DEFAULT_FPS): string => {
  const totalFrames = msToFrames(Math.max(0, ms), fps);
  const ff = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
};

/** Ruler tick positions (ms) across `[0, totalMs]`. Step chosen from
 *  {1s, 5s, 10s, 30s, 60s} so the tick count stays ≈6–8. The endpoint is
 *  included when it lands on a step multiple (60000ms @ step 10s →
 *  [0,10000,…,60000], matching the design's 0s/10s/…/1:00 ruler). */
export const rulerTicks = (totalMs: number): number[] => {
  const STEPS_MS = [1000, 5000, 10000, 30000, 60000];
  const TARGET_MAX_TICKS = 8;
  if (totalMs <= 0) return [0];
  const step =
    STEPS_MS.find((s) => totalMs / s <= TARGET_MAX_TICKS) ??
    STEPS_MS[STEPS_MS.length - 1];
  const ticks: number[] = [];
  for (let t = 0; t <= totalMs + 0.5; t += step) ticks.push(t);
  return ticks;
};
