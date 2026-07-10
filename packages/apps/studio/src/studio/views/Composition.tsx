// com.ikenga.studio · Composition view
//
// The whole-video preview: proportional clip segments on a timeline, a
// transport that drives the engine imperatively, click-to-jump + drag-scrub,
// narration word-highlight, transition markers, a synthetic waveform, and the
// HF/Remotion engine toggle (Remotion visually locked to P2).
//
// Design bar: plans/studio/designs/composition.html +
// plans/studio-design-system/designs/composition-broadcast-dense.html (D-01,
// broadcast-dense editor's cockpit). Contract: 13-wp07-resume-contract.md §8
// row 8 (§2/§3/§4/§5).
//
// Engine seam (§4): the transport calls playerRef.play/pause/seekTo; the play
// loop advances playheadMs by subscribing the player's `frameupdate` (NOT a
// setInterval). The scrubber is the SINGLE SEEK AUTHORITY — it writes via
// seekTo(msToFrames(snapMsToFrame(ms))); the play loop is the only other
// writer, through the same frameupdate channel. In P1 the player is a
// rAF-driven mock (lib/player); the HF <hyperframes-player> implements the same
// PlayerHandle in P2 and this code is unchanged.

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  TransportBar,
  TimeRuler,
  ScrubberPlayhead,
  PlayheadEcho,
  PreviewSurface,
  PreviewStatus,
} from '../media-controls';
import { createMockPlayer, type PlayerHandle } from '../lib/player';
import {
  DEFAULT_FPS,
  framesToMs,
  msToFrames,
  snapMsToFrame,
} from '../lib/time';
import {
  clipAtMs,
  COMPOSITION_META,
  COMPOSITION_NARRATION,
  COMPOSITION_TIMELINE,
  COMPOSITION_TOTAL_MS,
  WAVEFORM_BARS,
  WAVEFORM_BAR_COUNT,
  type TimelineClip,
} from '../__mocks__/composition';
import {
  selectCellUid,
  selectEngineMode,
  selectHoverBeat,
  selectPlayheadMs,
  useSharedStore,
} from '../shared-state';

const FPS = DEFAULT_FPS;
const TOTAL_MS = COMPOSITION_TOTAL_MS;
const SEED_MS = 8_400; // design fixture snapshot — c02 problem active

// ─── Inline icons for the transport right slot ───────────────────────────

const IconWand = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M16 21h5v-5" />
  </svg>
);
const IconExport = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export function CompositionView() {
  const playheadMs = useSharedStore(selectPlayheadMs);
  const cellUid = useSharedStore(selectCellUid);
  const hoverBeat = useSharedStore(selectHoverBeat);
  const engineMode = useSharedStore(selectEngineMode);
  const setPlayheadMs = useSharedStore((s) => s.setPlayheadMs);
  const setCellUid = useSharedStore((s) => s.setCellUid);
  const setHoverBeat = useSharedStore((s) => s.setHoverBeat);
  const setEngineMode = useSharedStore((s) => s.setEngineMode);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [musicPreset, setMusicPreset] = useState('upbeat-tech');

  // Mirror of `loop` so a fresh player (StrictMode remount) inherits it.
  const loopRef = useRef(loop);
  loopRef.current = loop;

  // ── Engine player seam ──────────────────────────────────────────────────
  // The HF <hyperframes-player> would replace createMockPlayer in P2 behind the
  // same PlayerHandle. Subscriptions are the ONLY writers of playheadMs.
  //
  // The player is created INSIDE the effect (not the render body) so React
  // StrictMode's mount→unmount→mount cycle — which the dev shell runs — rebuilds
  // a fresh, subscribed player on every remount instead of leaving a destroyed
  // one behind.
  const playerRef = useRef<PlayerHandle | null>(null);

  useEffect(() => {
    const player = createMockPlayer({
      totalFrames: msToFrames(TOTAL_MS, FPS),
      fps: FPS,
    });
    playerRef.current = player;
    player.setLoop(loopRef.current);
    const offFrame = player.onFrameUpdate((frame) => {
      setPlayheadMs(framesToMs(frame, FPS));
    });
    const offPlay = player.onPlayStateChange(setPlaying);
    // Seed to the design snapshot on a fresh timeline; otherwise re-sync the
    // fresh player to wherever the shared playhead already is.
    const startMs = useSharedStore.getState().playheadMs || SEED_MS;
    player.seekTo(msToFrames(snapMsToFrame(startMs, FPS), FPS));
    return () => {
      offFrame();
      offPlay();
      player.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Seek authority + transport handlers ─────────────────────────────────
  const seekMs = (ms: number) => {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(msToFrames(snapMsToFrame(ms, FPS), FPS));
  };
  const onSelectMs = (ms: number) => {
    const clip = clipAtMs(ms);
    if (clip) setCellUid(clip.uid);
  };
  // The scrubber overlay (.scrubber, z-index 10) sits on top of the entire
  // timeline-rail, so real pointer hover never reaches the underlying
  // .clip-segment elements' onMouseEnter/onMouseLeave (contract-review
  // finding — verified via elementFromPoint). Re-derive hoverBeat from the
  // scrubber's own position-in-ms pass-through instead, using the same
  // clipAtMs lookup the click-to-select path already relies on.
  const onHoverMs = (ms: number | null) => {
    setHoverBeat(ms !== null ? (clipAtMs(ms)?.uid ?? null) : null);
  };
  const playToggle = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying()) p.pause();
    else p.play();
  };
  const stepFrames = (delta: number) => {
    seekMs(framesToMs(msToFrames(playheadMs, FPS) + delta, FPS));
  };
  const loopToggle = () => {
    const next = !loop;
    setLoop(next);
    playerRef.current?.setLoop(next);
  };
  const onClipClick = (clip: TimelineClip) => {
    setCellUid(clip.uid);
    seekMs(clip.start_ms);
  };

  // ── Derived state ───────────────────────────────────────────────────────
  const activeClip = clipAtMs(playheadMs);
  const activeWord = COMPOSITION_NARRATION.words.find(
    (w) => playheadMs >= w.start_ms && playheadMs < w.end_ms,
  );
  const renderedCount = COMPOSITION_TIMELINE.filter((c) => c.status === 'done').length;
  const playheadPct = Math.min(100, Math.max(0, (playheadMs / TOTAL_MS) * 100));

  // All 6 RenderStatus values (contract §6 — no 'idle', that's UI-local to
  // the Cell editor only) get a distinct clip-segment treatment; `undefined`
  // (no render record yet) is the 7th, UI-local "pending" state.
  const clipStateClass = (c: TimelineClip): string => {
    if (c.status === 'running') return ' is-rendering';
    if (c.status === 'queued') return ' is-queued';
    if (c.status === 'done') return ' is-done';
    if (c.status === 'failed') return ' is-failed';
    if (c.status === 'cancelled') return ' is-cancelled';
    if (c.status === undefined) return ' is-pending';
    return '';
  };
  const clipGlyph = (c: TimelineClip): string | null => {
    if (c.status === 'running') return '◐';
    if (c.status === 'queued' || c.status === undefined) return '○';
    if (c.status === 'done') return '✓';
    if (c.status === 'failed') return '⚠';
    if (c.status === 'cancelled') return '✕';
    return null;
  };

  // Words that belong to the active clip's time window (for the preview).
  const previewWords = useMemo(() => {
    if (!activeClip) return [];
    return COMPOSITION_NARRATION.words.filter(
      (w) =>
        w.start_ms >= activeClip.start_ms &&
        w.end_ms <= activeClip.start_ms + activeClip.duration_ms,
    );
  }, [activeClip]);

  const rightSlot = (
    <>
      <select
        className="input"
        style={{ height: 24, fontSize: 'var(--text-micro)', width: 'auto', padding: '0 var(--space-2)' }}
        aria-label="Music preset"
        value={musicPreset}
        onChange={(e) => setMusicPreset(e.target.value)}
      >
        <option value="upbeat-tech">music: upbeat-tech</option>
        <option value="calm-narrative">music: calm-narrative</option>
        <option value="none">music: none</option>
      </select>
      <button type="button" className="btn btn-sm btn-ghost" aria-label="Re-render all cells">
        <IconWand />
        Re-render all
      </button>
      <button
        type="button"
        className="btn btn-sm"
        aria-label="Export composition"
        style={{
          background: 'var(--beat-accent-amber-soft)',
          borderColor: 'var(--beat-accent-amber-border)',
          color: 'var(--beat-accent-amber)',
        }}
      >
        <IconExport />
        Export
      </button>
    </>
  );

  // Empty edge state (contract §8 commit-13, states-empty.html parity): no
  // cells have materialized on the timeline yet (pre archetype.instantiate,
  // or a freshly-created project). Matches Script.tsx's existing empty-state
  // convention for visual consistency across sub-views.
  if (COMPOSITION_TIMELINE.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-base p-8 text-center">
        <span className="font-display text-sm text-fg-muted">Nothing to play yet</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
          render cells to populate the timeline
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-base" data-workspace="studio">
      <div className="composition-frame m-2">
        {/* Engine sub-tabs */}
        <div className="engine-tabs-row">
          <div className="seg" role="tablist" aria-label="Engine view">
            <button
              type="button"
              className={engineMode === 'hf' ? 'is-on' : ''}
              role="tab"
              aria-selected={engineMode === 'hf'}
              onClick={() => setEngineMode('hf')}
            >
              HF Player
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={false}
              disabled
              title="Remotion Studio — Phase 2"
              aria-label="Remotion Studio, Phase 2 (locked)"
            >
              Remotion Studio <span className="engine-badge">P2</span>
            </button>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-micro)',
              color: 'var(--fg-faint)',
              letterSpacing: '.04em',
            }}
          >
            {COMPOSITION_META.name} · {COMPOSITION_META.aspect} · {COMPOSITION_META.resolution.w}×
            {COMPOSITION_META.resolution.h}
          </div>
        </div>

        {/* Transport bar */}
        <TransportBar
          playing={playing}
          onPlayToggle={playToggle}
          onStepBack={() => stepFrames(-1)}
          onStepForward={() => stepFrames(1)}
          loop={loop}
          onLoopToggle={loopToggle}
          currentMs={playheadMs}
          totalMs={TOTAL_MS}
          fps={FPS}
          counterLabel={`${renderedCount}/${COMPOSITION_TIMELINE.length} cells rendered`}
          rightSlot={rightSlot}
        />

        {/* Preview surface — frames the engine black box */}
        <PreviewSurface
          status={
            !activeClip
              ? 'ready'
              : activeClip.status === 'done'
                ? 'ready'
                : activeClip.status === 'running'
                  ? 'rendering'
                  : activeClip.status === 'queued'
                    ? 'queued'
                    : activeClip.status === 'failed'
                      ? 'failed'
                      : activeClip.status === 'cancelled'
                        ? 'cancelled'
                        : 'pending'
          }
          ariaLabel={
            activeClip
              ? `Composition preview — cell ${activeClip.uid} ${activeClip.beat}`
              : 'Composition preview — end of composition'
          }
        >
          {!activeClip ? (
            <div className="preview-status">
              <span className="preview-status-text">— end of composition —</span>
            </div>
          ) : activeClip.status === 'done' ? (
            <div style={{ textAlign: 'center' }}>
              <div
                className="preview-cell-label"
                style={{ color: `var(--beat-accent-${activeClip.accent})` }}
                aria-hidden="true"
              >
                {activeClip.uid} · {activeClip.beat}
              </div>
              <div className="preview-narration">
                {previewWords.length > 0 ? (
                  previewWords.map((w, i) => {
                    const isActive = activeWord?.word === w.word && activeWord?.start_ms === w.start_ms;
                    const isPast = playheadMs >= w.end_ms;
                    return (
                      <span
                        key={`${w.word}-${w.start_ms}`}
                        className={
                          'preview-word' + (isActive ? ' is-active' : isPast ? ' is-past' : '')
                        }
                      >
                        {w.word}
                      </span>
                    );
                  })
                ) : (
                  <span className="preview-word is-active">{activeClip.beat}</span>
                )}
              </div>
              <div className="preview-engine-note">
                &lt;hyperframes-player&gt; · {activeClip.uid}.content.html · HF rung{' '}
                {COMPOSITION_META.rung}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <div
                className="preview-cell-label"
                style={{ color: `var(--beat-accent-${activeClip.accent})` }}
                aria-hidden="true"
              >
                {activeClip.uid} · {activeClip.beat}
              </div>
              <PreviewStatus
                glyph={
                  activeClip.status === 'running'
                    ? '◐'
                    : activeClip.status === 'failed'
                      ? '⚠'
                      : activeClip.status === 'cancelled'
                        ? '✕'
                        : '○'
                }
                text={activeClip.status ?? 'pending'}
                action={
                  activeClip.status === 'failed' ? (
                    // Local-only for now — same "not yet MCP-wired" stage as
                    // the "Re-render all" button above (Wave 3 lights up
                    // render.retry against the real MCP server).
                    <button type="button" className="btn btn-sm btn-ghost" aria-label={`Retry render for ${activeClip.uid}`}>
                      ↺ Retry
                    </button>
                  ) : undefined
                }
              />
            </div>
          )}
        </PreviewSurface>

        {/* Timeline section */}
        <div className="timeline-section">
          <TimeRuler totalMs={TOTAL_MS} fps={FPS} />

          {/* Timeline rail — proportional clip segments + scrubber overlay */}
          <div
            className="timeline-rail"
            style={{ ['--total-ms' as string]: String(TOTAL_MS) }}
            role="presentation"
          >
            {COMPOSITION_TIMELINE.map((c, i) => {
              const flexBasis = `${(c.duration_ms / TOTAL_MS) * 100}%`;
              const prev = i > 0 ? COMPOSITION_TIMELINE[i - 1] : null;
              const showMarker = c.transition && c.transition !== 'cut' && prev;
              const selected =
                c.uid === cellUid || c.uid === activeClip?.uid ? ' is-selected' : '';
              // Cross-linking §12 — hoverBeat carries the hovered cell's uid
              // (same value-space cellUid uses); hovering this clip in Canvas
              // or Script pulses the matching segment here, and vice versa.
              const hoverLinked = hoverBeat === c.uid ? ' is-hover-link' : '';
              const glyph = clipGlyph(c);
              return (
                <div
                  key={c.uid}
                  className={`clip-segment${clipStateClass(c)}${selected}${hoverLinked}`}
                  data-accent={c.accent}
                  role="button"
                  tabIndex={0}
                  aria-label={`${c.beat} cell, ${c.status ?? 'pending'}, ${Math.round(c.duration_ms / 1000)} seconds`}
                  style={{ flexBasis }}
                  onClick={() => onClipClick(c)}
                  // Real pointer hover is driven by the scrubber overlay's
                  // onHoverMs pass-through above (the overlay sits on top of
                  // this element and would otherwise swallow mouse events —
                  // see onHoverMs). onFocus/onBlur keep the same hover-link
                  // pulse working for keyboard users tabbing onto the clip.
                  onFocus={() => setHoverBeat(c.uid)}
                  onBlur={() => setHoverBeat(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onClipClick(c);
                    }
                  }}
                >
                  {showMarker && (
                    <div
                      className="transition-marker"
                      data-transition={c.transition}
                      style={{
                        background: `linear-gradient(to right, var(--beat-accent-${prev!.accent}-soft) 0%, transparent 70%)`,
                      }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="clip-segment__label">{c.beat}</span>
                  {glyph && (
                    <span className="clip-segment__glyph" aria-hidden="true">
                      {glyph}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Scrubber / playhead — single seek authority */}
            <ScrubberPlayhead
              currentMs={playheadMs}
              totalMs={TOTAL_MS}
              fps={FPS}
              onSeekMs={seekMs}
              onSelectMs={onSelectMs}
              onHoverMs={onHoverMs}
            />
          </div>

          {/* Narration waveform + playhead echo */}
          <div
            className="waveform-strip"
            role="img"
            aria-label={`Narration waveform — ${COMPOSITION_NARRATION.audio.uri}`}
            style={{ ['--bar-count' as string]: String(WAVEFORM_BAR_COUNT) }}
          >
            <span className="waveform-strip__label" aria-hidden="true">
              {COMPOSITION_NARRATION.audio.uri}
            </span>
            {WAVEFORM_BARS.map((h, i) => {
              const barMid = ((i + 0.5) / WAVEFORM_BAR_COUNT) * TOTAL_MS;
              const barStart = (i / WAVEFORM_BAR_COUNT) * TOTAL_MS;
              const played = barStart < playheadMs;
              const active =
                playheadMs >= (i / WAVEFORM_BAR_COUNT) * TOTAL_MS &&
                playheadMs < ((i + 1) / WAVEFORM_BAR_COUNT) * TOTAL_MS;
              void barMid;
              return (
                <div
                  key={i}
                  className={`waveform-bar${active ? ' is-active' : played ? ' is-played' : ''}`}
                  style={{ ['--bar-h' as string]: `${h}%` }}
                />
              );
            })}
            <PlayheadEcho leftPct={playheadPct} />
          </div>

          {/* Word strip */}
          <div className="word-strip" aria-hidden="true">
            {COMPOSITION_NARRATION.words.map((w) => {
              const isActive = activeWord?.word === w.word && activeWord?.start_ms === w.start_ms;
              const isPast = playheadMs >= w.end_ms;
              return (
                <span
                  key={`${w.word}-${w.start_ms}`}
                  className={
                    'word-strip-word' + (isActive ? ' is-active' : isPast ? ' is-past' : '')
                  }
                >
                  {w.word}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
