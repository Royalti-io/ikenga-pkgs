// com.ikenga.studio · last-opened-project persistence
//
// A sidecar/MCP restart (every dev-reload included) drops the sidecar's
// in-memory open-project registry, so the UI falls back to the Launcher and
// the user loses the project they were in (audit: project-open-not-rehydrated).
// This module persists the LAST opened project's path so the Launcher can
// auto-reopen it on the next real-mode connect.
//
// Sink + guards mirror layout-persistence.ts exactly: localStorage keyed on the
// pkg id, every access wrapped so an opaque `srcdoc` origin / private-mode /
// quota error degrades silently to "no persisted project" rather than throwing
// into the view. The Studio iframe is `srcdoc`-inlined by the shell and inherits
// the parent origin under WebKitGTK, so localStorage is available + stable
// across remounts.

const KEY = 'com.ikenga.studio:last-project';

export interface LastProject {
  /** The on-disk project root path — the reopen key (projectApi.open(path)). */
  path: string;
  /** The projectId the sidecar last issued for this path (diagnostic only —
   *  the sidecar re-derives/reuses it on open). */
  project_id: string;
  /** Display name for the "Reopening <name>…" state. */
  name: string;
  /** Epoch ms this entry was written. */
  ts: number;
}

/** Resolve a usable `localStorage`, or `null` when the origin forbids it.
 *  Probes with a throwaway write so an opaque `srcdoc` origin surfaces its
 *  SecurityError here (once) instead of at every read/write site. */
function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__studio_lastproject_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Load the persisted last-opened project, or `null` if none/invalid. */
export function loadLastProject(): LastProject | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastProject>;
    if (typeof parsed.path !== 'string' || parsed.path.length === 0) return null;
    return {
      path: parsed.path,
      project_id: typeof parsed.project_id === 'string' ? parsed.project_id : '',
      name: typeof parsed.name === 'string' ? parsed.name : parsed.path,
      ts: typeof parsed.ts === 'number' ? parsed.ts : 0,
    };
  } catch {
    return null;
  }
}

/** Persist the last-opened project. No-ops (never throws) when the origin
 *  forbids storage. A missing/empty path is ignored — we never persist a row
 *  we couldn't reopen. */
export function saveLastProject(entry: LastProject): void {
  if (!entry.path) return;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(entry));
  } catch {
    // quota / opaque origin — degrade to no-persistence.
  }
}

/** Forget the persisted last-opened project (project closed, or a reopen
 *  failed because it moved / access was denied). */
export function clearLastProject(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    // ignore
  }
}
