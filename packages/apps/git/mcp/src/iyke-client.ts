/**
 * com.ikenga.git · MCP — minimal iyke HTTP client + known-project-roots
 * resolver.
 *
 * §MCP threat model / §G-04: "Every tool takes an explicit `repo`, resolved
 * against the `projects` table's known roots (via the iyke bridge) and
 * refused outside them." This module is that resolution's only network call.
 * It talks to the SAME bearer-token localhost bridge `@ikenga/mcp-iyke` and
 * `iyke-cli` use (`GET /iyke/project/list`) — see `control.ts`.
 *
 * Deliberately narrow: this pkg needs exactly one read (the project list) and
 * never writes through iyke. No generic `get`/`post` surface, unlike
 * `mcp-iyke`'s `IykeClient` — that generality is for a CLI that drives the
 * whole app; this is for one containment check.
 */

import { load, type ControlFile } from './control.js';

export interface KnownProject {
  id: string;
  displayName: string;
  /** Absolute path, or null (Default / skill-only projects — G-05 states
   *  (a)/(b)). Null entries are never a "known root". */
  rootPath: string | null;
}

export type KnownRootsOutcome =
  | { ok: true; roots: readonly string[]; projects: readonly KnownProject[] }
  | { ok: false; reason: 'app-not-running' | 'unreachable'; message: string };

const REQUEST_TIMEOUT_MS = 5000;

interface ProjectListResponseRow {
  id: string;
  display_name: string;
  root_path: string | null;
  archived_at: number | null;
}

async function getJson<T>(cf: ControlFile, path: string): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${String(cf.port)}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cf.token}` },
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET ${path} returned HTTP ${String(res.status)}: ${body}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function toKnownProject(p: ProjectListResponseRow): KnownProject {
  return { id: p.id, displayName: p.display_name, rootPath: p.root_path };
}

async function fetchProjectList(cf: ControlFile): Promise<KnownProject[]> {
  const body = await getJson<{ projects: ProjectListResponseRow[] }>(cf, '/iyke/project/list');
  return body.projects.filter((p) => p.archived_at === null).map(toKnownProject);
}

/**
 * Resolve the set of project roots the running Ikenga desktop app currently
 * knows about. Never throws — a `{ok:false}` here is what `repo-resolve.ts`
 * turns into `repo-not-known`, because "the app isn't running" and "this repo
 * genuinely isn't a known project" both mean the same thing to a caller: this
 * tool cannot vouch for `repo`.
 */
export async function resolveKnownRoots(): Promise<KnownRootsOutcome> {
  const outcome = load();
  switch (outcome.kind) {
    case 'missing':
      return { ok: false, reason: 'app-not-running', message: 'no control.json found' };
    case 'stale-removed':
      return {
        ok: false,
        reason: 'app-not-running',
        message: 'control.json was stale (dead pid) and has been cleared',
      };
    case 'stale-young':
      return {
        ok: false,
        reason: 'app-not-running',
        message: `control.json's pid is dead but the file is only ${String(outcome.ageSecs)}s old; app may be starting`,
      };
    case 'ok':
      break;
  }

  try {
    const projects = await fetchProjectList(outcome.control);
    const roots = projects
      .map((p) => p.rootPath)
      .filter((r): r is string => r !== null && r.length > 0);
    return { ok: true, roots, projects };
  } catch (err) {
    return { ok: false, reason: 'unreachable', message: describe(err) };
  }
}

function describe(err: unknown): string {
  const e = err as Error;
  return e.name === 'AbortError' ? 'iyke bridge request timed out' : e.message;
}

export type ActiveProjectOutcome =
  | { ok: true; project: KnownProject }
  | { ok: false; reason: 'app-not-running' | 'unreachable'; message: string };

/**
 * The project the user is currently in (`GET /iyke/project/active`).
 *
 * This is the watcher's scope. Watching every known root meant 49 repos and a
 * 44.5 s cold reconcile on this machine — most of it spent binding recursive
 * watches on checkouts (`forks/tauri`, `forks/zed`, `forks/wry`) belonging to
 * projects the user is not looking at, whose `repo.changed` frames no open
 * view would render.
 *
 * The shell emits `projects:active-changed` as a **Tauri event**
 * (`iyke/projects.rs:120`), which reaches webviews only — an MCP process is
 * not a webview and can never subscribe to it. There is no bridge-side
 * subscription surface either, so the honest mechanism is a cheap poll of this
 * endpoint (one localhost GET), and `index.ts` re-reconciles only when the
 * answer actually changes.
 *
 * `project.rootPath` may be `null` (the seed Default / a skill-only project) —
 * that is a legitimate answer meaning "nothing to watch", not a failure, so it
 * comes back as `{ok:true}` with a null root rather than an error.
 */
export async function resolveActiveProject(): Promise<ActiveProjectOutcome> {
  const outcome = load();
  switch (outcome.kind) {
    case 'missing':
      return { ok: false, reason: 'app-not-running', message: 'no control.json found' };
    case 'stale-removed':
      return {
        ok: false,
        reason: 'app-not-running',
        message: 'control.json was stale (dead pid) and has been cleared',
      };
    case 'stale-young':
      return {
        ok: false,
        reason: 'app-not-running',
        message: `control.json's pid is dead but the file is only ${String(outcome.ageSecs)}s old; app may be starting`,
      };
    case 'ok':
      break;
  }

  try {
    const body = await getJson<{ project: ProjectListResponseRow }>(
      outcome.control,
      '/iyke/project/active'
    );
    return { ok: true, project: toKnownProject(body.project) };
  } catch (err) {
    return { ok: false, reason: 'unreachable', message: describe(err) };
  }
}
