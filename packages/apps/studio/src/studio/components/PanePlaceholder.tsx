// com.ikenga.studio · PanePlaceholder
//
// Rendered when a pane's ViewId has no concrete component registered yet —
// i.e. for every view until its own commit (6–11) lands. Names the view and
// notes the landing commit so a dev running `ikenga dev` mid-PR sees a
// deliberate stub rather than a blank pane. Deleted-by-attrition: as views
// register real components, App.tsx stops falling through to this.

import { VIEWS, type ViewId } from '../routes';

// Each view commit removes its own entry as it lands; canvas (commit 6) and
// cell (commit 7) are gone. Partial<…> so the type narrows naturally as the
// registry in App.tsx fills out — `LANDS_IN[view]` returns undefined for
// landed views, which is fine because PanePlaceholder is no longer rendered
// for them.
const LANDS_IN: Partial<Record<ViewId, string>> = {
  composition: 'commit 8',
  script:      'commit 9',
  archetype:   'commit 10',
};

export function PanePlaceholder({ view }: { view: ViewId }) {
  const meta = VIEWS[view];
  const landsIn = LANDS_IN[view];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 bg-base p-6 text-center">
      <span className="font-display text-sm text-fg-muted">{meta.label}</span>
      {landsIn && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
          view lands in WP-07 {landsIn}
        </span>
      )}
    </div>
  );
}
