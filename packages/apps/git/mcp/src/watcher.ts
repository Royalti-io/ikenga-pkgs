/**
 * com.ikenga.git · MCP — the `repo.changed` watcher (WP-05 re-scope, R4).
 *
 * "The long-lived MCP = the supervised process ... hosts the `@parcel/
 * watcher` watcher, coalesces, and emits `notifications/message`
 * `{method:'repo.changed', params:{repo, seq, coalesced, at}}` ... The
 * watcher is not a tool." (04-discussion.md Round 4 / 05-tracking.md WP-05)
 *
 * One `RepoWatcher` instance per MCP process. `reconcile(repos)` is called on
 * boot and again whenever the known-repo set might have changed (a fresh
 * `project.list` poll, or after a `git_commit` the MCP itself just made) —
 * subscriptions are added/removed to match, never torn down and rebuilt
 * wholesale (that would drop events mid-reconcile).
 *
 * ── Debounce + hard ceiling (D7 / rpc.ts §5.1) ──────────────────────────────
 *
 * Pure debounce never fires under a continuous event stream (a `rebase`, a
 * large `checkout`, an agent write-storm) — `WATCH_MAX_WAIT_MS` is the ceiling
 * that forces a flush anyway. Per repo, per window:
 *
 *   first relevant event  → start `maxWaitTimer` (WATCH_MAX_WAIT_MS)
 *   every relevant event  → reset `debounceTimer` (WATCH_DEBOUNCE_MS)
 *   debounceTimer fires   → flush (quiet period reached)
 *   maxWaitTimer fires    → flush unconditionally (still bursting)
 *
 * Both timers are `unref()`d so a watcher with no pending flush never holds
 * the process open past its own shutdown.
 *
 * ── Relevance filter ────────────────────────────────────────────────────────
 *
 * `@parcel/watcher`'s `ignore` option cuts the noisiest subtrees
 * (`node_modules`, `.git/objects`, …) at the OS-event level for performance,
 * but is glob-based and coarse. `isRelevantEvent` is the second, precise
 * gate: a `.git` change only counts when it touches `HEAD`, `index`, or
 * `refs/**` — exactly the plan's "`.git/{HEAD,index,refs}` + worktree" scope
 * — so e.g. `.git/logs/HEAD` (reflog) churn does not generate noise the UI
 * has no use for.
 */

import { relative, sep } from 'node:path';
// `@parcel/watcher` ships `export = ParcelWatcher` (a CJS namespace holding
// both the runtime functions and the `Event`/`AsyncSubscription` types) —
// `import * as` is the correct interop form, not a default/named import.
import * as watcher from '@parcel/watcher';
import {
  SCAN_SKIP_DIRS,
  WATCH_DEBOUNCE_MS,
  WATCH_MAX_WAIT_MS,
  type RepoChangedParams,
} from '../../core/src/index.js';

type ParcelEvent = watcher.Event;
type AsyncSubscription = watcher.AsyncSubscription;

/** OS-level ignore globs, relative to the watched repo root. Trims the
 *  heaviest, least useful subtrees before an event is even constructed. */
function ignoreGlobsFor(): string[] {
  return [...SCAN_SKIP_DIRS.map((d) => `**/${d}/**`), '.git/objects/**', '.git/lfs/**'];
}

/** Precise relevance gate — see module doc. `relPath` is repo-relative,
 *  POSIX-normalised. */
export function isRelevantEvent(relPath: string): boolean {
  const posix = relPath.split(sep).join('/');
  if (!posix.startsWith('.git/')) {
    // Anywhere in the worktree outside `.git` — a real edit git-status cares
    // about. `SCAN_SKIP_DIRS`/ignore globs already filtered the heavy noise.
    return true;
  }
  const gitRel = posix.slice('.git/'.length);
  return gitRel === 'HEAD' || gitRel === 'index' || gitRel.startsWith('refs/');
}

interface WindowState {
  coalesced: number;
  lastEventAtMs: number;
  debounceTimer: NodeJS.Timeout | null;
  maxWaitTimer: NodeJS.Timeout | null;
}

export type OnRepoChanged = (params: RepoChangedParams) => void;

export class RepoWatcher {
  private readonly subs = new Map<string, AsyncSubscription>();
  private readonly seq = new Map<string, number>();
  private readonly windows = new Map<string, WindowState>();
  private readonly onChanged: OnRepoChanged;
  /** Injectable for tests; defaults to the real native backend. */
  private readonly subscribe: typeof watcher.subscribe;

  constructor(onChanged: OnRepoChanged, subscribeImpl: typeof watcher.subscribe = watcher.subscribe) {
    this.onChanged = onChanged;
    this.subscribe = subscribeImpl;
  }

  /** Currently-watched repos, for diagnostics / tests. */
  get watched(): readonly string[] {
    return [...this.subs.keys()];
  }

  /**
   * Add/remove subscriptions so `this.watched` matches `repos` exactly.
   * Never rebuilds an unchanged subscription — that would create a gap in
   * which a real fs event is missed.
   */
  async reconcile(repos: readonly string[]): Promise<void> {
    const desired = new Set(repos);

    const removals = [...this.subs.keys()].filter((r) => !desired.has(r));
    await Promise.all(removals.map((r) => this.unwatchOne(r)));

    const additions = repos.filter((r) => !this.subs.has(r));
    await Promise.all(additions.map((r) => this.watchOne(r)));
  }

  async stop(): Promise<void> {
    await Promise.all([...this.subs.keys()].map((r) => this.unwatchOne(r)));
  }

  private async watchOne(repo: string): Promise<void> {
    try {
      const sub = await this.subscribe(
        repo,
        (err, events) => {
          if (err) {
            process.stderr.write(`[git-mcp/watcher] ${repo}: ${err.message}\n`);
            return;
          }
          this.onEvents(repo, events);
        },
        { ignore: ignoreGlobsFor() }
      );
      this.subs.set(repo, sub);
    } catch (err) {
      // A repo that fails to bind a watcher (permissions, an exotic fs) must
      // not crash the supervised process — it just never emits `repo.changed`
      // for that one repo; polling fallback is the UI's job (rpc.ts
      // `WATCH_FALLBACK_POLL_MS`), not this module's.
      process.stderr.write(
        `[git-mcp/watcher] failed to watch ${repo}: ${(err as Error).message}\n`
      );
    }
  }

  private async unwatchOne(repo: string): Promise<void> {
    const sub = this.subs.get(repo);
    this.subs.delete(repo);
    const w = this.windows.get(repo);
    if (w) {
      if (w.debounceTimer) clearTimeout(w.debounceTimer);
      if (w.maxWaitTimer) clearTimeout(w.maxWaitTimer);
      this.windows.delete(repo);
    }
    if (sub) {
      try {
        await sub.unsubscribe();
      } catch {
        // Best effort — the process is dropping this repo either way.
      }
    }
  }

  private onEvents(repo: string, events: readonly ParcelEvent[]): void {
    let relevant = 0;
    let lastMs = 0;
    for (const e of events) {
      const rel = relative(repo, e.path);
      if (rel.startsWith('..')) continue; // outside the watched root; ignore
      if (!isRelevantEvent(rel)) continue;
      relevant += 1;
      lastMs = Date.now();
    }
    if (relevant === 0) return;

    let w = this.windows.get(repo);
    if (!w) {
      w = { coalesced: 0, lastEventAtMs: 0, debounceTimer: null, maxWaitTimer: null };
      this.windows.set(repo, w);
    }
    w.coalesced += relevant;
    w.lastEventAtMs = lastMs;

    if (w.debounceTimer) clearTimeout(w.debounceTimer);
    w.debounceTimer = setTimeout(() => this.flush(repo), WATCH_DEBOUNCE_MS);
    w.debounceTimer.unref?.();

    if (!w.maxWaitTimer) {
      w.maxWaitTimer = setTimeout(() => this.flush(repo), WATCH_MAX_WAIT_MS);
      w.maxWaitTimer.unref?.();
    }
  }

  private flush(repo: string): void {
    const w = this.windows.get(repo);
    if (!w || w.coalesced === 0) return;
    if (w.debounceTimer) clearTimeout(w.debounceTimer);
    if (w.maxWaitTimer) clearTimeout(w.maxWaitTimer);

    const nextSeq = (this.seq.get(repo) ?? 0) + 1;
    this.seq.set(repo, nextSeq);

    const params: RepoChangedParams = {
      repo,
      reason: 'fs',
      at: w.lastEventAtMs || Date.now(),
      seq: nextSeq,
      coalesced: w.coalesced,
    };
    this.windows.set(repo, {
      coalesced: 0,
      lastEventAtMs: 0,
      debounceTimer: null,
      maxWaitTimer: null,
    });
    this.onChanged(params);
  }
}
