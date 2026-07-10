// media-controls · 43 · preview-surface + media-thumb   @promote-candidate
//
// Dependency-free, ZERO studio-domain imports. `PreviewSurface` FRAMES the
// engine render surface (a black box — the HF <hyperframes-player>, Remotion
// <Player>, or Excalidraw canvas); it never restyles the engine (contract §4).
// It only supplies the framed background + the not-ready status affordance.
//
// Class API (studio-editor layer): .preview-surface (.is-rendering /
// .is-queued / .is-pending / .is-failed / .is-cancelled) /
// .preview-surface-content · .preview-status / .preview-status-glyph /
// .preview-status-text / .preview-status-action · .media-thumb

import type { ReactNode } from 'react';

export type PreviewStatusKind =
  | 'ready'
  | 'rendering'
  | 'queued'
  | 'pending'
  // Added for contract §8 commit-13 (states-cell.html parity) — the frozen
  // 6-value RenderStatus enum has no home elsewhere for these on the
  // preview surface, so 'failed'/'cancelled' round out the not-ready set.
  | 'failed'
  | 'cancelled';

export interface PreviewSurfaceProps {
  /** Drives the state class; 'ready' shows the framed engine content. */
  status?: PreviewStatusKind;
  ariaLabel?: string;
  children?: ReactNode;
}

export function PreviewSurface({
  status = 'ready',
  ariaLabel,
  children,
}: PreviewSurfaceProps) {
  const stateClass = status === 'ready' ? '' : ` is-${status}`;
  return (
    <div
      className={`preview-surface${stateClass}`}
      role="img"
      aria-label={ariaLabel}
    >
      <div className="preview-surface-content">{children}</div>
    </div>
  );
}

// ─── Status overlay (composed as PreviewSurface children when not ready) ──

export interface PreviewStatusProps {
  /** ◐ (rendering) · ○ (queued/pending) · ⚠ (failed) · ✕ (cancelled). */
  glyph?: string;
  text: string;
  /** Optional affordance row (e.g. a Retry button for a failed render). The
   *  consumer owns the click handler/MCP call — this component stays
   *  domain-free. */
  action?: ReactNode;
}

export function PreviewStatus({ glyph = '○', text, action }: PreviewStatusProps) {
  return (
    <div className="preview-status">
      <span className="preview-status-glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="preview-status-text">{text}</span>
      {action && <div className="preview-status-action">{action}</div>}
    </div>
  );
}

// ─── Media thumbnail (generic still / poster) ─────────────────────────────

export interface MediaThumbProps {
  src?: string;
  alt?: string;
  /** Placeholder glyph shown when there's no `src`. */
  glyph?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function MediaThumb({
  src,
  alt = '',
  glyph = '▦',
  className,
  style,
}: MediaThumbProps) {
  return (
    <div className={`media-thumb${className ? ` ${className}` : ''}`} style={style}>
      {src ? (
        <img src={src} alt={alt} />
      ) : (
        <span className="media-thumb__glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
    </div>
  );
}
