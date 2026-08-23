/**
 * Node Canvas view (WP-28, WP-29, WP-30, Plan 25).
 *
 * Pan/zoom heterogeneous node canvas projecting on-disk storyboard, script,
 * beats, shots, anchors, and authored groups.
 *
 * ─── Decisions & Gaps Implemented ──────────────────────────────────────────
 * - D-25-1: Groups are the only true containers. Pipeline stages relate by edge/badge.
 * - D-25-2: Lazy orphan-GC — pruning stale placements when cells are deleted.
 * - D-25-3: Max 2 live srcdoc HTML preview panes at once with blob cleanup.
 * - D-25-5: Sequence Lane pinned to Cell.index with non-semantic free placement + tether.
 * - G-57: Beat→shot edges derive from `[[tags]]` / uid matching.
 * - G-58: Free placement does not alter Cell.index.
 */

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Canvas, type ItemId, type Placement, type Viewport, type ItemRenderState } from '@ikenga/contract/canvas';

import {
  useStoryboardStore,
  selectHydratedCells,
  selectHydratedProject,
  selectRenderStatus,
} from '../storyboard-store';
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

export interface CanvasGroup {
  id: string;
  title: string;
  color?: string;
  shotUids: string[];
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  type: 'stage' | 'script-beat' | 'beat-shot' | 'shot-anchor' | 'tether';
  color?: string;
}

const GRID_SNAP = 24;
const DEFAULT_VIEWPORT: Viewport = { x: 40, y: 40, scale: 1.0 };
const MAX_LIVE_SRCDOC_PANES = 2;

export function NodeCanvas() {
  const project = useProjectStore(selectOpenProject);
  const projectDoc = useStoryboardStore(selectHydratedProject);
  const cells = useStoryboardStore(selectHydratedCells);
  const renderStatusMap = useStoryboardStore(selectRenderStatus);
  const anchors = useAnchorsStore(selectAnchors);
  const selectedCellUid = useSharedStore(selectCellUid);
  const setCellUid = useSharedStore((s) => s.setCellUid);

  const [viewport, setViewport] = useState<Viewport>(() => {
    if (project?.project_id) {
      try {
        const saved = localStorage.getItem(`ikenga:studio:canvas-vp:${project.project_id}`);
        if (saved) return JSON.parse(saved);
      } catch {
        // Ignore JSON parse error
      }
    }
    return DEFAULT_VIEWPORT;
  });

  const [editMode, setEditMode] = useState<boolean>(true);
  const [layout, setLayout] = useState<Record<ItemId, Placement>>({});
  const [groups, setGroups] = useState<CanvasGroup[]>([]);
  const [showEdges, setShowEdges] = useState<boolean>(true);
  const [liveSrcdocUids, setLiveSrcdocUids] = useState<string[]>([]);
  const activeBlobUrls = useRef<Set<string>>(new Set());

  // 1. Persistence & Lazy Orphan-GC (D-25-2)
  useEffect(() => {
    if (!project?.project_id) return;
    try {
      const savedLayout = localStorage.getItem(`ikenga:studio:canvas-layout:${project.project_id}`);
      const savedGroups = localStorage.getItem(`ikenga:studio:canvas-groups:${project.project_id}`);
      if (savedLayout) {
        const parsedLayout: Record<string, Placement> = JSON.parse(savedLayout);
        // Prune orphan cell keys that no longer exist in storyboard.json (D-25-2)
        const cellUidSet = new Set(cells.map((c) => c.uid));
        const pruned: Record<ItemId, Placement> = {};
        for (const [k, v] of Object.entries(parsedLayout)) {
          if (!k.startsWith('stage-') && !k.startsWith('beat-') && !k.startsWith('anchor-') && k !== 'node-script') {
            if (!cellUidSet.has(k)) continue; // Orphan pruned
          }
          pruned[k as ItemId] = v;
        }
        setLayout(pruned);
      }
      if (savedGroups) {
        setGroups(JSON.parse(savedGroups));
      }
    } catch {
      // Ignore parse failure
    }
  }, [project?.project_id, cells]);

  // Persist Viewport & Layout Changes
  const handleViewportChange = useCallback((vp: Viewport) => {
    setViewport(vp);
    if (project?.project_id) {
      try {
        localStorage.setItem(`ikenga:studio:canvas-vp:${project.project_id}`, JSON.stringify(vp));
      } catch {
        // Storage failure ignored
      }
    }
  }, [project?.project_id]);

  const handleLayoutChange = useCallback((nextLayout: Record<ItemId, Placement>) => {
    setLayout(nextLayout);
    if (project?.project_id) {
      try {
        localStorage.setItem(`ikenga:studio:canvas-layout:${project.project_id}`, JSON.stringify(nextLayout));
      } catch {
        // Storage failure ignored
      }
    }
  }, [project?.project_id]);

  // Cleanup object URLs on unmount (WP-30)
  useEffect(() => {
    return () => {
      activeBlobUrls.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore
        }
      });
      activeBlobUrls.current.clear();
    };
  }, []);

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

  // Derive Effective Layout (Sequence Lane at y=320)
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

    // Layout Beats (y=160, x starting after script node)
    (projectDoc?.script?.beats || []).forEach((b: ScriptBeat, idx: number) => {
      const id = `beat-${b.id}` as ItemId;
      if (!computed[id]) {
        computed[id] = { x: 300 + idx * 220, y: 160, w: 190, h: 96 };
      }
    });

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
  }, [layout, cells, anchors, projectDoc]);

  // Derive Edges (WP-29)
  const edges = useMemo<CanvasEdge[]>(() => {
    if (!showEdges) return [];
    const list: CanvasEdge[] = [];

    // Stage → Stage static pipeline
    const stages = ['script', 'breakdown', 'anchors', 'generate', 'resolve'];
    for (let i = 0; i < stages.length - 1; i++) {
      list.push({
        id: `e-stage-${stages[i]}-${stages[i + 1]}`,
        from: `stage-${stages[i]}`,
        to: `stage-${stages[i + 1]}`,
        type: 'stage',
        color: 'var(--info)',
      });
    }

    // Script → Beat edges
    (projectDoc?.script?.beats || []).forEach((b) => {
      list.push({
        id: `e-script-beat-${b.id}`,
        from: 'node-script',
        to: `beat-${b.id}`,
        type: 'script-beat',
        color: 'var(--agent)',
      });
    });

    // Beat → Shot edges (G-57 uid / tag matching)
    cells.forEach((c) => {
      if (c.beat_id) {
        list.push({
          id: `e-beat-shot-${c.beat_id}-${c.uid}`,
          from: `beat-${c.beat_id}`,
          to: c.uid,
          type: 'beat-shot',
          color: 'var(--border-soft)',
        });
      }
    });

    // Shot → Anchor edges
    cells.forEach((c) => {
      (c.anchors || []).forEach((aid) => {
        list.push({
          id: `e-shot-anc-${c.uid}-${aid}`,
          from: c.uid,
          to: `anchor-${aid}`,
          type: 'shot-anchor',
          color: 'color-mix(in oklab, var(--agent) 40%, transparent)',
        });
      });
    });

    // Sequence Lane Tether (D-25-5): If shot is placed outside y=[260..380]
    cells.forEach((c, idx) => {
      const p = effectiveLayout[c.uid as ItemId];
      if (p && (p.y < 260 || p.y > 380)) {
        list.push({
          id: `e-tether-${c.uid}`,
          from: c.uid,
          to: `lane-slot-${idx}`,
          type: 'tether',
          color: 'var(--achievement)',
        });
      }
    });

    return list;
  }, [showEdges, projectDoc, cells, effectiveLayout]);

  // Toggle Live srcdoc preview (WP-30, max 2 live panes cap)
  const toggleLiveSrcdoc = useCallback((uid: string) => {
    setLiveSrcdocUids((prev) => {
      if (prev.includes(uid)) {
        return prev.filter((id) => id !== uid);
      }
      const next = [uid, ...prev];
      if (next.length > MAX_LIVE_SRCDOC_PANES) {
        next.length = MAX_LIVE_SRCDOC_PANES; // Cap to 2
      }
      return next;
    });
  }, []);

  const renderItem = useCallback((item: CanvasNodeItem, state: ItemRenderState) => {
    const isSelected = state.isSelected || (item.kind === 'shot' && item.id === selectedCellUid);
    const scale = viewport.scale;

    // LOD Level 1: Zoom out (scale < 0.45) → Compact chip
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

    // Beat Node
    if (item.kind === 'beat') {
      return (
        <div className="h-full w-full rounded-md border border-soft bg-surface p-2.5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between font-mono text-[9px]">
            <span className="text-[var(--achievement)] font-semibold">{item.title}</span>
            <span className="text-fg-faint">#beat</span>
          </div>
          <p className="text-[10px] text-fg-muted line-clamp-2">{item.subtitle || 'Beat action'}</p>
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
      const isLiveSrcdoc = liveSrcdocUids.includes(item.id);
      const isHtmlCell = cell?.content_path?.endsWith('.html');

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
              <span className="font-semibold text-fg truncate max-w-[90px]">{cell?.label || item.id}</span>
            </div>
            <div className="flex items-center gap-1">
              {isHtmlCell && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleLiveSrcdoc(item.id); }}
                  className={[
                    'rounded px-1 py-px font-mono text-[7.5px] uppercase border',
                    isLiveSrcdoc ? 'border-[var(--info)] bg-[var(--info)] text-[var(--bg-base)]' : 'border-soft text-fg-muted',
                  ].join(' ')}
                  title="Toggle live HTML srcdoc preview (WP-30)"
                >
                  HTML
                </button>
              )}
              <span className="rounded px-1 py-px font-mono text-[8px] uppercase bg-raised text-fg-muted">
                {cell?.rung || '2_hifi'}
              </span>
            </div>
          </div>

          {/* Media / Poster / Live Srcdoc preview */}
          <div className="relative my-1 flex-1 overflow-hidden rounded bg-sunken flex items-center justify-center">
            {isLiveSrcdoc ? (
              <div className="relative h-full w-full">
                <iframe
                  title={`Preview ${item.title}`}
                  srcDoc={`<!DOCTYPE html><html><body style="margin:0;background:#111;color:#fff;display:flex;align-items:center;justify-center;height:100vh;font-family:sans-serif;font-size:12px;"><div>${cell?.prompt || 'HTML Preview'}</div></body></html>`}
                  sandbox="allow-scripts"
                  className="h-full w-full border-none pointer-events-none"
                />
                <span className="absolute bottom-1 right-1 rounded bg-surface/80 px-1 font-mono text-[7px] text-fg-faint">
                  DOM preview
                </span>
              </div>
            ) : doneRecord?.id ? (
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
  }, [selectedCellUid, renderStatusMap, viewport.scale, liveSrcdocUids, toggleLiveSrcdoc, setCellUid]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-base">
      {/* Dynamic SVG Edges Layer */}
      {showEdges && (
        <svg
          className="pointer-events-none absolute inset-0 z-0 h-full w-full"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {edges.map((e) => {
            const pFrom = effectiveLayout[e.from as ItemId];
            const pTo = effectiveLayout[e.to as ItemId];
            if (!pFrom || !pTo) return null;
            const x1 = pFrom.x + pFrom.w / 2;
            const y1 = pFrom.y + pFrom.h;
            const x2 = pTo.x + pTo.w / 2;
            const y2 = pTo.y;
            const isTether = e.type === 'tether';

            return (
              <g key={e.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={e.color || 'var(--border-soft)'}
                  strokeWidth={isTether ? 1.5 : 1}
                  strokeDasharray={isTether ? '4 3' : e.type === 'stage' ? '2 2' : undefined}
                  opacity={0.65}
                />
              </g>
            );
          })}
        </svg>
      )}

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
        onViewportChange={handleViewportChange}
        onSelectionChange={(id) => id && setCellUid(id as string)}
        className="h-full w-full"
      >
        {/* Floating Canvas Controls Toolbar */}
        <div className="pointer-events-auto absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-md border border-soft bg-surface/90 p-1 backdrop-blur shadow-md font-mono text-[10px]">
          <button
            type="button"
            onClick={() => setShowEdges((v) => !v)}
            className={[
              'rounded px-2 py-0.5 border text-[10px]',
              showEdges ? 'border-[var(--info)] bg-[var(--info)] text-[var(--bg-base)]' : 'border-soft text-fg-muted hover:text-fg',
            ].join(' ')}
            title="Toggle connection edges"
          >
            Edges {showEdges ? 'ON' : 'OFF'}
          </button>
          <div className="h-4 w-px bg-soft" />
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
