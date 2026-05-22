/**
 * Shared storyboard.json read/atomic-write helpers (WP-03b).
 *
 * Every storyboard / anchor write goes through `writeProjectAtomic`, which
 * writes to a sibling `.tmp` file and `rename()`s it over the target. POSIX
 * rename is atomic, so the 250ms FS watcher never observes a partially
 * written `storyboard.json` (it sees exactly one `change` event for the
 * final bytes).
 *
 * The watcher already emits `cells/changed` whenever `storyboard.json`
 * changes, so storyboard/anchor mutations rely on the watcher for event
 * emission rather than emitting directly — this avoids the double-emit the
 * brief warns about. (Render events are different: they originate from the
 * adapter's `ctx.emit`, not an FS write under a watched path, so the
 * render-runner emits those directly.)
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { ProjectSchema, type Project } from '@ikenga/studio-schema';

export function storyboardPath(projectRoot: string): string {
  return join(projectRoot, 'storyboard.json');
}

/** Read + Zod-validate the project document from disk. Throws on missing/invalid. */
export function readProject(projectRoot: string): Project {
  const sb = storyboardPath(projectRoot);
  if (!existsSync(sb)) {
    throw new Error(`storyboard.json not found at ${sb}`);
  }
  const body = readFileSync(sb, 'utf8');
  return ProjectSchema.parse(JSON.parse(body) as unknown);
}

/**
 * Re-validate + atomically persist a project document. Bumps `updated_at`.
 * tmp+rename guarantees the watcher never sees a partial file.
 */
export function writeProjectAtomic(projectRoot: string, project: Project): Project {
  const next: Project = ProjectSchema.parse({
    ...project,
    updated_at: new Date().toISOString(),
  });
  const target = storyboardPath(projectRoot);
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.storyboard.${randomUUID().slice(0, 8)}.tmp.json`);
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
  return next;
}
