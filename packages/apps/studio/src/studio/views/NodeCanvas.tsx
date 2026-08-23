/**
 * Node Canvas view (WP-28, Plan 25).
 *
 * Pan/zoom heterogeneous node canvas projecting on-disk storyboard, script,
 * beats, shots, and anchors.
 *
 * ─── Interaction Model (D-25-1 .. D-25-5) ───────────────────────────────────
 * - Sequence Lane (D-25-5): Shots default to horizontal run pinned to Cell.index.
 * - Non-semantic free placement: Dragging a shot outside the lane creates a
 *   visual tether back to its slot without mutating playback index.
 * - Zoom LOD: Renders lightweight icons at low zoom, posters at mid zoom,
 *   full interactive controls at high zoom.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { Canvas, type ItemId, type Placement, type Viewport, type ItemRenderState } from '@ikenga/contract/canvas';

import { useStoryboardStore, selectHydratedCells, selectHydratedProject, selectRenderStatus } from '../storyboard-store';
import { useProjectStore, selectOpenProject } from '../project-store';
import { useAnchorsStore, selectAnchors } from '../anchors-store';
import { useSharedStore, selectCellUid } from '../shared-state';
import { CellPoster } from './composition/CellPoster';
import type { Cell, Anchor, ScriptBeat } from '../mcp-types';

export type NodeKind = 'stage' | 'script' | 'beat' | 'shot' | 'anchor' | 'group';

export interface CanvasNodeItem {
  id: string;
  kind: NodeKind;
  title: string;
  subtitle?: string;
  data?: unknown;
  index?: number;
}

const GRID_SNAP = 24;
const DEFAULT_VIEWPORT: Viewport = { x: 40, y: 40, scale: 1.0 };

export function NodeCanvas() {
  const project = useProjectStore(selectOpenProject);
  const projectDoc = useStoryboardStore(selectHydratedProject);
  const cells = useStoryboardStore(selectHydratedCells);
  const renderStatusMap = useStoryboardStore(selectRenderStatus);
  const anchors = useAnchorsStore(selectAnchors);
  const selectedCellUid = useSharedStore(selectCellUid);
  const setCellUid = useSharedStore((s) => s.setCellUid);

  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [editMode, setEditMode] = useState<boolean>(true);
  const [layout, setLayout] = useState<Record<ItemId, Placement>>({});

  // Assemble Heterogeneous Node Items
  const items = useMemo<CanvasNodeItem[]>(() => {
    const list: CanvasNodeItem[] = [];

    // 1. Pipeline Stages
    const stages = ['Script', 'Breakdown', 'Anchors', 'Generate', 'Resolve'];
    stages.forEach((st, idx) => {
      list.push({
        id: `stage-${st.toLowerCase()}`,
        kind: 'stage',
        title: st,
        index: idx,
      });
    });

    // 2. Script Node
    if (projectDoc?.script) {
      list.push({
        id: 'node-script',
        kind: 'script',
        title: projectDoc.title || 'Screenplay',
        subtitle: `${projectDoc.script.beats?.length || 0} beats`,
      });
    }

    // 3. Beat Nodes
    (projectDoc?.script?.beats || []).forEach((b: ScriptBeat, idx: number) => {
      list.push({
        id: `beat-${b.id}`,
        kind: 'beat',
        title: b.scene_id ? `${b.scene_id}: ${b.id}` : b.id,
        subtitle: b.action || b.vo,
        data: b,
        index: idx,
      });
    });

    // 4. Shot Nodes (Sequence Lane)
    cells.forEach((cell: Cell, idx: number) => {
      list.push({
        id: cell.uid,
        kind: 'shot',
        title: cell.label || `Shot ${idx + 1}`,
        subtitle: cell.prompt || '',
        data: cell,
        index: idx,
      });
    });

    // 5. Anchor Nodes
    anchors.forEach((anc: Anchor) => {
      list.push({
        id: `anchor-${anc.id}`,
        kind: 'anchor',
        title: anc.name,
        subtitle: anc.kind,
        data: anc,
      });
    });

    return list;
  }, [projectDoc, cells, anchors]);

  // Derive Default Automatic Layout (Sequence Lane at y=320)
  const effectiveLayout = useMemo(() => {
    const computed: Record<ItemId, Placement> = { ...layout };

    // Layout Stages row (y=40)
    const stages = ['stage-script', 'stage-breakdown', 'stage-anchors', 'stage-generate', 'stage-resolve'];
    stages.forEach((sid, idx) => {
      const id = sid as ItemId;
      if (!computed[id]) {
        computed[id] = { x: 40 + idx * 240, y: 40, w: 200, h: 64 };
      }
    });

    // Layout Script node (y=160)
    const scriptId = 'node-script' as ItemId;
    if (!computed[scriptId]) {
      computed[scriptId] = { x: 40, y: 160, w: 220, h: 96 };
    }

    // Layout Sequence Lane (y=320)
    cells.forEach((c, idx) => {
      const id = c.uid as ItemId;
      if (!computed[id]) {
        computed[id] = { x: 40 + idx * 220, y: 320, w: 200, h: 220 };
      }
    });

    // Layout Anchors (y=600)
    anchors.forEach((a, idx) => {
      const id = `anchor-${a.id}` as ItemId;
      if (!computed[id]) {
        computed[id] = { x: 40 + idx * 220, y: 600, w: 180, h: 140 };
      }
    });

    return computed;
  }, [layout, cells, anchors]);

  const handleLayoutChange = useCallback((nextLayout: Record<ItemId, Placement>) => {
    setLayout(nextLayout);
  }, []);

  const renderItem = useCallback((item: CanvasNodeItem, state: ItemRenderState) => {
    const isSelected = state.isSelected || (item.kind === 'shot' && item.id === selectedCellUid);
    const scale = viewport.scale;

    // LOD Level 1: Extreme zoom out (scale < 0.45) → Chip summary
    if (scale < 0.45) {
      return (
        <div
          className={[
            'h-full w-full rounded border bg-surface p-2 flex items-center justify-between font-mono text-[10px]',
            isSelected ? 'border-[var(--achievement)] ring-2 ring-[var(--achievement)]' : 'border-soft',
          ].join(' ')}
        >
          <span className="truncate font-semibold text-fg">{item.title}</span>
          <span className="text-[8px] uppercase tracking-wider text-fg-faint">{item.kind}</span>
        </div>
      );
    }

    // Stage Node
    if (item.kind === 'stage') {
      return (
        <div className="h-full w-full rounded-md border border-dashed border-[var(--info)] bg-[color-mix(in_oklab,var(--info)_8%,var(--bg-surface))] p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--info)]">Pipeline Stage</span>
            <span className="font-mono text-[9px] tabular-nums text-fg-faint">0{Number(item.index) + 1}</span>
          </div>
          <span className="font-semibold text-fg text-[13px]">{item.title}</span>
        </div>
      );
    }

    // Script Node
    if (item.kind === 'script') {
      return (
        <div className="h-full w-full rounded-md border border-soft bg-surface p-3 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--agent)]">Screenplay</span>
            <span className="font-mono text-[9px] text-fg-faint">{item.subtitle}</span>
          </div>
          <span className="font-medium text-fg text-[12px] truncate">{item.title}</span>
          <div className="text-[10px] text-fg-muted truncate">Master script source</div>
        </div>
      );
    }

    // Anchor Node
    if (item.kind === 'anchor') {
      const anc = item.data as Anchor | undefined;
      return (
        <div className="h-full w-full rounded-md border border-[var(--border)] bg-surface p-2.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between font-mono text-[9px]">
            <span className="text-[var(--agent)] uppercase">{anc?.kind ?? '3D Anchor'}</span>
            <span className="text-fg-faint">#ref</span>
          </div>
          <div className="font-medium text-fg text-[11px] truncate">{item.title}</div>
          <div className="rounded bg-sunken p-1 text-[9px] font-mono text-fg-faint truncate">
            {(anc?.metadata?.notes as string) || anc?.asset?.uri || 'Deterministic 3D Plate'}
          </div>
        </div>
      );
    }

    // Shot Node (Sequence Lane item)
    if (item.kind === 'shot') {
      const cell = item.data as Cell | undefined;
      const status = cell ? renderStatusMap[cell.uid] : undefined;
      const doneRecord = cell?.renders?.slice().reverse().find((r) => r.status === 'done');

      return (
        <div
          onClick={() => cell && setCellUid(cell.uid)}
          className={[
            'h-full w-full rounded-md border bg-surface p-2 flex flex-col justify-between transition-shadow shadow-sm hover:shadow-md cursor-pointer',
            isSelected ? 'border-[var(--achievement)] ring-2 ring-[var(--achievement)]' : 'border-soft',
          ].join(' ')}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-1 border-b border-soft pb-1">
            <div className="flex items-center gap-1 font-mono text-[9px]">
              <span className="text-fg-faint">{String(Number(item.index) + 1).padStart(2, '0')}</span>
              <span className="font-semibold text-fg truncate max-w-[100px]">{cell?.label || item.id}</span>
            </div>
            <span className="rounded px-1 py-px font-mono text-[8px] uppercase bg-raised text-fg-muted">
              {cell?.rung || '2_hifi'}
            </span>
          </div>

          {/* Media / Poster preview */}
          <div className="relative my-1 flex-1 overflow-hidden rounded bg-sunken flex items-center justify-center">
            {doneRecord?.id ? (
              <CellPoster recordId={doneRecord.id} alt={item.title} className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <span className="font-mono text-[9px] text-fg-faint">
                {status === 'running' ? 'Rendering…' : status === 'queued' ? 'Queued' : 'Not rendered'}
              </span>
            )}
          </div>

          {/* Prompt excerpt */}
          <div className="truncate text-[10px] text-fg-muted font-sans" title={cell?.prompt}>
            {cell?.prompt || 'No prompt'}
          </div>

          {/* Bottom info bar */}
          <div className="flex items-center justify-between pt-1 border-t border-soft font-mono text-[8.5px] text-fg-faint">
            <span>{cell?.duration_ms ? `${(cell.duration_ms / 1000).toFixed(1)}s` : '3.0s'}</span>
            <span className={status === 'done' ? 'text-[var(--live)]' : status === 'running' ? 'text-[var(--info)]' : ''}>
              {status === 'done' ? '✓ Ready' : status === 'running' ? '◐ In flight' : '○ Standby'}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className="h-full w-full rounded border border-soft bg-surface p-2">
        <span className="text-[11px] font-medium text-fg">{item.title}</span>
      </div>
    );
  }, [selectedCellUid, renderStatusMap, viewport.scale, setCellUid]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-base">
      {/* Node Canvas Surface */}
      <Canvas<CanvasNodeItem>
        items={items}
        itemId={(it) => it.id as ItemId}
        itemKind={(it) => it.kind}
        layout={effectiveLayout}
        viewport={viewport}
        editMode={editMode}
        selectedId={(selectedCellUid as ItemId) || null}
        gridSnap={GRID_SNAP}
        renderItem={renderItem}
        onLayoutChange={handleLayoutChange}
        onViewportChange={setViewport}
        onSelectionChange={(id) => id && setCellUid(id as string)}
        className="h-full w-full"
      >
        {/* Floating Canvas Controls Overlay */}
        <div className="pointer-events-auto absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-md border border-soft bg-surface/90 p-1 backdrop-blur shadow-md font-mono text-[10px]">
          <button
            type="button"
            onClick={() => setViewport((v) => ({ ...v, scale: Math.min(2.0, v.scale * 1.2) }))}
            className="h-6 w-6 rounded hover:bg-raised text-fg flex items-center justify-center font-bold"
            title="Zoom In"
          >
            +
          </button>
          <span className="px-1 text-fg-muted tabular-nums">{Math.round(viewport.scale * 100)}%</span>
          <button
            type="button"
            onClick={() => setViewport((v) => ({ ...v, scale: Math.max(0.25, v.scale / 1.2) }))}
            className="h-6 w-6 rounded hover:bg-raised text-fg flex items-center justify-center font-bold"
            title="Zoom Out"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => setViewport(DEFAULT_VIEWPORT)}
            className="rounded px-2 py-0.5 hover:bg-raised text-fg-muted hover:text-fg"
            title="Reset Viewport"
          >
            Reset
          </button>
        </div>
      </Canvas>
    </div>
  );
}

export default NodeCanvas;
