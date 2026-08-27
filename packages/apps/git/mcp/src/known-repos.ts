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
 * "known repos" is simply the union of one bounded scan per known project
 * root, deduped.
 */

import { resolveProjectRoot, scanForRepos } from '../../core/src/discover.js';
import { resolveKnownRoots } from './iyke-client.js';

export async function listKnownRepos(): Promise<string[]> {
  const rootsOutcome = await resolveKnownRoots();
  if (!rootsOutcome.ok) return [];

  const repos = new Set<string>();
  for (const root of rootsOutcome.roots) {
    const resolved = await resolveProjectRoot(root);
    if (resolved.ok !== true) continue; // unreadable root — skip, don't crash the reconcile loop
    const scan = await scanForRepos(resolved.root);
    for (const r of scan.repos) repos.add(r);
  }
  return [...repos];
}
