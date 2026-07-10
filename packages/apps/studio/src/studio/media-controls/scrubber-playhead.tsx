// media-controls · 41 · scrubber-playhead   @promote-candidate
//
// Dependency-free, ZERO studio-domain imports (React + the pure `../lib/time`
// foundation). The scrubber is an absolutely-positioned overlay that fills its
// positioned parent (the timeline-rail); pointer drag + arrow keys translate
// to a single `onSeekMs(ms)` callback — the SINGLE SEEK AUTHORITY (contract
// §4). The consumer snaps to frame and drives the engine's seekTo; this
// component never mutates the playhead position itself.
//
// Class API (studio-editor layer): .scrubber (role="slider") · .playhead /
// .playhead-cap · .playhead--echo

import { useRef } from 'react';

import { framesToMs, msToFrames, fmtClock, DEFAULT_FPS } from '../lib/time';

// ─── Playhead line (rail) ─────────────────────────────────────────────────

export interface PlayheadProps {
  /** 0–100 — position across the rail. */
  leftPct: number;
}

export function Playhead({ leftPct }: PlayheadProps) {
  return (
    <div className="playhead" style={{ left: `${leftPct}%` }}>
      <div className="playhead-cap" aria-hidden="true" />
    </div>
  );
}

/** Dimmed echo of the playhead for secondary tracks (waveform). */
export function PlayheadEcho({ leftPct }: PlayheadProps) {
  return (
    <div className="playhead--echo" style={{ left: `${leftPct}%` }} aria-hidden="true" />
  );
}

// ─── Scrubber (interactive seek overlay) ──────────────────────────────────

export interface ScrubberPlayheadProps {
  currentMs: number;
  totalMs: number;
  /** Single seek authority. Fires on click AND throughout a drag. The
   *  consumer snaps to frame + drives the engine's seekTo. */
  onSeekMs: (ms: number) => void;
  /** Fired once on a discrete click (pointer down+up with no meaningful
   *  drag). Lets the consumer ALSO focus the clip under the click without a
   *  drag continuously re-selecting. Playback never triggers this. */
  onSelectMs?: (ms: number) => void;
  fps?: number;
  /** Overrides the default fmtClock(currentMs) announcement. */
  ariaValueText?: string;
  ariaLabel?: string;
}

/** px of pointer travel below which a press counts as a click, not a drag. */
const CLICK_SLOP_PX = 4;

export function ScrubberPlayhead({
  currentMs,
  totalMs,
  onSeekMs,
  onSelectMs,
  fps = DEFAULT_FPS,
  ariaValueText,
  ariaLabel = 'Playhead position',
}: ScrubberPlayheadProps) {
  const ref = useRef<HTMLDivElement>(null);
  const downXRef = useRef<number | null>(null);
  const draggedRef = useRef(false);
  const denom = totalMs > 0 ? totalMs : 1;
  const leftPct = Math.min(100, Math.max(0, (currentMs / denom) * 100));

  const msFromClientX = (clientX: number): number | null => {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.min(totalMs, Math.max(0, ratio * totalMs));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    downXRef.current = e.clientX;
    draggedRef.current = false;
    const ms = msFromClientX(e.clientX);
    if (ms !== null) onSeekMs(ms);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only track while the pointer is captured (i.e. mid-drag).
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (downXRef.current !== null && Math.abs(e.clientX - downXRef.current) > CLICK_SLOP_PX) {
      draggedRef.current = true;
    }
    const ms = msFromClientX(e.clientX);
    if (ms !== null) onSeekMs(ms);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // A press with no meaningful travel = a click → also focus the clip.
    if (!draggedRef.current) {
      const ms = msFromClientX(e.clientX);
      if (ms !== null) onSelectMs?.(ms);
    }
    downXRef.current = null;
    draggedRef.current = false;
  };

  // Basic frame-stepping — full keyboard map is commit 15; this covers the
  // role="slider" minimum so the scrubber is operable without a pointer.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const frame = msToFrames(currentMs, fps);
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        next = framesToMs(frame - 1, fps);
        break;
      case 'ArrowRight':
        next = framesToMs(frame + 1, fps);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = totalMs;
        break;
      default:
        return;
    }
    e.preventDefault();
    onSeekMs(Math.min(totalMs, Math.max(0, next)));
  };

  return (
    <div
      ref={ref}
      className="scrubber"
      role="slider"
      tabIndex={0}
      aria-valuemin={0}
      aria-valuemax={Math.round(totalMs)}
      aria-valuenow={Math.round(currentMs)}
      aria-valuetext={ariaValueText ?? fmtClock(currentMs)}
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <Playhead leftPct={leftPct} />
    </div>
  );
}
