// com.ikenga.studio · Script view
//
// The structured script browser (Screen S5 — plans/studio-design-system/
// parts/screens/script.md; no dedicated mockup). A scrollable, beat-ordered
// dense-row list of ScriptBeat rows (VO / action text, beat-accent left
// border, SFX + transition chips, mono duration readout via lib/time's
// fmtClock), plus a native (lightweight, read-only) Fountain renderer for the
// `narrative` archetype, toggled by a `.seg` mode switch that only appears
// when the project's archetype is `narrative` (script.md §"Chrome &
// Navigation"). Clicking a row publishes `cellUid` + `playheadMs` (snapped to
// the beat's start) into the shared store; hovering publishes `hoverBeat`.
// The active row (driven by `playheadMs` from the outside — e.g. Composition
// scrub) gets an amber left accent, matching script.md's "Script follows
// composition scrub" contract.
//
// What's NOT real yet (commit 12 — cross-link + real MCP):
// - `project.script` is read from __mocks__/script.ts, not storyboard.json.
// - No live subscription to `cells/changed` — the list is static per mount.
// - Read-only in P1: VO/action edits go via chat / MCP `storyboard.write_cell`
//   (script.md §"Don't build a custom VO text editor in P1").

import { useMemo, useState } from 'react';

import { parseFountain, type FountainScene } from '../lib/fountain';
import { fmtClock } from '../lib/time';
import {
  FOUNTAIN_SAMPLE,
  SCRIPT_BEATS,
  SCRIPT_META,
  type MockScriptBeat,
} from '../__mocks__/script';
import {
  selectCellUid,
  selectPlayheadMs,
  useSharedStore,
} from '../shared-state';
import { EmptyState } from '../components/EmptyState';

type ScriptMode = 'script' | 'fountain';

function beatAtMs(ms: number): MockScriptBeat | null {
  return (
    SCRIPT_BEATS.find((b) => ms >= b.start_ms && ms < b.start_ms + b.duration_ms) ?? null
  );
}

// ─── Chip helpers (beat-accent tokens — §5, no raw hex) ──────────────────

function accentChipStyle(accent: string): React.CSSProperties {
  return {
    color: `var(--beat-accent-${accent})`,
    background: `var(--beat-accent-${accent}-soft)`,
    borderColor: `var(--beat-accent-${accent}-border)`,
  };
}

function Chip({
  children,
  style,
  ariaLabel,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset"
      style={style ?? { color: 'var(--fg-muted)', background: 'var(--bg-raised)', borderColor: 'var(--border)' }}
    >
      {children}
    </span>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────

function ScriptRow({
  beat,
  isSelected,
  isActive,
  onFocus,
  onHover,
  onHoverEnd,
}: {
  beat: MockScriptBeat;
  isSelected: boolean;
  isActive: boolean;
  onFocus: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
}) {
  const bodyText = beat.vo ?? beat.action ?? null;
  const overflowSfx = beat.sfx.length > 2 ? beat.sfx.length - 2 : 0;

  return (
    <div
      tabIndex={0}
      role="button"
      aria-current={isActive ? 'true' : undefined}
      aria-label={
        `${beat.uid} ${beat.beat} — ${Math.round(beat.duration_ms / 1000)}s`
        + (bodyText ? ` — ${bodyText}` : '')
      }
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      onClick={onFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onFocus();
        }
      }}
      className={
        'flex cursor-pointer items-start gap-3 border-l-2 px-3 py-2 outline-none transition-colors duration-75 '
        + 'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)] '
        + (isActive ? '' : isSelected ? 'bg-raised' : 'hover:bg-raised/60')
      }
      style={{
        borderLeftColor: isActive ? 'var(--beat-accent-amber)' : `var(--beat-accent-${beat.accent})`,
        background: isActive ? 'var(--beat-accent-amber-soft)' : undefined,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip style={accentChipStyle(beat.accent)}>{beat.beat}</Chip>
          {beat.transition && <Chip style={accentChipStyle('violet')}>{beat.transition}</Chip>}
          {beat.sfx.slice(0, 2).map((s) => (
            <Chip key={s} ariaLabel={`SFX: ${s}`}>{s}</Chip>
          ))}
          {overflowSfx > 0 && (
            <span className="font-mono text-[10px] text-fg-faint">+{overflowSfx}</span>
          )}
        </div>
        <p className="mt-1 truncate text-[12px] text-fg">
          {bodyText ?? <span className="italic text-fg-faint">— no VO —</span>}
        </p>
        {beat.on_screen_text && (
          <p className="mt-0.5 font-mono text-[10px] text-fg-faint">
            on-screen: {beat.on_screen_text}
          </p>
        )}
      </div>
      <span className="shrink-0 font-mono text-[10px] text-fg-faint">
        {fmtClock(beat.duration_ms)}
      </span>
    </div>
  );
}

// ─── Fountain scene card ────────────────────────────────────────────────

function FountainSceneCard({ scene }: { scene: FountainScene }) {
  return (
    <div className="rounded-md border border-soft bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <Chip style={accentChipStyle('rose')}>scene</Chip>
        <span className="font-mono text-[11px] text-fg">{scene.heading}</span>
      </div>
      <div className="space-y-1.5">
        {scene.blocks.map((blk, i) => {
          if (blk.kind === 'transition') {
            return (
              <div key={i} className="text-right font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                {blk.text}
              </div>
            );
          }
          if (blk.kind === 'dialogue') {
            return (
              <div key={i} className="ml-6">
                <div className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  {blk.character}
                </div>
                <div className="text-[12px] text-fg">{blk.text}</div>
              </div>
            );
          }
          return (
            <div key={i} className="text-[12px] text-fg-muted">
              {blk.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── View ───────────────────────────────────────────────────────────────

export function ScriptView() {
  const cellUid = useSharedStore(selectCellUid);
  const playheadMs = useSharedStore(selectPlayheadMs);
  const setCellUid = useSharedStore((s) => s.setCellUid);
  const setPlayheadMs = useSharedStore((s) => s.setPlayheadMs);
  const setHoverBeat = useSharedStore((s) => s.setHoverBeat);

  const [mode, setMode] = useState<ScriptMode>('script');
  const isNarrative = SCRIPT_META.archetype === 'narrative';
  const activeBeat = beatAtMs(playheadMs);

  const scenes = useMemo(() => parseFountain(FOUNTAIN_SAMPLE), []);

  if (SCRIPT_BEATS.length === 0) {
    return (
      <EmptyState
        glyph="✍"
        title="No script yet"
        hint="ask the agent to write a beat list"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-base text-fg">
      <div className="flex items-center justify-between gap-2 border-b border-soft bg-sunken px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-2 text-fg-muted">
          <span className="font-mono">{SCRIPT_META.title}</span>
          <span className="text-fg-faint">·</span>
          <span className="font-mono text-fg-faint">{SCRIPT_META.archetype}</span>
        </div>
        {isNarrative && (
          <div className="seg" role="tablist" aria-label="Script mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'script'}
              className={mode === 'script' ? 'is-on' : ''}
              onClick={() => setMode('script')}
            >
              Script
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'fountain'}
              className={mode === 'fountain' ? 'is-on' : ''}
              onClick={() => setMode('fountain')}
            >
              Fountain
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'fountain' && isNarrative ? (
          <div className="space-y-3 p-3">
            {scenes.map((scene) => (
              <FountainSceneCard key={scene.id} scene={scene} />
            ))}
          </div>
        ) : (
          <ul role="list" className="divide-y divide-[var(--border-soft)]">
            {SCRIPT_BEATS.map((beat) => (
              <li key={beat.uid} role="listitem">
                <ScriptRow
                  beat={beat}
                  isSelected={beat.uid === cellUid}
                  isActive={beat.uid === activeBeat?.uid}
                  onFocus={() => {
                    setCellUid(beat.uid);
                    setPlayheadMs(beat.start_ms);
                  }}
                  onHover={() => setHoverBeat(beat.uid)}
                  onHoverEnd={() => setHoverBeat(null)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
