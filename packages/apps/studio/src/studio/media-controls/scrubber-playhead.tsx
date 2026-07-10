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
  /** Single seek authority. The consumer snaps to frame + drives seekTo. */
  onSeekMs: (ms: number) => void;
  fps?: number;
  /** Overrides the default fmtClock(currentMs) announcement. */
  ariaValueText?: string;
  ariaLabel?: string;
}

export function ScrubberPlayhead({
  currentMs,
  totalMs,
  onSeekMs,
  fps = DEFAULT_FPS,
  ariaValueText,
  ariaLabel = 'Playhead position',
}: ScrubberPlayheadProps) {
  const ref = useRef<HTMLDivElement>(null);
  const denom = totalMs > 0 ? totalMs : 1;
  const leftPct = Math.min(100, Math.max(0, (currentMs / denom) * 100));

  const seekFromClientX = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    const ms = Math.min(totalMs, Math.max(0, ratio * totalMs));
    onSeekMs(ms);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only track while the pointer is captured (i.e. mid-drag).
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekFromClientX(e.clientX);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
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
