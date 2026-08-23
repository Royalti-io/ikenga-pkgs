/**
 * Per-project FS watcher with a 250ms debounce window.
 *
 * Watches under `<projectRoot>/`:
 *   • storyboard.json
 *   • script.{json,fountain}
 *   • cells/**
 *   • anchors/**
 *   • blocks/**
 *   • archetypes/**
 *
 * Excludes: renders/**, exports/**, node_modules/**, .git/**.
 *
 * Within a 250ms window we coalesce events to one notification per
 * (cellId, kind) pair. This mirrors the Rust `notify-debouncer-mini` shape
 * described in `plans/studio/01-plan.md` §250ms; chokidar's
 * `awaitWriteFinish` plus a small debounce wrapper is the node analogue.
 *
 * Implementation note: chokidar is `require`-ed dynamically and marked
 * external in the bundle. That avoids a hard typecheck dep and lets us
 * keep the node_modules resolution at runtime.
 */

import { sep } from 'node:path';

import {
  emitCellsChanged,
  type EventWriter,
  type CellsChangedPayload,
} from './events.js';

export interface WatcherOptions {
  /**
   * Debounce window in ms — defaults to 50. The G18 contract caps total
   * touch→emit latency at 250ms; coalescing burst writes within 50ms gives
   * us comfortable headroom over chokidar's event-loop overhead while
   * still merging the typical "atomic write" sequence
   * (`tmp` → `rename` → `chmod`) into one notification.
   */
  debounceMs?: number;
  /** Override the event writer (default: stdout). */
  writer?: EventWriter;
}

export interface WatcherHandle {
  close(): Promise<void>;
  /** Latest emit timestamp for testing latency. */
  lastEmitTs(): number | null;
}

type ChangeKind = CellsChangedPayload['kind'];

interface PendingChange {
  cellId: string;
  kind: ChangeKind;
  path: string;
}

// Same shape as plans/studio/01-plan.md §"Sub-view refresh".
const WATCH_GLOBS = [
  'storyboard.json',
  'script.json',
  'script.fountain',
  'cells/**',
  'anchors/**',
  'blocks/**',
  'archetypes/**',
  '.studio/**',
];

const IGNORED = [
  '**/renders/**',
  '**/exports/**',
  '**/node_modules/**',
  '**/.git/**',
];

/**
 * Derive the cellId from a watcher path. For `cells/<rungDir>/<uid>/<file>`
 * the cellId is `<uid>`. For project-root files (`storyboard.json`,
 * `script.*`) or files outside `cells/`, we return a synthetic id so the
 * caller can still display the path.
 */
function deriveCellId(projectRoot: string, absPath: string): string {
  // Normalize the project root with a trailing sep so the relative slice
  // starts cleanly.
  const root = projectRoot.endsWith(sep) ? projectRoot : projectRoot + sep;
  const rel = absPath.startsWith(root) ? absPath.slice(root.length) : absPath;
  const parts = rel.split(sep);
  if (parts[0] === 'cells' && parts.length >= 3) {
    // cells/<rungDir>/<uid>/...
    return parts[2];
  }
  if (parts[0] === 'anchors' || parts[0] === 'blocks' || parts[0] === 'archetypes') {
    return `${parts[0]}:${parts[1] ?? ''}`;
  }
  if (parts.length === 1 && (parts[0] === 'storyboard.json' || parts[0].startsWith('script.'))) {
    return `project:${parts[0]}`;
  }
  return `path:${rel}`;
}

export async function startWatcher(
  projectId: string,
  projectRoot: string,
  opts: WatcherOptions = {},
): Promise<WatcherHandle> {
  const debounceMs = opts.debounceMs ?? 50;
  const writer = opts.writer ?? ((line: string) => process.stdout.write(line + '\n'));

  // Chokidar honours two global env vars that override constructor opts:
  // `CHOKIDAR_USEPOLLING` (forces stat-polling instead of inotify/fsevents)
  // and `CHOKIDAR_INTERVAL` (the poll period). In typical dev shells those
  // are set as a workaround for NFS / Docker-overlay filesystems and push
  // latency to 500-1000ms — well over the G18 250ms cap. The sidecar runs
  // against the user's local FS where inotify works, so we suppress both
  // for the duration of our `chokidar.watch()` constructor call and log
  // the override so devs aren't surprised when their global hack is
  // ignored here.
  const prevUsePolling = process.env.CHOKIDAR_USEPOLLING;
  const prevInterval = process.env.CHOKIDAR_INTERVAL;
  if (prevUsePolling !== undefined || prevInterval !== undefined) {
    process.stderr.write(
      `[studio-sidecar][watcher] suppressing CHOKIDAR_USEPOLLING=${prevUsePolling ?? ''}` +
        ` CHOKIDAR_INTERVAL=${prevInterval ?? ''} for this watcher (G18 latency contract)\n`,
    );
    delete process.env.CHOKIDAR_USEPOLLING;
    delete process.env.CHOKIDAR_INTERVAL;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chokMod: any = await import('chokidar');
  const chokidar = chokMod.default ?? chokMod;

  // Resolve globs against projectRoot — chokidar accepts absolute paths
  // directly, so we just prefix them.
  const targets = WATCH_GLOBS.map((g) => `${projectRoot}/${g}`);

  // Note on `awaitWriteFinish`: useful for noisy editors that write in
  // chunks, but it adds at least one `stabilityThreshold` worth of latency
  // before the event fires. Our debounce window already coalesces burst
  // writes (and the Excalidraw atomic-save contract — write `.tmp` then
  // `rename()` — produces a single `add`/`change` event, not a chunked
  // write), so we keep awaitWriteFinish off to stay comfortably under the
  // 250ms G18 cap.
  const watcher = chokidar.watch(targets, {
    ignored: IGNORED,
    ignoreInitial: true,
    awaitWriteFinish: false,
    persistent: true,
    usePolling: false,
  });

  // Debounce buffer keyed by `cellId|kind` so repeated events for the
  // same logical change coalesce.
  const pending = new Map<string, PendingChange>();
  let flushTimer: NodeJS.Timeout | null = null;
  let lastEmit: number | null = null;

  const scheduleFlush = (): void => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const batch = Array.from(pending.values());
      pending.clear();
      for (const change of batch) {
        emitCellsChanged(writer, projectId, change);
      }
      if (batch.length > 0) lastEmit = Date.now();
    }, debounceMs);
  };

  const onEvent = (kind: ChangeKind, absPath: string): void => {
    const cellId = deriveCellId(projectRoot, absPath);
    const key = `${cellId}|${kind}`;
    pending.set(key, { cellId, kind, path: absPath });
    scheduleFlush();
  };

  watcher.on('add', (p: string) => onEvent('created', p));
  watcher.on('change', (p: string) => onEvent('updated', p));
  watcher.on('unlink', (p: string) => onEvent('deleted', p));
  watcher.on('addDir', (p: string) => onEvent('created', p));
  watcher.on('unlinkDir', (p: string) => onEvent('deleted', p));
  watcher.on('error', (err: unknown) => {
    process.stderr.write(
      `[studio-sidecar][watcher][error] ${(err as Error).message}\n`,
    );
  });

  // Wait for chokidar's initial scan to complete before returning. Without
  // this, fresh writes immediately after `project.open` would race the
  // walker — chokidar wouldn't yet have an inotify watch on the cell's
  // parent directory, and the event would arrive only on the slower
  // polling fallback.
  await new Promise<void>((resolveReady) => {
    watcher.once('ready', () => resolveReady());
  });

  // Restore the env vars now that the watcher is configured — anything
  // else in this process that reads them later sees the original values.
  if (prevUsePolling !== undefined) process.env.CHOKIDAR_USEPOLLING = prevUsePolling;
  if (prevInterval !== undefined) process.env.CHOKIDAR_INTERVAL = prevInterval;

  return {
    async close() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await watcher.close();
    },
    lastEmitTs() {
      return lastEmit;
    },
  };
}
