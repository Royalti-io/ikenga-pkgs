// com.ikenga.studio · Split — a two-child pane split with a draggable divider
//
// Founder request (studio/ui-redesign): draggable pane resizing for the multi-
// pane layout presets. This is the shared primitive behind every divider —
// vsplit / hsplit use one; tripane composes two (an outer axis-y split whose
// first child is an inner axis-x split).
//
// Sizing model: CSS grid template with an `${a}fr ${GUTTER}px ${b}fr` track set
// (a = first-side fraction, b = 1 − a). No transforms, no absolute positioning —
// the browser reflows the fr tracks so there's no drag jank and the panes keep
// their own min-w-0/min-h-0 shrink behaviour. The GUTTER track IS the divider's
// 8px hit area; the visual hairline is a 1px ::before centered inside it.
//
// Pointer: pointerdown captures the pointer to the divider (setPointerCapture)
// so moves keep flowing to it even over pane content, and a fixed full-viewport
// overlay is mounted for the duration so nothing underneath (including any
// nested iframe) can eat the pointer or flash hover states. Ratios are clamped
// so neither side drops below MIN_PANE_PX, measured against the live container.
//
// A11y: the divider is role="separator" with aria-orientation + aria-valuenow
// (percent), keyboard-focusable, Arrow keys nudge 2%, Home/End snap to the
// min/max the current container size allows, double-click resets to default.

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import { MIN_PANE_PX } from '../routes';

/** 'x' = side-by-side panes / vertical divider / col-resize; 'y' = stacked
 *  panes / horizontal divider / row-resize. */
export type SplitAxis = 'x' | 'y';

/** Divider hit-target extent (px). The visual hairline is 1px inside it. */
const GUTTER = 8;
const NUDGE = 0.02; // 2% per Arrow press

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

interface SplitProps {
  axis: SplitAxis;
  /** First-side fraction (0–1). */
  ratio: number;
  /** Called with the new clamped fraction on drag / keyboard nudge. */
  onRatio: (value: number) => void;
  /** Called on double-click — restore this divider's preset default. */
  onReset: () => void;
  /** Accessible name for the separator. */
  label: string;
  first: ReactNode;
  second: ReactNode;
}

export function Split({ axis, ratio, onRatio, onReset, label, first, second }: SplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const a = clamp(ratio, 0, 1);
  const b = 1 - a;
  const template = axis === 'x'
    ? { gridTemplateColumns: `${a}fr ${GUTTER}px ${b}fr` }
    : { gridTemplateRows: `${a}fr ${GUTTER}px ${b}fr` };

  // Min fraction each side must keep, given the live container extent. Falls
  // back to a small floor if the container hasn't measured yet.
  const minFraction = () => {
    const el = containerRef.current;
    const size = el ? (axis === 'x' ? el.clientWidth : el.clientHeight) : 0;
    if (size <= 0) return 0.05;
    return clamp(MIN_PANE_PX / size, 0, 0.5);
  };

  const ratioFromPointer = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return a;
    const rect = el.getBoundingClientRect();
    const size = axis === 'x' ? rect.width : rect.height;
    if (size <= 0) return a;
    const pos = axis === 'x' ? clientX - rect.left : clientY - rect.top;
    const min = minFraction();
    return clamp(pos / size, min, 1 - min);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Ignore secondary buttons; let double-click reset flow through untouched.
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    onRatio(ratioFromPointer(e.clientX, e.clientY));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const min = minFraction();
    const max = 1 - min;
    const dec = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const inc = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    switch (e.key) {
      case dec:
        onRatio(clamp(a - NUDGE, min, max));
        break;
      case inc:
        onRatio(clamp(a + NUDGE, min, max));
        break;
      case 'Home':
        onRatio(min);
        break;
      case 'End':
        onRatio(max);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div ref={containerRef} className="grid h-full min-h-0 min-w-0" style={template}>
      {first}
      <div
        role="separator"
        aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
        aria-label={label}
        aria-valuenow={Math.round(a * 100)}
        aria-valuemin={Math.round(minFraction() * 100)}
        aria-valuemax={Math.round((1 - minFraction()) * 100)}
        tabIndex={0}
        data-axis={axis}
        data-dragging={dragging || undefined}
        className="pane-divider"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onReset}
        onKeyDown={onKeyDown}
      />
      {second}
      {dragging && <div className="pane-drag-overlay" data-axis={axis} />}
    </div>
  );
}
