// com.ikenga.studio · Canvas view
//
// Beat × rung storyboard. Mounts @ikenga/contract/canvas (WP-07 commit 16 —
// G-CANVAS: the local stub is gone, this is the real extracted home-page
// Canvas) with a fixed set of mock cells so the view is visually credible
// before the MCP wiring lands. Reads `cellUid` from the shared store for
// selection and writes back on every selection change, which is what makes
// click-to-focus cross-linking light up across panes once the other views
// register their components.
//
// Visual contract: designs/canvas.html (Round 8 / patched Round 9). The
// header chrome (folder path + archetype chip + Reset view + Edit layout)
// is hand-rolled here; the rung gutter (hi-fi / lo-fi / beat sheet) and
// the cells are rendered as canvas items so they pan with the surface.
//
// Anchor bar, render-progress overlays, and the agent activity feed are not
// in scope for this commit.

import { useMemo, useRef, useState } from 'react';

import {
  Canvas,
  type CanvasHandle,
  type ItemId,
  type Placement,
  type Viewport,
} from '@ikenga/contract/canvas';
import '@ikenga/contract/canvas/canvas.css';
import {
  selectCellUid,
  selectHoverBeat,
  selectPlayheadMs,
  useSharedStore,
} from '../shared-state';
import { useProjectStore, selectOpenProject } from '../project-store';
import { SafeZoneBands } from '../media-controls';
import type { AspectRatio } from '../mcp-types';
import type { Rung } from '../mcp-types';
import {
  MOCK_CELLS,
  type CellColor,
  type MockCell,
} from '../__mocks__/cells';
import { clipAtMs } from '../__mocks__/composition';
import { EmptyState } from '../components/EmptyState';

// @ikenga/contract/canvas ships `ItemId` as an opaque branded string but
// (unlike the pre-swap __stubs__/canvas.tsx mirror) does not export a helper
// to brand one — the real Canvas's consumers all mint their own ids from
// already-typed sources. This is the same one-line cast the stub had.
const asItemId = (s: string): ItemId => s as ItemId;

const COLUMN_X = (col: number) => col * 200;
const ROW_Y: Record<Rung, number> = {
  '2_hifi':       0,
  '1_lofi':       180,
  '0_beat_sheet': 360,
};
const CELL_W = 176; // ~w-44 in the design
const CELL_H = 132; // 96 thumb + ~36 footer

// Bias each beat to its own column so the storyboard reads left→right per
// rung. Done here rather than in the cells themselves so the column-walk
// stays a property of the canvas placement, not the entity.
const COLUMN_BY_BEAT: Record<string, number> = {
  hook: 0, problem: 1, agitate: 2, solution: 3, proof: 4, cta: 5,
};

// ─── Rung labels — also canvas items so they pan with the cells ─────────

interface RungLabel {
  kind: 'rung-label';
  id: string;
  text: string;
  rung: Rung;
}

const RUNG_LABELS: RungLabel[] = [
  { kind: 'rung-label', id: 'gutter-2_hifi',       text: 'hi-fi',      rung: '2_hifi'       },
  { kind: 'rung-label', id: 'gutter-1_lofi',       text: 'lo-fi',      rung: '1_lofi'       },
  { kind: 'rung-label', id: 'gutter-0_beat_sheet', text: 'beat sheet', rung: '0_beat_sheet' },
];

// ─── Item discriminator for the Canvas generic ──────────────────────────

type Item =
  | (MockCell & { kind: 'cell' })
  | RungLabel;

const isCell = (item: Item): item is MockCell & { kind: 'cell' } => item.kind === 'cell';

// ─── Per-color thumb tint (matches the design) ──────────────────────────

const THUMB_TINT: Record<CellColor, string> = {
  amber:   'bg-[color-mix(in_oklab,var(--achievement)_18%,var(--bg-raised))]',
  rose:    'bg-[color-mix(in_oklab,var(--danger)_18%,var(--bg-raised))]',
  emerald: 'bg-[color-mix(in_oklab,var(--success,#3dab7f)_18%,var(--bg-raised))]',
  sky:     'bg-[color-mix(in_oklab,var(--info,#5bb3e0)_18%,var(--bg-raised))]',
  violet:  'bg-[color-mix(in_oklab,var(--agent)_18%,var(--bg-raised))]',
  neutral: 'bg-raised',
};

function rungGlyph(rung: Rung): string {
  if (rung === '1_lofi') return '○ ○ ○';
  if (rung === '0_beat_sheet') return '≡ beat sheet';
  return 'cell.html';
}

// Project.aspect_ratio → the inner thumb frame's box style. 9:16 / 1:1 derive
// their width from a fixed thumb height via aspect-ratio (a real portrait /
// square frame — no 16:9 letterbox on a vertical project, contract §8
// commit-14); 16:9 fills the wide thumb area as before.
function aspectFrameStyle(aspect: AspectRatio): React.CSSProperties {
  if (aspect === '9:16') return { height: '100%', aspectRatio: '9 / 16' };
  if (aspect === '1:1') return { height: '100%', aspectRatio: '1 / 1' };
  return { width: '100%', height: '100%' };
}

// ─── View ───────────────────────────────────────────────────────────────

export function CanvasView() {
  const selectedCellUid = useSharedStore(selectCellUid);
  const hoverBeat = useSharedStore(selectHoverBeat);
  const playheadMs = useSharedStore(selectPlayheadMs);
  const setCellUid = useSharedStore((s) => s.setCellUid);
  const setHoverBeat = useSharedStore((s) => s.setHoverBeat);

  // Project aspect drives cell-thumbnail framing + the 9:16 safe-zone overlay
  // (contract §8 commit-14). Defaults to 16:9 in standalone dev where no
  // project is open (the pane region only renders once a project IS open).
  const project = useProjectStore(selectOpenProject);
  const aspect: AspectRatio = project?.aspect_ratio ?? '16:9';
  const isPortrait = aspect === '9:16';

  // Cross-linking §12 — "Composition scrub → playheadMs → Canvas active-cell
  // highlight". Derived, not stored (activeCellAtPlayhead stays a selector,
  // per shared-state.ts's deferred-selector note); shares clipAtMs with
  // Composition so both views agree on the same [start,start+duration) window.
  const activeAtPlayheadUid = clipAtMs(playheadMs)?.uid ?? null;

  const [viewport, setViewport] = useState<Viewport>({ x: 80, y: 30, scale: 0.9 });
  const [editMode, setEditMode] = useState(false);

  // Items + layout are derived from MOCK_CELLS for now; the layout map is
  // local state so dragging in edit mode mutates it (and commit 12's MCP
  // wiring can swap it for a controlled-from-store layout later).

  const items = useMemo<Item[]>(() => {
    const cells: Item[] = MOCK_CELLS.map((c) => ({ ...c, kind: 'cell' as const }));
    return [...RUNG_LABELS, ...cells];
  }, []);

  const [layout, setLayout] = useState<Record<ItemId, Placement>>(() => {
    const map: Record<ItemId, Placement> = {};
    for (const c of MOCK_CELLS) {
      map[asItemId(c.uid)] = {
        x: COLUMN_X(COLUMN_BY_BEAT[c.beat] ?? 0),
        y: ROW_Y[c.rung],
        w: CELL_W,
        h: CELL_H,
      };
    }
    for (const l of RUNG_LABELS) {
      map[asItemId(l.id)] = {
        x: -70,
        y: ROW_Y[l.rung] + 60,
        w: 60,
        h: 14,
      };
    }
    return map;
  });

  const canvasRef = useRef<CanvasHandle | null>(null);
  const selectedId: ItemId | null =
    selectedCellUid ? asItemId(selectedCellUid) : null;

  // Empty-project state (contract §8 commit-13, states-empty.html §1): before
  // any cells materialize from an archetype chain the beat×rung grid is empty.
  if (MOCK_CELLS.length === 0) {
    return (
      <EmptyState
        glyph="▦"
        title="No cells yet"
        hint="cells materialize from an archetype chain — beatsheet → lofi → hifi"
      >
        <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-faint">
          The agent can scaffold the full grid via chat — try{' '}
          <span className="font-mono text-fg-muted">"storyboard a 30s explainer"</span>.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-base text-fg">
      {/* Top chrome — header bar (design: folder path + archetype chip + actions).
          Marked .ikenga-canvas-bar so the canvas stub excludes it from gestures. */}
      <div className="ikenga-canvas-bar flex items-center justify-between gap-2 border-b border-soft bg-sunken px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-2 text-fg-muted">
          <span className="font-mono">~/Projects/retention-explainer/</span>
          <span className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--achievement)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--achievement)_40%,transparent)]">
            studio
          </span>
          <span className="text-fg-faint">·</span>
          <span className="text-fg-faint">archetype</span>
          <span className="font-mono text-fg">explainer</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setViewport({ x: 80, y: 30, scale: 0.9 });
              setCellUid(null);
            }}
            className="rounded px-2 py-1 text-fg-muted hover:bg-raised hover:text-fg"
          >
            Reset view
          </button>
          <button
            type="button"
            onClick={() => canvasRef.current?.autoFit(true)}
            className="rounded px-2 py-1 text-fg-muted hover:bg-raised hover:text-fg"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => setEditMode((m) => !m)}
            className={
              'rounded px-2 py-1 ' +
              (editMode
                ? 'bg-[color-mix(in_oklab,var(--achievement)_20%,transparent)] text-[var(--achievement)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--achievement)_40%,transparent)]'
                : 'text-fg-muted hover:bg-raised hover:text-fg')
            }
          >
            {editMode ? 'Editing layout' : 'Edit layout'}
          </button>
        </div>
      </div>

      {/* Canvas stage */}
      <div className="relative min-h-0 flex-1">
        <Canvas<Item>
          ref={canvasRef}
          items={items}
          itemId={(item) => asItemId(isCell(item) ? item.uid : item.id)}
          itemKind={(item) => (isCell(item) ? 'cell' : 'rung-label')}
          layout={layout}
          viewport={viewport}
          editMode={editMode}
          selectedId={selectedId}
          gridSnap={24}
          autoFitOnResize={false}
          onViewportChange={setViewport}
          onLayoutChange={setLayout}
          onEditModeChange={setEditMode}
          onSelectionChange={(id) => {
            if (id === null) {
              setCellUid(null);
              return;
            }
            // Rung labels are non-selectable — clicking them is a no-op
            // (the canvas stub still fires onSelectionChange; we filter).
            const item = items.find((it) => (isCell(it) ? it.uid : it.id) === id);
            if (!item || !isCell(item)) return;
            setCellUid(item.uid);
          }}
          renderItem={(item, state) => {
            if (!isCell(item)) {
              return (
                <div className="pointer-events-none font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                  {item.text}
                </div>
              );
            }
            const tint = THUMB_TINT[item.color];
            const isRendering = item.progress != null && item.progress < 1;
            // Cross-linking §12 — hoverBeat/playheadMs both carry a cell uid
            // (same value-space cellUid uses): hoverLinked pulses when this
            // cell is hovered in Composition/Script; scrubActive rings when
            // the Composition playhead is inside this cell's window. Distinct
            // from state.isSelected (click-to-focus), which the canvas stub
            // already renders via the achievement outline above.
            const hoverLinked = hoverBeat === item.uid;
            const scrubActive = !state.isSelected && activeAtPlayheadUid === item.uid;
            return (
              <button
                type="button"
                onMouseEnter={() => setHoverBeat(item.uid)}
                onMouseLeave={() => setHoverBeat(null)}
                className={[
                  'cell-card group rounded-md text-left transition-shadow',
                  'border border-[var(--border)] bg-surface hover:shadow-lg',
                  state.isSelected
                    ? 'outline-2 outline outline-offset-2 outline-[var(--achievement)]'
                    : scrubActive
                      ? 'outline-2 outline outline-offset-2 outline-[var(--info,#5bb3e0)]'
                      : '',
                  state.isEditMode
                    ? 'ring-1 ring-dashed ring-[color-mix(in_oklab,var(--achievement)_50%,transparent)]'
                    : '',
                  hoverLinked ? ' is-hover-link' : '',
                ].join(' ')}
                style={{ height: CELL_H }}
              >
                <div className="relative flex h-24 items-center justify-center overflow-hidden rounded-t-md border-b border-[var(--border)] bg-sunken">
                  {/* aspect-framed inner preview — portrait/square derive width
                      from height so a 9:16 project reads as a real vertical
                      frame, not a letterboxed 16:9 thumb. */}
                  <div
                    className={[
                      'relative flex items-center justify-center overflow-hidden',
                      'font-mono text-[10px] text-fg-muted',
                      isPortrait ? 'rounded-sm' : '',
                      tint,
                    ].join(' ')}
                    style={aspectFrameStyle(aspect)}
                  >
                    {rungGlyph(item.rung)}
                    {/* 9:16 action-safe / caption-safe bands (F4) */}
                    {isPortrait && <SafeZoneBands />}
                    {isRendering && (
                      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--bg-sunken)]">
                        <div
                          className="h-full bg-[var(--info,#5bb3e0)]"
                          style={{ width: `${(item.progress ?? 0) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {isRendering && (
                    <div className="absolute right-1.5 top-1.5 flex items-center gap-1 font-mono text-[9px] text-[var(--info,#5bb3e0)]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--info,#5bb3e0)]" />
                      {Math.round((item.progress ?? 0) * 100)}%
                    </div>
                  )}
                  {isPortrait && (
                    <span className="absolute left-1 top-1 rounded border border-[var(--beat-accent-sky-border)] bg-[var(--beat-accent-sky-soft)] px-1 py-px font-mono text-[7px] uppercase tracking-wider text-[var(--info,#5bb3e0)]">
                      9:16
                    </span>
                  )}
                </div>
                <div className="px-2 py-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] font-medium text-fg">{item.beat}</span>
                    {item.approved && (
                      <span
                        aria-label="approved"
                        className="font-mono text-[10px] text-[var(--success,#3dab7f)]"
                      >
                        ✓
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-fg-faint">{item.uid}</div>
                </div>
              </button>
            );
          }}
        />

        {/* Viewport HUD (out of the transformed space; bottom-left mono ms-style readout). */}
        <div className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] text-fg-faint">
          pan {Math.round(viewport.x)}, {Math.round(viewport.y)} · scale {viewport.scale.toFixed(2)}
        </div>
      </div>
    </div>
  );
}
