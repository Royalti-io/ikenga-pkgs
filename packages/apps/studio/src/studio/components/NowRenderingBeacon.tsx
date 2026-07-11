// com.ikenga.studio · NowRenderingBeacon
//
// The layout-independent "now rendering" affordance (contract §8 commit-12,
// interactions-crosslink.html §4 "Now-rendering beacon"). A floating badge
// anchored bottom-right of the whole iframe (fixed positioning) that surfaces
// whenever any cell has a render in flight — visible in ANY view / layout,
// because it lives in App chrome, not inside a pane.
//
// Render state is a MOCK for P1 (contract §9 — the real render lifecycle wires
// at Wave 2 over the MCP `render.*` surface): the running cell is derived from
// the composition timeline's `status === 'running'` clip, the same fixture the
// Composition view scrubs. When the real MCP lands this hook swaps to the
// `render/progress` event channel without the beacon UI changing.
//
// Click writes `cellUid` (the focus jump, cross-link §12) and, if no visible
// pane is currently showing a view that surfaces the cell (Canvas / Cell /
// Composition), switches the focused pane to the Cell editor so the jump is
// actually visible — "sets cellUid, and view if needed".
//
// Colour: rendering-status → --info (§5 / G-02). The `,#5bb3e0` fallback is
// tolerated until the --info token lands upstream (same as Canvas/Cell); drop
// it then.

import { useMemo } from 'react';

import { COMPOSITION_TIMELINE, type TimelineClip } from '../__mocks__/composition';
import { buildTimelineModel } from '../lib/composition-model';
import { useLayoutStore } from '../layout-store';
import { LAYOUTS } from '../routes';
import { useSharedStore } from '../shared-state';
import {
  useStoryboardStore,
  selectHasRealCells,
  selectHydratedCells,
  selectHydratedProject,
  selectRenderStatus,
} from '../storyboard-store';

/** The cell whose render is currently in flight, or null. Real mode reads the
 *  live render-status map (fed by the App-level render.list poll) folded onto
 *  the hydrated timeline, so the beacon references a REAL cell uid (or is absent
 *  when nothing is rendering) — never the mock c04. Standalone/mock keeps the
 *  static mock-timeline derivation. */
function useRunningCell(): TimelineClip | null {
  const hasRealCells = useStoryboardStore(selectHasRealCells);
  const hydratedCells = useStoryboardStore(selectHydratedCells);
  const projectDoc = useStoryboardStore(selectHydratedProject);
  const renderStatus = useStoryboardStore(selectRenderStatus);
  return useMemo(() => {
    const clips = hasRealCells
      ? buildTimelineModel(hydratedCells, projectDoc, renderStatus).clips
      : COMPOSITION_TIMELINE;
    return clips.find((c) => c.status === 'running') ?? null;
  }, [hasRealCells, hydratedCells, projectDoc, renderStatus]);
}

const INFO = 'var(--info,#5bb3e0)';

export function NowRenderingBeacon() {
  const running = useRunningCell();
  const setCellUid = useSharedStore((s) => s.setCellUid);
  const setPlayheadMs = useSharedStore((s) => s.setPlayheadMs);

  if (!running) return null;

  const jumpToRunningCell = () => {
    setCellUid(running.uid);
    // Scrub the composition playhead onto the cell too, so a Composition pane
    // reflects the jump even without a dedicated Cell pane.
    setPlayheadMs(running.start_ms);

    // "view if needed": only re-target a pane when nothing visible already
    // surfaces the selected cell. Canvas (grid), Cell (editor), and
    // Composition (timeline) all show/track cellUid; Script/Archetype don't.
    const { layout, paneViews, focusedPane, setPaneView } = useLayoutStore.getState();
    const visiblePaneCount = LAYOUTS[layout].panes;
    const SURFACES_CELL = new Set(['canvas', 'cell', 'composition']);
    let anyVisibleSurfacesCell = false;
    for (let i = 0; i < visiblePaneCount; i++) {
      if (SURFACES_CELL.has(paneViews[i as 0 | 1 | 2])) {
        anyVisibleSurfacesCell = true;
        break;
      }
    }
    if (!anyVisibleSurfacesCell) {
      setPaneView(focusedPane, 'cell');
    }
  };

  return (
    <button
      type="button"
      onClick={jumpToRunningCell}
      aria-label={`Now rendering ${running.beat} — cell ${running.uid}. Jump to it.`}
      className="now-rendering-beacon"
      style={{
        position: 'fixed',
        bottom: 'var(--space-4, 1rem)',
        right: 'var(--space-4, 1rem)',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3, 0.75rem)',
        maxWidth: '18rem',
        padding: 'var(--space-3, 0.6rem) var(--space-4, 0.9rem)',
        borderRadius: 'var(--radius-lg, 0.75rem)',
        border: `1px solid ${INFO}`,
        background: 'var(--bg-raised)',
        boxShadow: 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.35))',
        cursor: 'pointer',
        color: 'var(--fg)',
      }}
    >
      {/* Pinging status dot — rendering-status (--info). Motion is disabled
          under prefers-reduced-motion (commit-15 global rule). */}
      <span
        aria-hidden="true"
        style={{ position: 'relative', display: 'inline-flex', width: 12, height: 12, flexShrink: 0 }}
      >
        <span
          className="beacon-ping"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '9999px',
            background: INFO,
            opacity: 0.7,
          }}
        />
        <span
          style={{
            position: 'relative',
            display: 'inline-flex',
            width: 12,
            height: 12,
            borderRadius: '9999px',
            background: INFO,
          }}
        />
      </span>
      <span style={{ textAlign: 'left', minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-micro, 10px)',
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            color: 'var(--fg-faint)',
          }}
        >
          Now rendering
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 'var(--text-body-sm, 13px)',
            fontWeight: 600,
            color: 'var(--fg)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {running.beat}{' '}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 10px)', color: INFO }}>
            {running.uid}
          </span>
        </span>
      </span>
      {/* target glyph — echoes the design's crosshair "jump" affordance */}
      <span aria-hidden="true" style={{ color: INFO, fontSize: 14, flexShrink: 0 }}>
        ⌖
      </span>
    </button>
  );
}
