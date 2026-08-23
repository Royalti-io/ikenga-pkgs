// com.ikenga.studio · App
//
// The Pattern C harness: a top bar with the LayoutSwitcher, and a pane region
// that renders 1–3 panes per the active layout preset. Each pane has its own
// header (ViewSwitcher) and body (the registered view component, or a
// PanePlaceholder until that view's commit lands).
//
// This commit (5) wired layout + view routing + focus only; the launcher
// pre-empt (no open project → full-bleed Launcher, G25) lands in commit 11
// as the `!isOpen` early-return below. Cross-linking (commit 12) reads the
// shared store the views already subscribe to — App.tsx itself stays
// cross-link-agnostic.

import { useEffect, useRef, useState } from 'react';

import { isStandalone, subscribeStudioEvent } from './bridge';
import { useLayoutStore } from './layout-store';
import { useProjectStore, selectIsProjectOpen, selectOpenProject } from './project-store';
import { useStoryboardStore } from './storyboard-store';
import { useRenderPoll } from './lib/use-render-poll';
import { loadLastProject, clearLastProject, type LastProject } from './lib/project-persistence';
import { openProjectByPath, errText } from './lib/open-project';
import type { PaneIndex, ViewComponentRegistry } from './routes';
import { LayoutSwitcher } from './components/LayoutSwitcher';
import { Split } from './components/Split';
import { ViewSwitcher } from './components/ViewSwitcher';
import { PanePlaceholder } from './components/PanePlaceholder';
import { CanvasView } from './views/Canvas';
import { CellView } from './views/Cell';
import { CompositionView } from './views/Composition';
import { ArchetypeBuilderView } from './views/ArchetypeBuilder';
import { CastWorldView } from './views/CastWorld';
import { BreakdownView } from './views/Breakdown';
import { LedgerView } from './views/Ledger';
import { HandoffView } from './views/Handoff';
import { LauncherView } from './views/Launcher';
import { NowRenderingBeacon } from './components/NowRenderingBeacon';
import { useStudioKeyboard } from './lib/use-studio-keyboard';
import { initStudioMenu } from './menu';

// View component registry. Each view commit (6–11) adds its entry here.
// Until a view registers, App.tsx falls through to PanePlaceholder for it.
const VIEW_COMPONENTS: ViewComponentRegistry = {
  canvas:      CanvasView,
  cell:        CellView,
  composition: CompositionView,
  archetype:   ArchetypeBuilderView,
  'cast-world': CastWorldView,
  breakdown:   BreakdownView,
  ledger:      LedgerView,
  handoff:     HandoffView,
};

function Pane({ index }: { index: PaneIndex }) {
  const view = useLayoutStore((s) => s.paneViews[index]);
  const focused = useLayoutStore((s) => s.focusedPane === index);
  const setFocusedPane = useLayoutStore((s) => s.setFocusedPane);

  const ViewComponent = VIEW_COMPONENTS[view];

  return (
    <section
      // `data-pane-index` + a programmatic-only tab stop (-1) let the commit-15
      // keyboard map target this pane's chrome (Esc / F6 focus moves) and scope
      // the Tab focus-trap to it. focused pane gets the info/sky ring.
      data-pane-index={index}
      tabIndex={-1}
      className={
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-surface outline-none '
        + (focused
          ? 'border-[var(--border)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--info)_45%,transparent)]'
          : 'border-soft')
      }
      // Click OR keyboard focus entering the pane makes it the active pane
      // (drives the 1–9 view shortcut + the focus trap).
      onMouseDown={() => setFocusedPane(index)}
      onFocusCapture={() => setFocusedPane(index)}
      aria-current={focused ? 'true' : undefined}
    >
      <header className="flex items-center justify-between gap-2 border-b border-soft bg-sunken px-2 py-1">
        <ViewSwitcher pane={index} />
        <span className="font-mono text-[9px] uppercase tracking-wider text-fg-faint">
          pane {index + 1}
        </span>
      </header>
      <div className="min-h-0 flex-1">
        {ViewComponent ? <ViewComponent /> : <PanePlaceholder view={view} />}
      </div>
    </section>
  );
}

function PaneRegion() {
  const layout = useLayoutStore((s) => s.layout);
  const ratios = useLayoutStore((s) => s.ratios);
  const setRatio = useLayoutStore((s) => s.setRatio);
  const resetRatio = useLayoutStore((s) => s.resetRatio);

  if (layout === 'single') {
    return (
      <div className="flex min-h-0 flex-1 p-1.5">
        <Pane index={0} />
      </div>
    );
  }

  if (layout === 'vsplit') {
    return (
      <div className="min-h-0 flex-1 p-1.5">
        <Split
          axis="x"
          label="Resize left/right panes"
          ratio={ratios.vsplit[0]}
          onRatio={(v) => setRatio('vsplit', 0, v)}
          onReset={() => resetRatio('vsplit', 0)}
          first={<Pane index={0} />}
          second={<Pane index={1} />}
        />
      </div>
    );
  }

  if (layout === 'hsplit') {
    return (
      <div className="min-h-0 flex-1 p-1.5">
        <Split
          axis="y"
          label="Resize top/bottom panes"
          ratio={ratios.hsplit[0]}
          onRatio={(v) => setRatio('hsplit', 0, v)}
          onReset={() => resetRatio('hsplit', 0)}
          first={<Pane index={0} />}
          second={<Pane index={1} />}
        />
      </div>
    );
  }

  // tripane: two on top, one full-width below — matches the design glyph.
  // Outer split (axis y, divider index 1) sizes the top row vs pane 3; the
  // inner split (axis x, divider index 0) sizes pane 1 vs pane 2 within the row.
  return (
    <div className="min-h-0 flex-1 p-1.5">
      <Split
        axis="y"
        label="Resize top row and bottom pane"
        ratio={ratios.tripane[1]}
        onRatio={(v) => setRatio('tripane', 1, v)}
        onReset={() => resetRatio('tripane', 1)}
        first={
          <Split
            axis="x"
            label="Resize top-left and top-right panes"
            ratio={ratios.tripane[0]}
            onRatio={(v) => setRatio('tripane', 0, v)}
            onReset={() => resetRatio('tripane', 0)}
            first={<Pane index={0} />}
            second={<Pane index={1} />}
          />
        }
        second={<Pane index={2} />}
      />
    </div>
  );
}

// Optimistic resume (review §2 cold-start + §5.4): shown in place of the full
// Launcher for the instant between mount and the resume `project.open`
// settling. Mirrors main.tsx's boot-placeholder idiom (`.studio-scaffold`)
// rather than inventing a new loading surface — this and the boot placeholder
// are the same visual beat, back to back, on every remount that has a last
// project.
function ResumeSkeleton({ name }: { name: string }) {
  return (
    <main className="studio-scaffold">
      <h1 className="studio-scaffold__title">Studio</h1>
      <p className="studio-scaffold__hint">
        Resuming <span className="text-fg">{name}</span>…
      </p>
    </main>
  );
}

// Discriminated so a render can never read `resumeError`-shaped fields while
// still `pending`, or show the skeleton once the attempt has settled either
// way — the phase IS the render decision, not a side flag alongside one.
type ResumeState =
  | { phase: 'idle' }
  | { phase: 'pending'; target: LastProject }
  | { phase: 'failed'; name: string; detail: string };

export function App() {
  const isProjectOpen = useProjectStore(selectIsProjectOpen);
  const openProjectSummary = useProjectStore(selectOpenProject);
  // Standalone-only exit: the shell rail owns Close/Switch in-shell, but
  // standalone (pnpm dev) has no rail — so the header's project title is the
  // only way back to the Launcher (which doubles as the switcher: recents +
  // archetype gallery). F-2.
  const closeProject = useProjectStore((s) => s.closeProject);
  // Sync window-parent probe (stable for the iframe's lifetime): shell vs
  // standalone. Gates the banner LayoutSwitcher (see the header comment).
  const standalone = isStandalone();
  const bindPersistence = useLayoutStore((s) => s.bindPersistence);
  const unbindPersistence = useLayoutStore((s) => s.unbindPersistence);

  // Optimistic resume: read the persisted last-opened project SYNCHRONOUSLY
  // (lazy init runs during this first render, before the `!isProjectOpen`
  // branch below decides what to paint) instead of waiting on the full
  // probe/mode handshake the old Launcher-side auto-reopen gated behind. That
  // gate is why every pane remount used to flash the Launcher first — the
  // reopen target is already known from localStorage, no round-trip needed to
  // find it. Standalone (pnpm dev, no shell parent) never resumes: there is
  // nothing real on disk for a mock session to reopen (mirrors the old
  // mode!=='real' guard, but decidable synchronously via isStandalone()).
  const [resume, setResume] = useState<ResumeState>(() => {
    if (standalone) return { phase: 'idle' };
    const target = loadLastProject();
    return target ? { phase: 'pending', target } : { phase: 'idle' };
  });
  // StrictMode double-invokes effects; this plus the `phase !== 'pending'`
  // check below gives exactly one reopen attempt for the state's lifetime.
  const resumeAttempted = useRef(false);

  useEffect(() => {
    if (resume.phase !== 'pending' || resumeAttempted.current) return;
    resumeAttempted.current = true;
    const { target } = resume;
    void (async () => {
      try {
        // Reuses Wave 1's shared getMcpClient() (in-flight guard + probed-
        // engines cache) via openProjectByPath — no separate client here.
        await openProjectByPath(target.path, target.name);
        // Success flips project-store's isOpen; the render below switches to
        // the pane layout on its own. Still settle the phase so a LATER
        // explicit close (project-store.closeProject) lands on a plain
        // Launcher instead of resurrecting this skeleton.
        setResume({ phase: 'idle' });
      } catch (e) {
        // Moved / access denied / sidecar error: forget the stale entry so
        // the flash-inducing skeleton can't recur on the next mount, and hand
        // the honest failure to the Launcher the user lands on instead.
        clearLastProject();
        setResume({ phase: 'failed', name: target.name || target.path, detail: errText(e) });
      }
    })();
  }, [resume]);

  // App-level keyboard map + V-split focus trap (commit 15). Registered
  // unconditionally; its handlers no-op until a pane region exists.
  useStudioKeyboard();

  // Sidebar menu: publish on mount, republish on project open/close, route
  // menu clicks (activeFeature) onto the focused pane.
  useEffect(() => initStudioMenu(), []);

  // Per-folder layout persistence: rehydrate + arm the layout store when a
  // project opens; stop persisting when it closes. Keyed by project id so each
  // folder restores its own pane arrangement across remounts (layout-store.ts).
  useEffect(() => {
    const projectId = openProjectSummary?.project_id;
    if (projectId) bindPersistence(projectId);
    else unbindPersistence();
  }, [openProjectSummary?.project_id, bindPersistence, unbindPersistence]);

  // Storyboard hydration: read the open project's cells from disk (via
  // storyboard.read) so Canvas/Cell render REAL cells. In mock/standalone mode
  // this loads the mock's storyboard and the views fall back to their fixture.
  const hydrateStoryboard = useStoryboardStore((s) => s.hydrate);
  const refetchStoryboard = useStoryboardStore((s) => s.refetch);
  const clearStoryboard = useStoryboardStore((s) => s.clear);
  useEffect(() => {
    const projectId = openProjectSummary?.project_id;
    if (projectId) void hydrateStoryboard(projectId);
    else clearStoryboard();
  }, [openProjectSummary?.project_id, hydrateStoryboard, clearStoryboard]);

  // Live FS event subscription (Plan 25 / WP-26): whenever Chi or an external
  // process writes storyboard.json, the sidecar watcher emits `cells/changed`.
  // Refetch immediately without waiting for a poll tick or user refresh.
  useEffect(() => {
    const projectId = openProjectSummary?.project_id;
    if (!projectId || standalone) return;
    return subscribeStudioEvent('cells/changed', (payload) => {
      if (!payload.project_id || payload.project_id === projectId) {
        void refetchStoryboard();
      }
    });
  }, [openProjectSummary?.project_id, standalone, refetchStoryboard]);

  // Render-status poll (adaptive): fast only while a render is in flight, idle
  // otherwise — kills the old unconditional 2.5s global chatter
  // (`poll-render-list-unbounded`). Still app-wide so the NowRenderingBeacon +
  // the Composition timeline both reflect live running→done regardless of which
  // view is mounted. No-op in mock/standalone.
  useRenderPoll();

  // The launcher pre-empts the pane layout entirely — it isn't a sub-view
  // and doesn't share the layout/view-switcher chrome (launcher.md §"Chrome
  // & Navigation": "There is no pane chrome or view-switcher"). It unmounts
  // the moment a project opens. While a resume is in flight, the skeleton
  // above pre-empts the Launcher itself so no Launcher mount (and its own
  // archetype/recents loaders) ever happens for the common resume path.
  if (!isProjectOpen) {
    if (resume.phase === 'pending') {
      return <ResumeSkeleton name={resume.target.name || resume.target.path} />;
    }
    return (
      <LauncherView
        resumeError={resume.phase === 'failed' ? { name: resume.name, detail: resume.detail } : null}
        onDismissResumeError={() => setResume({ phase: 'idle' })}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-base text-fg">
      {/* In-shell the app bar is GONE (founder call, 2026-07-12): the M-A rail
          already carries the project header + layout seg, so the bar was pure
          redundancy. Standalone (pnpm dev — no shell rail) keeps it: it is the
          only place the brand, project context, and LayoutSwitcher exist. */}
      {standalone && (
        <header className="flex items-center justify-between border-b border-soft bg-sunken px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            {/* pkg id lives in the tooltip / debug only — not user-facing chrome. */}
            <span
              className="font-display text-sm font-semibold tracking-tight"
              title="com.ikenga.studio"
            >
              Studio
            </span>
            {openProjectSummary?.name && (
              <>
                <span className="text-fg-faint">·</span>
                <button
                  type="button"
                  onClick={() => closeProject()}
                  title="Close project — back to the launcher"
                  aria-label="Close project and return to the launcher"
                  className="truncate rounded font-mono text-[11px] text-fg-muted hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_oklab,var(--info)_45%,transparent)]"
                >
                  {openProjectSummary.name}
                </button>
                {openProjectSummary.aspect_ratio && (
                  <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] text-fg-faint">
                    {openProjectSummary.aspect_ratio}
                  </span>
                )}
              </>
            )}
          </div>
          <LayoutSwitcher />
        </header>
      )}
      <PaneRegion />
      {/* Layout-independent rendering beacon — floats over every view/layout
          (fixed positioning), visible whenever a render is in flight. */}
      <NowRenderingBeacon />
    </div>
  );
}
