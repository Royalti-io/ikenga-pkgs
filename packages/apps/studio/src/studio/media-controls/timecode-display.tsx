// media-controls · 42 · timecode-display + time-ruler   @promote-candidate
//
// Dependency-free, ZERO studio-domain imports. The ONLY cross-import is the
// pure time foundation (`../lib/time`, G-TIME-MODEL) — it co-promotes with
// this module as app-kit partial 42. No `fmt()` is re-implemented here
// (contract §3): fmtClock is the single clock formatter.
//
// Class API (studio-editor layer): .timecode / .timecode-current /
// .timecode-sep / .timecode-total · .time-ruler / .time-ruler-tick
// (.is-major/.is-first/.is-last) / .time-ruler-label

import { DEFAULT_FPS, fmtClock, rulerTicks } from '../lib/time';

// ─── Timecode display (C11) ──────────────────────────────────────────────

export interface TimecodeDisplayProps {
  currentMs: number;
  totalMs: number;
  /** Frame rate — reserved for a future SMPTE toggle; the clock readout
   *  itself is fps-independent. Defaults to DEFAULT_FPS. */
  fps?: number;
  className?: string;
}

/** `M:SS.t / M:SS.t` monospace readout. role="status" aria-live="polite" so
 *  the current position is announced as it changes. */
export function TimecodeDisplay({
  currentMs,
  totalMs,
  className,
}: TimecodeDisplayProps) {
  const current = fmtClock(currentMs);
  const total = fmtClock(totalMs);
  return (
    <div
      className={`timecode${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`${current} of ${total}`}
    >
      <span className="timecode-current">{current}</span>
      <span className="timecode-sep" aria-hidden="true">
        /
      </span>
      <span className="timecode-total">{total}</span>
    </div>
  );
}

// ─── Time ruler (C12) ────────────────────────────────────────────────────

export interface TimeRulerProps {
  totalMs: number;
  fps?: number;
  className?: string;
}

/** Cosmetic tick label — distinct from fmtClock (which always shows tenths).
 *  Ruler marks read "10s" under a minute and "M:SS" on minute boundaries,
 *  matching the design's 0s/10s/…/1:00 ruler. Not core time math — purely a
 *  ruler presentation concern. */
function tickLabel(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Proportional tick ruler across [0, totalMs]. Ticks + step come from
 *  `rulerTicks` (lib/time) so the whole app agrees on the grid. aria-hidden —
 *  the timecode + scrubber carry the accessible position. */
export function TimeRuler({ totalMs, className }: TimeRulerProps) {
  const ticks = rulerTicks(totalMs);
  const denom = totalMs > 0 ? totalMs : 1;
  return (
    <div
      className={`time-ruler${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      {ticks.map((ms, i) => {
        const pct = (ms / denom) * 100;
        const isFirst = i === 0;
        const isLast = i === ticks.length - 1 && pct >= 99.5;
        const cls =
          'time-ruler-tick is-major' +
          (isFirst ? ' is-first' : '') +
          (isLast ? ' is-last' : '');
        return (
          <div key={ms} className={cls} style={{ left: `${pct}%` }}>
            <span className="time-ruler-label">{tickLabel(ms)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Re-export so consumers that only need the frame rate constant don't reach
// past the module boundary.
export { DEFAULT_FPS };
