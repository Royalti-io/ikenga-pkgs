/**
 * com.ikenga.git · MCP — the watcher's repo set.
 *
 * The watcher (`watcher.ts`) needs an up-to-date list of REPO TOPLEVELS, not
 * project roots: a project root can itself be a non-repo directory
 * containing nested clones (`ProjectRollup.rootIsRepo: false`, rpc.ts DELTA
 * 3), and the whole point of watching is to catch an agent committing in a
 * *nested* repo the user never explicitly opened.
 *
 * `scanForRepos` already includes a root itself when `root/.git` exists, so
 * the repo set for one project is a single bounded scan of its root.
 *
 * ── Scope: the ACTIVE project, not every known project ──────────────────────
 *
 * Watching the union of ALL known roots meant 49 repos here and a 44.5 s cold
 * reconcile — the scan and the recursive watch binds were dominated by
 * checkouts (`forks/tauri`, `forks/zed`, `forks/wry`) under projects the user
 * was not in, whose `repo.changed` frames no open view could render. The UI's
 * unit is "a project containing N repos" (D2), and it only ever shows one
 * project at a time, so the watcher's scope is that project.
 *
 * This is deliberately NARROWER than the tool-containment set: `repo-resolve.
 * ts` still authorizes a `repo` argument against EVERY known project root
 * (`resolveKnownRoots`), because an agent may legitimately call `git_status`
 * on a repo in a project the user is not currently looking at. Watching and
 * authorizing are different questions; conflating them would either leak the
 * cost back or break cross-project tool calls.
 */

import { resolveProjectRoot, scanForRepos } from '../../core/src/discover.js';
import { resolveActiveProject } from './iyke-client.js';

export interface ActiveRepoSet {
  /** Repo toplevels to watch. Empty when there is no active project root. */
  repos: string[];
  /** Identity of the scope these repos came from — `<projectId>@<root>`, or
   *  `null` when there is nothing to watch. `index.ts` compares this between
   *  polls to decide whether the active project actually changed; comparing
   *  the repo LIST instead would re-reconcile on every fresh clone. */
  scopeKey: string | null;
}

const EMPTY: ActiveRepoSet = { repos: [], scopeKey: null };

/**
 * The repos under the currently-active project.
 *
 * Never throws and never partially fails: an unreachable bridge, an archived
 * project, or a root that has been deleted all yield an empty set, which the
 * watcher reconciles to "watch nothing" rather than crashing the supervised
 * process or stranding watches on a root that no longer exists.
 */
export async function listActiveProjectRepos(): Promise<ActiveRepoSet> {
  const active = await resolveActiveProject();
  if (!active.ok) return EMPTY;

  const root = active.project.rootPath;
  // G-05 state (b): the seed Default / a skill-only project has no root. There
  // is genuinely nothing to watch — not an error.
  if (root === null || root.length === 0) return EMPTY;

  const resolved = await resolveProjectRoot(root);
  if (resolved.ok !== true) return EMPTY; // unreadable root — watch nothing

  const scan = await scanForRepos(resolved.root);
  return { repos: scan.repos, scopeKey: `${active.project.id}@${resolved.root}` };
}
