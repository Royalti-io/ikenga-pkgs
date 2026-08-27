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

async function fetchProjectList(cf: ControlFile): Promise<KnownProject[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${cf.port}/iyke/project/list`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cf.token}` },
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET /iyke/project/list returned HTTP ${res.status}: ${body}`);
    }
    const body = (await res.json()) as { projects: ProjectListResponseRow[] };
    return body.projects
      .filter((p) => p.archived_at === null)
      .map((p) => ({ id: p.id, displayName: p.display_name, rootPath: p.root_path }));
  } finally {
    clearTimeout(timer);
  }
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
    const e = err as Error;
    return {
      ok: false,
      reason: 'unreachable',
      message: e.name === 'AbortError' ? 'iyke bridge request timed out' : e.message,
    };
  }
}
