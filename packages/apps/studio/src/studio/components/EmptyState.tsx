// com.ikenga.studio · EmptyState
//
// The one reusable empty-state affordance every pane renders when it has
// nothing to show (contract §8 commit-13, states-empty.html parity). Extracted
// so Canvas / Cell / Script / ArchetypeBuilder stop hand-rolling the same
// centred title + mono hint 4×; the Composition pane's pre-existing inline
// empty state (commit-13 partial) already matches this visual language and is
// left as-is per scope.
//
// Two wrappers via `className`: the default is a full-pane centred column
// (Canvas / Cell / Script — the whole pane is empty); embedded regions (the
// ArchetypeBuilder empty-chain drop target) pass their own bordered-card
// wrapper. Glyph + title + hint are shared either way, and `children` carries
// any optional CTA/aside (e.g. the "ask the agent" line).

import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Optional glyph shown in a rounded badge above the title. */
  glyph?: ReactNode;
  /** The headline — font-display, fg-muted. */
  title: string;
  /** The mono, uppercase sub-line under the title. */
  hint?: ReactNode;
  /** Optional richer body (CTA row, secondary hint). */
  children?: ReactNode;
  /** Overrides the default full-pane wrapper (e.g. an inline dashed card). */
  className?: string;
}

const DEFAULT_WRAPPER =
  'flex h-full flex-col items-center justify-center gap-2 bg-base p-8 text-center';

export function EmptyState({ glyph, title, hint, children, className }: EmptyStateProps) {
  return (
    <div className={className ?? DEFAULT_WRAPPER}>
      {glyph && (
        <div
          aria-hidden="true"
          className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg border border-soft bg-raised text-base text-fg-faint"
        >
          {glyph}
        </div>
      )}
      <span className="font-display text-sm text-fg-muted">{title}</span>
      {hint && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
          {hint}
        </span>
      )}
      {children}
    </div>
  );
}
