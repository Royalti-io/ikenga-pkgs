// com.ikenga.studio · Script view
//
// The structured script browser (Screen S5 — plans/studio-design-system/
// parts/screens/script.md; no dedicated mockup). A scrollable, beat-ordered
// dense-row list of ScriptBeat rows (VO / action text, beat-accent left
// border, SFX + transition chips, mono duration readout via lib/time's
// fmtClock), plus a native (lightweight, read-only) Fountain renderer
// toggled by a `.seg` mode switch. The Fountain tab is available for EVERY
// archetype (narrative, explainer, commercial, …) — any project may carry a
// `<root>/script.fountain` source (script.md §"Chrome & Navigation").
// Clicking a row publishes `cellUid` + `playheadMs` (snapped to
// the beat's start) into the shared store; hovering publishes `hoverBeat`.
// The active row (driven by `playheadMs` from the outside — e.g. Composition
// scrub) gets an amber left accent, matching script.md's "Script follows
// composition scrub" contract.
//
// Real-project hydration (Wave-3, closes `script-wrong-project-shown`):
// when a real project is open the rows come from the SAME source of truth the
// Composition timeline model uses — `storyboard-store.projectDoc.script.beats`
// + the hydrated cells (via `buildScriptModel`), NOT __mocks__/script.ts. The
// mock is kept ONLY for standalone/mock mode (`hasRealCells === false`), matching
// every other data-driven view post-Wave-1/2. Row clicks publish the REAL cell
// uid (resolved beat_id → uid in the model) so Canvas selects the right cell.
//
// Still deferred (no seam):
// - VO/action editing is read-only — writes go via chat / MCP
//   `storyboard.write_cell` (there is no in-pane script-write seam in P1;
//   Wave-3/4 scope alongside Cell save). Surfaced as an inline read-only hint.
// - VO/action editing is read-only (see above).
//
// Wave-5 (closes the deferred fountain read): Fountain mode for a real
// project of ANY archetype now reads `<project>/script.fountain` over the
// `storyboard.read_fountain` MCP seam and renders the real screenplay
// (read-only). When the project has no `.fountain` on disk it shows an honest
// "no script.fountain" note instead of the mock screenplay. The mock sample is
// kept ONLY for standalone/mock mode.

import { useEffect, useMemo, useState } from 'react';

import { parseFountain, type FountainScene } from '../lib/fountain';
import { fmtClock } from '../lib/time';
import { buildScriptModel, mockScriptRows, type ScriptRowModel } from '../lib/script-model';
import { FOUNTAIN_SAMPLE, SCRIPT_BEATS, SCRIPT_META } from '../__mocks__/script';
import { getMcpClient, storyboardApi } from '../mcp-client';
import {
  selectCellUid,
  selectPlayheadMs,
  useSharedStore,
} from '../shared-state';
import {
  useStoryboardStore,
  selectHasRealCells,
  selectHydratedCells,
  selectHydratedProject,
} from '../storyboard-store';
import { EmptyState } from '../components/EmptyState';

type ScriptMode = 'script' | 'fountain';

function beatAtMs(rows: ScriptRowModel[], ms: number): ScriptRowModel | null {
  return rows.find((b) => ms >= b.start_ms && ms < b.start_ms + b.duration_ms) ?? null;
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
  beat: ScriptRowModel;
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
        `${beat.beatId} — ${Math.round(beat.duration_ms / 1000)}s`
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
          <Chip style={accentChipStyle(beat.accent)}>{beat.beatId}</Chip>
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

  // Real source of truth — the SAME store Canvas/Composition hydrate from.
  const hasRealCells = useStoryboardStore(selectHasRealCells);
  const hydratedCells = useStoryboardStore(selectHydratedCells);
  const projectDoc = useStoryboardStore(selectHydratedProject);
  const refetchStoryboard = useStoryboardStore((s) => s.refetch);

  const [mode, setMode] = useState<ScriptMode>('script');

  // Re-read on mount/focus (POLL-on-demand stand-in for cells/changed — same
  // pattern Canvas/Cell use). No-op until a real project is hydrated.
  useEffect(() => { void refetchStoryboard(); }, [refetchStoryboard]);

  const rows = useMemo(
    () => (hasRealCells ? buildScriptModel(projectDoc?.script, hydratedCells) : mockScriptRows(SCRIPT_BEATS)),
    [hasRealCells, projectDoc, hydratedCells],
  );

  // Header + toggle metadata off the REAL script block when hydrated, else mock.
  const title = hasRealCells ? (projectDoc?.script?.title ?? projectDoc?.title ?? 'script') : SCRIPT_META.title;
  const archetype = hasRealCells ? (projectDoc?.script?.archetype ?? projectDoc?.archetype_id ?? '') : SCRIPT_META.archetype;

  const activeBeat = beatAtMs(rows, playheadMs);

  const scenes = useMemo(() => parseFountain(FOUNTAIN_SAMPLE), []);

  // Real Fountain source (Wave-5): lazily read <project>/script.fountain over
  // the storyboard.read_fountain seam the first time the user switches to
  // Fountain mode on a real narrative project. `exists:false` is an honest
  // "no .fountain on disk" state, NOT an error. Standalone/mock never fetches
  // (it renders the FOUNTAIN_SAMPLE below).
  const [fountain, setFountain] = useState<{
    loading: boolean;
    loaded: boolean;
    exists: boolean;
    text: string;
    error: string | null;
  }>({ loading: false, loaded: false, exists: false, text: '', error: null });

  useEffect(() => {
    if (!(hasRealCells && mode === 'fountain')) return;
    let cancelled = false;
    setFountain((f) => ({ ...f, loading: true, error: null }));
    void (async () => {
      try {
        const client = await getMcpClient();
        const res = await storyboardApi.read_fountain(client);
        if (!cancelled) {
          setFountain({ loading: false, loaded: true, exists: res.exists, text: res.text, error: null });
        }
      } catch (e) {
        if (!cancelled) {
          setFountain({ loading: false, loaded: true, exists: false, text: '', error: (e as Error).message });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [hasRealCells, mode]);

  const realScenes = useMemo(
    () => (fountain.exists && fountain.text ? parseFountain(fountain.text) : []),
    [fountain.exists, fountain.text],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-base text-fg">
      <div className="flex items-center justify-between gap-2 border-b border-soft bg-sunken px-3 py-1.5 text-[11px]">
        <div className="flex min-w-0 items-center gap-2 text-fg-muted">
          <span className="truncate font-mono">{title}</span>
          {archetype && (
            <>
              <span className="text-fg-faint">·</span>
              <span className="font-mono text-fg-faint">{archetype}</span>
            </>
          )}
        </div>
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
      </div>

      {/* Read-only intent (closes the "why can't I type here" gap): edits round-
          trip through chat / MCP storyboard.write_cell, not inline typing. */}
      <div className="border-b border-soft bg-base px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
        read-only · ask your Chi in chat to rewrite a beat
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'fountain' ? (
          hasRealCells ? (
            // Real project (any archetype): render the REAL <project>/script.fountain
            // (read-only) via storyboard.read_fountain; honest note when absent.
            fountain.loading || !fountain.loaded ? (
              <div className="p-3">
                <p className="font-mono text-[11px] text-fg-faint">Loading screenplay…</p>
              </div>
            ) : fountain.error ? (
              <div className="p-3">
                <p className="max-w-md text-[11px] leading-relaxed text-fg-muted">
                  Couldn&rsquo;t read{' '}
                  <span className="font-mono text-fg-faint">{'<project>/script.fountain'}</span>.{' '}
                  <span className="font-mono text-fg-faint">{fountain.error}</span>
                </p>
              </div>
            ) : fountain.exists && realScenes.length > 0 ? (
              <div className="space-y-3 p-3">
                {realScenes.map((scene) => (
                  <FountainSceneCard key={scene.id} scene={scene} />
                ))}
              </div>
            ) : (
              <div className="p-3">
                <p className="max-w-md text-[11px] leading-relaxed text-fg-muted">
                  No{' '}
                  <span className="font-mono text-fg-faint">script.fountain</span>{' '}
                  in this project. The parsed beats are on the Script tab — ask your Chi in chat to draft a screenplay.
                </p>
              </div>
            )
          ) : (
            <div className="space-y-3 p-3">
              {scenes.map((scene) => (
                <FountainSceneCard key={scene.id} scene={scene} />
              ))}
            </div>
          )
        ) : rows.length === 0 ? (
          <EmptyState
            glyph="✍"
            title="No script yet"
            hint="the beat list is written for you, not by hand"
          >
            <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-faint">
              Ask your Chi in the chat dock to draft the script — try{' '}
              <span className="font-mono text-fg-muted">"storyboard a 30s explainer"</span>.
              It writes the beats straight into this project.
            </p>
          </EmptyState>
        ) : (
          <ul role="list" className="divide-y divide-[var(--border-soft)]">
            {rows.map((beat) => (
              <li key={beat.beatId} role="listitem">
                <ScriptRow
                  beat={beat}
                  isSelected={beat.cellUid != null && beat.cellUid === cellUid}
                  isActive={beat.beatId === activeBeat?.beatId}
                  onFocus={() => {
                    if (beat.cellUid) setCellUid(beat.cellUid);
                    setPlayheadMs(beat.start_ms);
                  }}
                  onHover={() => { if (beat.cellUid) setHoverBeat(beat.cellUid); }}
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
