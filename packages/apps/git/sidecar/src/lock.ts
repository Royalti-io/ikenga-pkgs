/**
 * com.ikenga.git · sidecar — `.git/index.lock` contention (G-13).
 *
 * The premise of this whole pkg is that the user's agents are committing in
 * the same repos while the UI stages. Those writers cannot be serialised
 * against — they are separate processes that took the lock before we asked.
 *
 * The plan (01-plan.md §Concurrency) asks for two things:
 *
 *   · **serialise our own mutations with a per-repo mutex.** Round 4 removed
 *     the process that could have held one: `manifest.sidecars[]` are not
 *     supervised and `host.pkgSidecarCall` spawns a FRESH process per call,
 *     so there is no shared address space in which a mutex could live. The
 *     mutex would have had to become a lockfile — a second, worse copy of the
 *     thing git already implements correctly. So the guarantee is delegated:
 *     `.git/index.lock` IS the mutex, and two concurrent one-shot sidecars
 *     contend through it exactly as two concurrent `git add`s would.
 *
 *   · **retry with bounded backoff and report a named state.** That is what
 *     lives here. `INDEX_LOCK_RETRIES` / `INDEX_LOCK_BACKOFF_MS` come from the
 *     frozen contract, and exhausting them yields `index-locked` carrying
 *     `retries` — which the UI renders as "another process is writing to this
 *     repo — retrying", never as a raw git error.
 *
 * Reads never come through here: they run `--no-optional-locks` and do not
 * take the lock at all (verification 10).
 */

import {
  INDEX_LOCK_BACKOFF_MS,
  INDEX_LOCK_RETRIES,
  isGitError,
  type GitError,
} from '../../core/src/index.js';
import { sleep } from './util.js';

/**
 * Run a mutating operation, retrying while git reports a held `index.lock`.
 *
 * `attempt` is invoked at most `INDEX_LOCK_RETRIES + 1` times. Any outcome
 * other than `index-locked` — success or a different failure — returns
 * immediately; retrying a `dirty-tree` would just be slow.
 *
 * The final `index-locked` error is re-stamped with the number of retries
 * spent, so the UI can say "still locked after 5 tries" rather than implying
 * a single instantaneous failure.
 */
export async function withIndexLockRetry<T extends { ok: true }>(
  attempt: () => Promise<T | GitError>
): Promise<T | GitError> {
  let last: T | GitError = await attempt();

  for (let i = 0; i < INDEX_LOCK_RETRIES; i += 1) {
    if (!isGitError(last) || last.reason !== 'index-locked') return last;
    await sleep(INDEX_LOCK_BACKOFF_MS[i] ?? INDEX_LOCK_BACKOFF_MS[INDEX_LOCK_BACKOFF_MS.length - 1] ?? 800);
    last = await attempt();
  }

  if (isGitError(last) && last.reason === 'index-locked') {
    return { ...last, retries: INDEX_LOCK_RETRIES };
  }
  return last;
}
