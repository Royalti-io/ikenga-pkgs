/**
 * com.ikenga.git · sidecar — small utilities with no git knowledge.
 *
 * Kept separate so `handlers.ts` reads as git logic and nothing else. Nothing
 * here spawns a process or knows what a repo is.
 */

import { stat } from 'node:fs/promises';
import { relative, sep } from 'node:path';

/**
 * Sleep. Used only by the `index.lock` backoff (`lock.ts`).
 *
 * The timer is deliberately NOT `unref`'d. It looks like the tidy thing to do
 * in a one-shot process — and it is exactly wrong here. By the time the backoff
 * runs, stdin is closed and no git child is outstanding, so an unref'd timer is
 * the ONLY handle keeping the loop alive: Node exits immediately, with status 0
 * and an empty stdout, and the caller sees a sidecar that answered nothing.
 * (Caught by the `index.lock` test, which failed in 301 ms against a 1550 ms
 * retry budget.) A deliberate wait is work in progress, not idle time.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Does a path exist? Never throws — an unreadable parent reads as "no". */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * `Promise.all` with a concurrency ceiling.
 *
 * `project.scan` on this workspace builds a snapshot for a dozen repos, each
 * of which is three-to-five `git` spawns. Unbounded, that is fifty concurrent
 * processes; serial, it is a second and a half of wall clock. Eight at a time
 * is the compromise, and it is a constant rather than a knob because nothing
 * in the contract lets a caller tune it.
 *
 * Results keep INPUT order regardless of completion order — the rollup's repo
 * ordering is meaningful (root first, then by `relPath`) and must not depend
 * on which repo's `git status` finished first.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  });

  await Promise.all(workers);
  return out;
}

/** Default spawn fan-out for the rollup path. */
export const SCAN_CONCURRENCY = 8;

/**
 * `path.relative`, normalised to forward slashes for display.
 *
 * `RepoSnapshot.relPath` and `NestedRepo.relPath` are display/ordering values
 * that cross into the UI; a Windows backslash there would sort differently and
 * render differently from the same tree on Linux (D10 — cross-platform from
 * P1). The absolute `repo` path stays a real platform path.
 */
export function posixRelative(from: string, to: string): string {
  const rel = relative(from, to);
  return rel.length === 0 ? '.' : rel.split(sep).join('/');
}

/** Epoch milliseconds. One call site per response, so a snapshot and the
 *  result that carries it agree on when "now" was. */
export function now(): number {
  return Date.now();
}
