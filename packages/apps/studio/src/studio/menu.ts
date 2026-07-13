// com.ikenga.studio · shell side-menu (M-A "production ledger") + click routing
//
// The shell renders the App-mode sidebar from the PkgMenuItem[] this module
// publishes via host.pkg.setMenu; the pkg owns the STRUCTURE (sections, badges,
// seg strip, disabled/active), the shell owns the pixels. This is the locked
// M-A variant (plans/studio/designs/redesign/side-menu-variants.html):
//
//   PROJECT OPEN                       NO PROJECT
//   ┌──────────────────────────┐       ┌──────────────────────────┐
//   │ <project name>  ·meta·   │(dim)  │ ▸ Launcher       (active)│
//   │ [Single|V|H|3-Pane] seg  │       │ ── Jump back in ──       │
//   │ ── Compose ──            │       │ 📁 <recent>          1m  │
//   │ ▸ Canvas             6   │       │ 📁 <recent>         13h  │
//   │   Cell           c1-hook │       └──────────────────────────┘
//   │   Script                 │
//   │ ── Deliver ──           │
//   │   Composition       6/6  │
//   │ ── Library ──           │
//   │   Archetypes             │
//   └──────────────────────────┘
//
// Every badge is a REAL seam only (no fixtures): cell count + rendered-coverage
// (or the running count while a batch is in flight) + active cell uid + relative
// recents age. Icons are chosen ONLY from the shell's 14-name ICONS map
// (pkg-mode.tsx) — an unmapped name silently renders as the Package box.
//
// Publish is DEBOUNCED (150ms trailing) and DEDUPED on a serialized snapshot, so
// a burst of store writes (ratio drags, render-poll ticks that don't change a
// visible count, playhead scrubs) coalesces into at most one host call, and a
// no-op rebuild never re-hits the host at all.

import {
  getHostContext,
  isStandalone,
  onHostContextChange,
  setMenu,
  type PublishedMenuItem,
} from './bridge';
import { useLayoutStore } from './layout-store';
import { useProjectStore, type OpenProjectSummary } from './project-store';
import { useStoryboardStore } from './storyboard-store';
import { useSharedStore } from './shared-state';
import { openProjectByPath } from './lib/open-project';
import { buildTimelineModel } from './lib/composition-model';
import { normalizeRecent, formatAgo, type RecentRow } from './views/launcher/presentation';
import { projectApi, getMcpClient } from './mcp-client';
import { LAYOUT_ORDER, VIEW_IDS, type LayoutId, type ViewId } from './routes';

const VIEW_ID_SET: ReadonlySet<string> = new Set(VIEW_IDS);

// ── icon choices (must exist in shell/src/shell/sidebar-modes/pkg-mode.tsx) ──
const ICON = {
  project: 'folder-kanban',
  canvas: 'layout-dashboard',
  cell: 'pencil',
  script: 'list-checks',
  composition: 'activity',
  archetype: 'package',
  launcher: 'sun',
  recent: 'folder',
} as const;

// Layout glyphs for the seg strip (founder call 2026-07-12: icons, not text).
// The shell's seg options carry only a text `label` — no icon slot — so these
// are unicode box glyphs, one visual family: whole pane / vertical split /
// horizontal split / mixed grid. Screen readers announce them poorly ("white
// square") — proper option icons need a shell-side Segmented extension, noted
// as a follow-up in plans/studio/15-ui-redesign.md.
const LAYOUT_SEG_LABEL: Record<LayoutId, string> = {
  single: '▢',
  vsplit: '◫',
  hsplit: '⊟',
  tripane: '⊞',
};

// ── no-project recents (loaded lazily, shell-only) ──────────────────────────
let recents: RecentRow[] = [];
let recentsLoadToken = 0;

async function loadRecentsForMenu(): Promise<void> {
  const token = ++recentsLoadToken;
  try {
    const client = await getMcpClient();
    const { projects } = await projectApi.list(client);
    const rows = (projects ?? [])
      .map(normalizeRecent)
      .filter((r): r is RecentRow => r !== null && r.exists) // skip exists:false rows
      .slice(0, 3); // up to 3 jump rows
    if (token !== recentsLoadToken) return; // a newer load superseded this one
    recents = rows;
  } catch {
    if (token !== recentsLoadToken) return;
    recents = [];
  }
  scheduleRepublish();
}

// ── menu builders ───────────────────────────────────────────────────────────

/** archetype · aspect · duration · N cells — every segment dropped unless its
 *  field is a real, loaded value (honesty rule: no fabricated header meta). */
function projectMeta(project: OpenProjectSummary): string {
  const sb = useStoryboardStore.getState();
  const cellCount = sb.cells.length;
  const loaded = sb.source !== 'empty';
  const segs: string[] = [];
  if (project.archetype_id) segs.push(project.archetype_id);
  if (project.aspect_ratio) segs.push(project.aspect_ratio);
  if (loaded && cellCount > 0) {
    // Reuse the Composition timeline math so the header duration is the SAME
    // [start,start+duration) sum the delivery view shows — not a second guess.
    const totalMs = buildTimelineModel(sb.cells, sb.projectDoc, {}).totalMs;
    segs.push(`${(totalMs / 1000).toFixed(1)}s`);
  }
  if (loaded) segs.push(`${cellCount} cell${cellCount === 1 ? '' : 's'}`);
  return segs.join(' · ');
}

function buildProjectMenu(project: OpenProjectSummary): PublishedMenuItem[] {
  const layout = useLayoutStore.getState();
  const focusedView = layout.paneViews[layout.focusedPane];
  const sb = useStoryboardStore.getState();
  const cellCount = sb.cells.length;
  const { cellUid } = useSharedStore.getState();

  // Composition badge: rendered n/m normally; the running count while a batch is
  // in flight (queued/running wins over the coverage number — you want to know
  // work is happening, not the stale ratio).
  const statuses = Object.values(sb.renderStatus);
  const running = statuses.filter((s) => s === 'running' || s === 'queued').length;
  const done = statuses.filter((s) => s === 'done').length;
  let compBadge: string | number | null = null;
  if (cellCount > 0) compBadge = running > 0 ? `${running} rendering` : `${done}/${cellCount}`;

  return [
    // Project header — a disabled row in the implicit first group (no section).
    {
      id: 'project:header',
      label: project.name,
      icon: ICON.project,
      badge: projectMeta(project) || null,
      disabled: true,
    },
    // Layout presets as the locked kind:'seg' strip (replaces the banner radios).
    {
      id: 'layout',
      label: '',
      kind: 'seg',
      options: LAYOUT_ORDER.map((id) => ({
        id: `layout:${id}`,
        label: LAYOUT_SEG_LABEL[id],
        active: id === layout.layout,
      })),
    },
    // Compose
    {
      id: 'canvas',
      label: 'Canvas',
      icon: ICON.canvas,
      section: 'Compose',
      active: focusedView === 'canvas',
      badge: cellCount > 0 ? cellCount : null,
    },
    {
      id: 'cell',
      label: 'Cell',
      icon: ICON.cell,
      section: 'Compose',
      active: focusedView === 'cell',
      badge: cellUid ?? null,
    },
    {
      id: 'script',
      label: 'Script',
      icon: ICON.script,
      section: 'Compose',
      active: focusedView === 'script',
    },
    // Deliver
    {
      id: 'composition',
      label: 'Composition',
      icon: ICON.composition,
      section: 'Deliver',
      active: focusedView === 'composition',
      badge: compBadge,
    },
    // Library
    {
      id: 'archetype',
      label: 'Archetypes',
      icon: ICON.archetype,
      section: 'Library',
      active: focusedView === 'archetype',
    },
  ];
}

function buildNoProjectMenu(): PublishedMenuItem[] {
  const items: PublishedMenuItem[] = [
    { id: 'launcher', label: 'Launcher', icon: ICON.launcher, active: true },
  ];
  for (const row of recents) {
    items.push({
      id: `recent:${row.path}`,
      label: row.name,
      icon: ICON.recent,
      section: 'Jump back in',
      badge: formatAgo(row.lastOpened).replace(' ago', '') || null,
    });
  }
  return items;
}

function buildMenu(): PublishedMenuItem[] {
  const { isOpen, project } = useProjectStore.getState();
  if (isOpen && project) return buildProjectMenu(project);
  return buildNoProjectMenu();
}

// ── debounced + deduped publish ─────────────────────────────────────────────
let republishTimer: ReturnType<typeof setTimeout> | null = null;
let lastSerialized = '';

/** Build → serialize → publish only if the menu-visible snapshot changed. */
function publishNow(): void {
  const items = buildMenu();
  const serialized = JSON.stringify(items);
  if (serialized === lastSerialized) return; // nothing menu-visible changed
  lastSerialized = serialized;
  void setMenu(items).catch((err) => {
    console.warn('[studio] host.pkg.setMenu failed', err);
  });
}

/** Coalesce a burst of store writes into one trailing publish (~150ms). */
function scheduleRepublish(): void {
  if (republishTimer) clearTimeout(republishTimer);
  republishTimer = setTimeout(() => {
    republishTimer = null;
    publishNow();
  }, 150);
}

// ── click routing ───────────────────────────────────────────────────────────
//
// GUARD SEMANTICS (extended deliberately across every id namespace):
//
// The shell re-emits the whole hostContext on unrelated events (theme flips,
// supabaseJwt refresh, …), carrying the LAST-clicked activeFeature each time. We
// must act on a given selection EXACTLY ONCE. For view ids and `layout:` this
// would be harmless to re-apply (both setPaneView + setLayout are idempotent),
// but `recent:<path>` is DESTRUCTIVE — re-acting on it re-runs project.open and
// resets the workspace. So the single `feature === lastFeature` gate protects
// the whole namespace set uniformly: a passive re-emit of the unchanged feature
// is dropped, and only a genuinely new activeFeature value routes. `lastFeature`
// is advanced SYNCHRONOUSLY before the (async) recent-open so a re-emit that
// lands mid-open can't double-fire. (Same conservative rule as the sub-route
// deep-link work — a stale re-emit must lose.)
//
// KNOWN ISSUE (shell-side, not fixable here): open a recent from the rail →
// close the project → click the SAME recent row again, and the click is
// swallowed — the shell's activeFeature store dedups the unchanged id before
// the pkg ever sees a change event, so this gate never even runs. The Launcher
// pane's own recent rows call openProjectByPath directly and are the escape
// hatch. A real fix needs the shell to re-emit repeat clicks (or clear
// activeFeature on project close).
function routeFeature(feature: string): void {
  if (feature.startsWith('layout:')) {
    const id = feature.slice('layout:'.length) as LayoutId;
    if (LAYOUT_ORDER.includes(id)) useLayoutStore.getState().setLayout(id);
    return;
  }
  if (feature.startsWith('recent:')) {
    const path = feature.slice('recent:'.length);
    if (!path) return;
    const row = recents.find((r) => r.path === path);
    void openProjectByPath(path, row?.name ?? path).catch((err) => {
      console.warn('[studio] recent open failed', err);
    });
    return;
  }
  if (VIEW_ID_SET.has(feature)) {
    const { focusedPane, setPaneView } = useLayoutStore.getState();
    setPaneView(focusedPane, feature as ViewId);
    return;
  }
  // 'launcher' / 'project:header' (disabled) / unknown → no side effect.
}

// ── lifecycle ───────────────────────────────────────────────────────────────

/** Publish the M-A menu and wire click routing + republish triggers. Call once
 *  after the bridge is connected (App mount). Returns a cleanup fn. Inert in
 *  standalone (no parent shell renders a side-menu). */
export function initStudioMenu(): () => void {
  if (isStandalone()) return () => {};

  // Seed recents for the no-project state (the launcher-open state on first mount).
  if (!useProjectStore.getState().isOpen) void loadRecentsForMenu();
  publishNow();

  // Republish trigger A — project open/close + identity (name/archetype/aspect).
  const unsubProject = useProjectStore.subscribe((state, prev) => {
    const openChanged = state.isOpen !== prev.isOpen;
    if (!openChanged && state.project === prev.project) return;
    if (openChanged) {
      if (state.isOpen) recents = []; // clear stale recents while a project is open
      else void loadRecentsForMenu(); // returning to the desk → refresh jump rows
    }
    scheduleRepublish();
  });

  // Republish trigger B — layout preset + focused-pane view change (both change
  // seg-active + which view row is highlighted). Ratio drags are ignored here.
  const unsubLayout = useLayoutStore.subscribe((state, prev) => {
    if (
      state.layout !== prev.layout ||
      state.focusedPane !== prev.focusedPane ||
      state.paneViews[state.focusedPane] !== prev.paneViews[prev.focusedPane]
    ) {
      scheduleRepublish();
    }
  });

  // Republish trigger C — storyboard cell count / render coverage / running count
  // / source / project doc (duration). renderStatus is a fresh object per poll;
  // the serialize-dedup swallows ticks that don't change a visible badge.
  const unsubStoryboard = useStoryboardStore.subscribe((state, prev) => {
    if (
      state.cells.length !== prev.cells.length ||
      state.source !== prev.source ||
      state.renderStatus !== prev.renderStatus ||
      state.projectDoc !== prev.projectDoc
    ) {
      scheduleRepublish();
    }
  });

  // Republish trigger D — active cell uid (Cell row badge). Selector-scoped so
  // playhead scrubs (which also live on shared-state) don't reset the debounce.
  const unsubShared = useSharedStore.subscribe((s) => s.cellUid, () => scheduleRepublish());

  // Click routing — menu clicks arrive as royaltiSuite.activeFeature on the next
  // onhostcontextchanged. Seed from connect-time context so the FIRST change only
  // acts on a real new click (a re-emit of the seeded stale value loses).
  let lastFeature = getHostContext()?.royaltiSuite?.activeFeature;
  const unsubCtx = onHostContextChange((ctx) => {
    const feature = ctx.royaltiSuite?.activeFeature;
    if (feature === lastFeature) return; // passive re-emit of the same selection
    lastFeature = feature; // advance BEFORE any (async) side effect
    if (feature) routeFeature(feature);
  });

  return () => {
    if (republishTimer) clearTimeout(republishTimer);
    republishTimer = null;
    unsubProject();
    unsubLayout();
    unsubStoryboard();
    unsubShared();
    unsubCtx();
  };
}
