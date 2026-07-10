// com.ikenga.studio · engine player seam (DEC-5 / G-ENGINE-SEAM)
//
// The imperative contract the transport drives (contract §4). The DS owns all
// chrome; the engine render surface is a black box. In P1 the surface is a
// rAF-driven MOCK — but the SEAM is real: the transport calls play/pause/
// seekTo imperatively and advances the playhead by subscribing `frameupdate`
// (fires every frame), NOT a drifting setInterval and NOT a throttled
// timeupdate. When the HF <hyperframes-player> mounts (P2), it implements this
// same PlayerHandle by forwarding its native frameupdate — the transport code
// does not change.
//
// SINGLE SEEK AUTHORITY: seekTo is the only way the position jumps; it emits a
// frameupdate so every subscriber (the store) converges. The play loop is the
// only OTHER writer, via the same frameupdate channel. No third writer.

import { DEFAULT_FPS, msToFrames } from './time';

export interface PlayerHandle {
  readonly fps: number;
  readonly totalFrames: number;
  play(): void;
  pause(): void;
  /** Frame-addressed seek. Clamped to [0, totalFrames]. Emits frameupdate. */
  seekTo(frame: number): void;
  isPlaying(): boolean;
  getFrame(): number;
  setLoop(loop: boolean): void;
  /** Fires every animation frame while playing, and once on every seek. */
  onFrameUpdate(cb: (frame: number) => void): () => void;
  onPlayStateChange(cb: (playing: boolean) => void): () => void;
  destroy(): void;
}

export interface MockPlayerOptions {
  totalFrames: number;
  fps?: number;
  loop?: boolean;
}

/** rAF-driven stand-in for the HF player. Advances by wall-clock delta from
 *  the play anchor (no per-tick accumulation → no drift). */
export function createMockPlayer(opts: MockPlayerOptions): PlayerHandle {
  const fps = opts.fps ?? DEFAULT_FPS;
  const totalFrames = Math.max(0, Math.round(opts.totalFrames));

  let currentFrame = 0;
  let playing = false;
  let loop = opts.loop ?? false;
  let rafId: number | null = null;
  let anchorMs = 0; // performance.now() when the current play run started
  let anchorFrame = 0; // frame at anchorMs

  const frameSubs = new Set<(frame: number) => void>();
  const playSubs = new Set<(playing: boolean) => void>();

  const emitFrame = () => frameSubs.forEach((cb) => cb(currentFrame));
  const emitPlay = () => playSubs.forEach((cb) => cb(playing));

  const now = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  const clampFrame = (f: number) => Math.min(totalFrames, Math.max(0, f));

  const cancelRaf = () => {
    if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rafId);
    }
    rafId = null;
  };

  const tick = () => {
    if (!playing) return;
    const elapsedMs = now() - anchorMs;
    const next = anchorFrame + msToFrames(elapsedMs, fps);
    if (next >= totalFrames) {
      if (loop) {
        currentFrame = 0;
        anchorMs = now();
        anchorFrame = 0;
        emitFrame();
        rafId = requestAnimationFrame(tick);
      } else {
        currentFrame = totalFrames;
        emitFrame();
        stop();
      }
      return;
    }
    if (next !== currentFrame) {
      currentFrame = next;
      emitFrame();
    }
    rafId = requestAnimationFrame(tick);
  };

  function start() {
    if (playing) return;
    // Restart from 0 if parked at the end.
    if (currentFrame >= totalFrames) currentFrame = 0;
    playing = true;
    anchorMs = now();
    anchorFrame = currentFrame;
    emitPlay();
    if (typeof requestAnimationFrame !== 'undefined') {
      rafId = requestAnimationFrame(tick);
    }
  }

  function stop() {
    if (!playing) return;
    playing = false;
    cancelRaf();
    emitPlay();
  }

  return {
    fps,
    totalFrames,
    play: start,
    pause: stop,
    seekTo(frame: number) {
      currentFrame = clampFrame(Math.round(frame));
      if (playing) {
        anchorMs = now();
        anchorFrame = currentFrame;
      }
      emitFrame();
    },
    isPlaying: () => playing,
    getFrame: () => currentFrame,
    setLoop(next: boolean) {
      loop = next;
    },
    onFrameUpdate(cb) {
      frameSubs.add(cb);
      return () => frameSubs.delete(cb);
    },
    onPlayStateChange(cb) {
      playSubs.add(cb);
      return () => playSubs.delete(cb);
    },
    destroy() {
      cancelRaf();
      frameSubs.clear();
      playSubs.clear();
      playing = false;
    },
  };
}
