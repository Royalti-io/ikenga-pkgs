// com.ikenga.studio · @ikenga/contract/canvas STUB
//
// This file mirrors the surface of @ikenga/contract/canvas as it exists on
// the unmerged branch `contract/studio/wp01-canvas-extract` (commit 36c832c).
// It is deliberately not imported from there — the contract subpath isn't
// published to the studio/wp07-iframe branch's resolution graph yet, and
// blocking WP-07 on the WP-01 PR merge would defeat the design-unblocked
// status flip recorded in 10-wp07-iframe.md.
//
// Surface parity rules — if the real Canvas's exported API changes in WP-01
// before G-CANVAS lands, this file gets updated to match. Commit 16 deletes
// the file outright and switches every import path from './__stubs__/canvas'
// to '@ikenga/contract/canvas'; that swap must compile without touching any
// view code, so the prop names, generics, and ref semantics are load-bearing.
//
// Behavioural parity is loose — this stub implements just enough pan / drag
// / select / autoFit to let the studio iframe feel right under `ikenga dev`.
// The home-page-grade gesture handling (Space-hold + middle-mouse + grid-snap
// + scale-aware drag) lives in usePanZoom / useDragSnap on the WP-01 branch
// and isn't re-implemented here. When commit 16 swaps, those gestures upgrade
// automatically.

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

// ─── Types — verbatim mirror of contract:src/canvas/types.ts ────────────

export type ItemId = string & { readonly __brand: 'ItemId' };

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface ItemRenderState {
  id: ItemId;
  kind: string;
  placement: Placement;
  isSelected: boolean;
  isEditMode: boolean;
}

export interface CanvasProps<T> {
  items: T[];
  itemId: (item: T) => ItemId;
  itemKind: (item: T) => string;
  layout: Record<ItemId, Placement>;
  viewport: Viewport;
  editMode: boolean;
  selectedId?: ItemId | null;
  gridSnap?: number;
  renderItem: (item: T, state: ItemRenderState) => ReactNode;
  onLayoutChange?: (layout: Record<ItemId, Placement>) => void;
  onViewportChange?: (viewport: Viewport) => void;
  onEditModeChange?: (editMode: boolean) => void;
  onSelectionChange?: (selectedId: ItemId | null) => void;
  autoFitOnResize?: boolean;
  className?: string;
  /** Consumer chrome (top bar, palette) rendered inside the canvas surface. */
  children?: ReactNode;
}

export interface CanvasHandle {
  autoFit(animate?: boolean): void;
}

/** Helper for consumers — opaque-brand a plain string into an ItemId. The
 *  real contract module ships the same helper; mirroring it here keeps the
 *  view code identical pre- and post-swap. */
export const asItemId = (s: string): ItemId => s as ItemId;

// ─── Hit-test class roots — match the real Canvas ───────────────────────
//
// Anything matching ITEM_SELECTOR inside the canvas is a draggable item;
// elements under BAR_SELECTOR / PALETTE_SELECTOR are excluded from gestures
// so the consumer can render its own chrome under `children` without it
// stealing pans.

const ITEM_SELECTOR    = '[data-canvas-item]';
const BAR_SELECTOR     = '.ikenga-canvas-bar';
const PALETTE_SELECTOR = '.ikenga-canvas-palette';

// ─── Inner ──────────────────────────────────────────────────────────────

function CanvasInner<T>(props: CanvasProps<T>, ref: Ref<CanvasHandle>) {
  const {
    items,
    itemId,
    itemKind,
    layout,
    viewport,
    editMode,
    selectedId = null,
    gridSnap = 12,
    renderItem,
    onLayoutChange,
    onViewportChange,
    onEditModeChange,
    onSelectionChange,
    autoFitOnResize = true,
    className,
    children,
  } = props;

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const stageRef  = useRef<HTMLDivElement | null>(null);

  // Track Space-down so a press-and-drag pans even when the pointer starts
  // over an item (matches home behaviour). Released on keyup or blur.
  const [spaceDown, setSpaceDown] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spaceDown) setSpaceDown(true);
      if (e.code === 'Escape') {
        if (editMode) onEditModeChange?.(false);
        if (selectedId) onSelectionChange?.(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    const onBlur = () => setSpaceDown(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [editMode, selectedId, spaceDown, onEditModeChange, onSelectionChange]);

  // ── autoFit ─────────────────────────────────────────────────────────────
  //
  // Compute bounding box of all `layout` entries and centre it in the canvas
  // surface. No animation — the second argument is honoured by the real
  // Canvas; this stub treats both branches the same.

  const autoFit = useCallback(
    (_animate?: boolean) => {
      const surface = canvasRef.current;
      if (!surface) return;
      const entries = Object.values(layout);
      if (entries.length === 0) {
        onViewportChange?.({ x: 0, y: 0, scale: 1 });
        return;
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of entries) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + p.w);
        maxY = Math.max(maxY, p.y + p.h);
      }
      const PAD = 60;
      const cw = surface.clientWidth  || 1;
      const ch = surface.clientHeight || 1;
      const bw = (maxX - minX) + PAD * 2;
      const bh = (maxY - minY) + PAD * 2;
      const scale = Math.min(1, Math.min(cw / bw, ch / bh));
      const x = (cw - (maxX - minX) * scale) / 2 - minX * scale;
      const y = (ch - (maxY - minY) * scale) / 2 - minY * scale;
      onViewportChange?.({ x, y, scale });
    },
    [layout, onViewportChange],
  );

  useImperativeHandle(ref, () => ({ autoFit }), [autoFit]);

  // ── autoFitOnResize ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!autoFitOnResize) return;
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => autoFit(false));
    ro.observe(el);
    return () => ro.disconnect();
  }, [autoFit, autoFitOnResize]);

  // ── Pan + drag plumbing ─────────────────────────────────────────────────
  //
  // One pointerdown handler dispatches into either pan-mode or drag-mode
  // based on edit-mode + hit-test + Space-state. We track gesture state in a
  // ref so renders don't churn during drag.

  type Gesture =
    | { kind: 'pan';  startX: number; startY: number; vx: number; vy: number }
    | { kind: 'drag'; id: ItemId; startX: number; startY: number; ox: number; oy: number };

  const gestureRef = useRef<Gesture | null>(null);
  const movedRef   = useRef(false);

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest(BAR_SELECTOR) || target.closest(PALETTE_SELECTOR)) return;
    const middle = e.button === 1;
    const left   = e.button === 0;
    if (!left && !middle) return;

    const itemEl = target.closest(ITEM_SELECTOR) as HTMLElement | null;
    const isPanTrigger = middle || spaceDown || !itemEl;

    if (isPanTrigger) {
      gestureRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        vx: viewport.x,
        vy: viewport.y,
      };
      movedRef.current = false;
      e.preventDefault();
      return;
    }

    if (editMode && itemEl) {
      const id = itemEl.getAttribute('data-id') as ItemId | null;
      if (!id) return;
      const p = layout[id];
      if (!p) return;
      gestureRef.current = {
        kind: 'drag',
        id,
        startX: e.clientX,
        startY: e.clientY,
        ox: p.x,
        oy: p.y,
      };
      movedRef.current = false;
      e.preventDefault();
    }
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      movedRef.current = true;
      if (g.kind === 'pan') {
        onViewportChange?.({
          x: g.vx + (e.clientX - g.startX),
          y: g.vy + (e.clientY - g.startY),
          scale: viewport.scale,
        });
      } else {
        const dx = (e.clientX - g.startX) / viewport.scale;
        const dy = (e.clientY - g.startY) / viewport.scale;
        const nx = Math.round((g.ox + dx) / gridSnap) * gridSnap;
        const ny = Math.round((g.oy + dy) / gridSnap) * gridSnap;
        const prev = layout[g.id];
        if (!prev || (prev.x === nx && prev.y === ny)) return;
        onLayoutChange?.({ ...layout, [g.id]: { ...prev, x: nx, y: ny } });
      }
    };
    const onUp = (e: MouseEvent) => {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g) return;
      if (g.kind === 'drag' && !movedRef.current) {
        // No-move click on an item → selection toggle.
        onSelectionChange?.(g.id === selectedId ? null : g.id);
      } else if (g.kind === 'pan' && !movedRef.current && !editMode) {
        // Bare click on empty stage → clear selection.
        const target = e.target as HTMLElement;
        if (!target.closest(ITEM_SELECTOR)) onSelectionChange?.(null);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [editMode, gridSnap, layout, selectedId, viewport.scale, onLayoutChange, onSelectionChange, onViewportChange]);

  // ── Render ──────────────────────────────────────────────────────────────

  const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
  const cursor = spaceDown ? 'grab' : editMode ? 'default' : 'grab';

  return (
    <div
      ref={canvasRef}
      className={`ikenga-canvas relative h-full w-full overflow-hidden select-none ${className ?? ''}`}
      style={{ cursor }}
      onMouseDown={onMouseDown}
    >
      <div
        ref={stageRef}
        className="absolute left-0 top-0"
        style={{ transform, transformOrigin: '0 0', width: 0, height: 0 }}
      >
        {items.map((item) => {
          const id = itemId(item);
          const kind = itemKind(item);
          const placement = layout[id];
          if (!placement) return null;
          const state: ItemRenderState = {
            id,
            kind,
            placement,
            isSelected: id === selectedId,
            isEditMode: editMode,
          };
          const el = renderItem(item, state);
          if (!isValidElement(el)) return el;
          const element = el as ReactElement<{
            'data-id'?: string;
            'data-canvas-item'?: string;
            style?: CSSProperties;
            className?: string;
          }>;
          const injectedStyle: CSSProperties = {
            position: 'absolute',
            left: placement.x,
            top: placement.y,
            width: placement.w,
            ...(element.props.style ?? {}),
          };
          const baseClass = element.props.className ?? '';
          const injectedClass = `${baseClass} ${state.isSelected ? 'is-selected' : ''}`.trim();
          return cloneElement(element, {
            key: id,
            'data-id': id,
            'data-canvas-item': '',
            style: injectedStyle,
            className: injectedClass,
          });
        })}
      </div>
      {children}
    </div>
  );
}

// forwardRef-with-generics dance: cast the wrapper because React's
// forwardRef typing drops the generic. The exported component preserves it.
export const Canvas = forwardRef(CanvasInner) as <T>(
  props: CanvasProps<T> & { ref?: Ref<CanvasHandle> },
) => ReactElement | null;
