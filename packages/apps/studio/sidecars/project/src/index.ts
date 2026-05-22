/**
 * com.ikenga.studio — project sidecar entry.
 *
 * Long-lived Node-ESM process; bundled by `bun build --target=node
 * --format=esm` (see ./build.sh). Owns:
 *
 *   • Project FS (open/close/list/create/info via JSON-RPC over stdio)
 *   • Render queue (SQLite-backed)
 *   • LRU cell cache
 *   • Per-project FS watcher emitting `pkg://com.ikenga.studio/*` events
 *
 * CLI flags:
 *   --self-test:ffmpeg    spawn `ffmpeg -version` and exit 0
 *   --print-data-dir      print resolved $pkg_data dir and exit 0
 *
 * Env:
 *   IKENGA_PKG_DATA        directory for studio.db (default: ~/.local/share/ikenga/studio)
 *   STUDIO_TRUST_STUB=1    auto-grant trust prompts (WP-04 stub)
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  DEFAULT_RESOLUTION,
  ProjectSchema,
  type Project,
} from '@ikenga/studio-schema';

import { describeDb, openDb } from './db.js';
import {
  CellLRU,
  enqueue,
  hydrateProjectCells,
  queueDepth,
  listQueue,
} from './queue.js';
import {
  logErr,
  startRpcLoop,
  toProjectSummary,
  type RpcHandlers,
} from './rpc.js';
import type {
  ErrorCode,
  ProjectInfoResult,
  ProjectListResult,
  ProjectOpenResult,
  ProjectSummary,
} from './rpc-types.js';
import { startWatcher, type WatcherHandle } from './watcher.js';
import { requestProjectAccess } from './trust.js';

// ─────────────────────────────────────────────────────────────────────────
// CLI-flag fast paths
// ─────────────────────────────────────────────────────────────────────────

async function selfTestFfmpeg(): Promise<number> {
  return new Promise<number>((resolveExit) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b: Buffer) => (out += b.toString('utf8')));
    child.stderr.on('data', (b: Buffer) => (out += b.toString('utf8')));
    child.on('error', (err) => {
      process.stderr.write(`[studio-sidecar][self-test:ffmpeg] spawn failed: ${err.message}\n`);
      resolveExit(1);
    });
    child.on('close', (code) => {
      // Self-test contract: write the captured ffmpeg banner to stderr
      // (we have a documented choice — keep stdout reserved for JSON-RPC
      // even in fast-path mode).
      process.stderr.write(out);
      resolveExit(code ?? 0);
    });
  });
}

function printDataDir(): number {
  const { pkgDataDir, dbPath } = describeDb();
  process.stdout.write(JSON.stringify({ pkgDataDir, dbPath }) + '\n');
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Open-project state
// ─────────────────────────────────────────────────────────────────────────

interface OpenProject {
  projectId: string;
  path: string;
  project: Project;
  watcher: WatcherHandle;
}

type Db = Awaited<ReturnType<typeof openDb>>;

const open: Map<string, OpenProject> = new Map();
const lru = new CellLRU(256);

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function err(code: ErrorCode, message?: string) {
  return { ok: false as const, error: code, message };
}

function readProjectFromDisk(projectRoot: string): Project {
  const sbPath = join(projectRoot, 'storyboard.json');
  if (!existsSync(sbPath)) {
    throw new Error(`storyboard.json not found at ${sbPath}`);
  }
  const body = readFileSync(sbPath, 'utf8');
  const parsed = JSON.parse(body) as unknown;
  return ProjectSchema.parse(parsed);
}

function ensureAbsolute(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

function findOpenByPath(path: string): OpenProject | undefined {
  const abs = ensureAbsolute(path);
  for (const v of open.values()) {
    if (v.path === abs) return v;
  }
  return undefined;
}

function findOpenById(projectId: string): OpenProject | undefined {
  return open.get(projectId);
}

function recordProjectMeta(db: Db, p: OpenProject): void {
  db.prepare(
    `INSERT INTO projects (project_id, path, name, last_opened)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE
         SET path = excluded.path,
             name = excluded.name,
             last_opened = excluded.last_opened`,
  ).run(p.projectId, p.path, p.project.title, Date.now());
}

function listKnownProjects(db: Db): ProjectSummary[] {
  const rows = db
    .prepare(
      `SELECT project_id, path, name, last_opened FROM projects ORDER BY last_opened DESC`,
    )
    .all() as Array<{
      project_id: string;
      path: string;
      name: string;
      last_opened: number;
    }>;
  return rows.map(toProjectSummary);
}

// Initialize a fresh project skeleton on disk (used by project.create).
function bootstrapProjectOnDisk(args: {
  archetypeId: string;
  projectRoot: string;
  name: string;
}): Project {
  const { archetypeId, projectRoot, name } = args;
  if (!existsSync(projectRoot)) mkdirSync(projectRoot, { recursive: true });
  for (const sub of ['cells', 'anchors', 'blocks', 'archetypes', 'renders', 'exports']) {
    const d = join(projectRoot, sub);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
  const slug = basename(projectRoot);
  const now = new Date().toISOString();
  const skeleton: Project = ProjectSchema.parse({
    schema_version: 1,
    slug,
    title: name,
    created_at: now,
    updated_at: now,
    mode: 'studio',
    archetype_id: archetypeId,
    aspect_ratio: '16:9',
    resolution: DEFAULT_RESOLUTION['16:9'],
    current_rung: 0,
    anchors: [],
    script: null,
    cells: [],
    narration: null,
    approved: false,
    metadata: {},
  });
  writeFileSync(
    join(projectRoot, 'storyboard.json'),
    JSON.stringify(skeleton, null, 2) + '\n',
    'utf8',
  );
  return skeleton;
}

// ─────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────

function buildHandlers(db: Db): RpcHandlers {
  const handlers: RpcHandlers = {
    async open({ path }): Promise<ProjectOpenResult> {
      const abs = ensureAbsolute(path);
      const existing = findOpenByPath(abs);
      if (existing) {
        return { ok: true, projectId: existing.projectId, project: existing.project };
      }

      // Trust gate first — we refuse to touch FS until access is granted.
      const trust = await requestProjectAccess(abs);
      if (!trust.granted) {
        return err(trust.reason === 'trust-unreachable' ? 'trust-unreachable' : 'trust-denied');
      }

      let project: Project;
      try {
        project = readProjectFromDisk(abs);
      } catch (e) {
        return err('project-not-found', (e as Error).message);
      }

      // Reuse the previously-issued projectId for this path so render
      // records (project_id FK) and consumer-visible identity stay stable
      // across sidecar restarts.
      const knownRow = db
        .prepare(`SELECT project_id FROM projects WHERE path = ?`)
        .get(abs) as { project_id?: string } | undefined;
      const projectId = knownRow?.project_id ?? randomUUID();
      const watcher = await startWatcher(projectId, abs);
      const open_: OpenProject = { projectId, path: abs, project, watcher };
      open.set(projectId, open_);
      // Hydrate the LRU; the result is observable for smoke tests via
      // stderr (durable proof the <200ms target was met).
      const hyd = hydrateProjectCells(projectId, abs, lru);
      process.stderr.write(
        `[studio-sidecar] hydrate project=${projectId} cells=${hyd.count} elapsedMs=${hyd.elapsedMs}\n`,
      );
      recordProjectMeta(db, open_);
      return { ok: true, projectId, project };
    },

    async close({ projectId }) {
      const o = findOpenById(projectId);
      if (!o) return err('project-not-found');
      await o.watcher.close();
      lru.dropProject(projectId);
      open.delete(projectId);
      return { ok: true };
    },

    async list(): Promise<ProjectListResult> {
      return { ok: true, projects: listKnownProjects(db) };
    },

    async create({ archetype_id, path, name }): Promise<ProjectOpenResult> {
      const abs = ensureAbsolute(path);
      const trust = await requestProjectAccess(abs);
      if (!trust.granted) {
        return err(trust.reason === 'trust-unreachable' ? 'trust-unreachable' : 'trust-denied');
      }
      try {
        bootstrapProjectOnDisk({ archetypeId: archetype_id, projectRoot: abs, name });
      } catch (e) {
        return err('internal-error', (e as Error).message);
      }
      return handlers.open({ path: abs });
    },

    async info({ projectId }): Promise<ProjectInfoResult> {
      const o = findOpenById(projectId);
      if (!o) return err('project-not-found');
      const depth = queueDepth(db, projectId);
      // openCells = LRU entries scoped to this project.
      let openCells = 0;
      for (const row of listQueue(db, projectId)) {
        if (row) openCells; // no-op; we count via LRU below
      }
      // Count LRU entries belonging to this project.
      // (CellLRU doesn't expose a project filter; do it via key scan.)
      const prefix = `${projectId}::`;
      // `as any` because we don't want to widen the LRU API just for the count.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = (lru as unknown as { map: Map<string, unknown> }).map;
      for (const k of internal.keys()) if (k.startsWith(prefix)) openCells++;
      return { ok: true, project: o.project, openCells, queueDepth: depth };
    },
  };
  return handlers;
}

// ─────────────────────────────────────────────────────────────────────────
// Test-only knob: allow seeding the queue from stdin (used by the
// restart-rehydrate smoke). Triggered by `--seed-queue` (reads JSON from
// stdin: { records: [{recordId, projectId, cellId, engine, options?}, …] }).
// Exits after writing.
// ─────────────────────────────────────────────────────────────────────────

async function seedQueueFromStdin(): Promise<number> {
  const db = await openDb();
  let body = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) body += chunk;
  try {
    const parsed = JSON.parse(body) as {
      records: Array<{
        recordId: string;
        projectId: string;
        cellId: string;
        engine: string;
        options?: unknown;
      }>;
    };
    for (const r of parsed.records) {
      enqueue(db, {
        recordId: r.recordId,
        projectId: r.projectId,
        cellId: r.cellId,
        engine: r.engine,
        options: r.options ?? {},
      });
    }
    process.stderr.write(`[studio-sidecar][seed-queue] wrote ${parsed.records.length} rows\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`[studio-sidecar][seed-queue] failed: ${(e as Error).message}\n`);
    return 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--self-test:ffmpeg')) {
    return selfTestFfmpeg();
  }
  if (args.includes('--print-data-dir')) {
    return printDataDir();
  }
  if (args.includes('--seed-queue')) {
    return seedQueueFromStdin();
  }

  const db = await openDb();
  const handlers = buildHandlers(db);

  // Boot banner — stderr only.
  const { dbPath } = describeDb();
  process.stderr.write(
    `[studio-sidecar] ready db=${dbPath} pid=${process.pid} trust_stub=${
      process.env.STUDIO_TRUST_STUB === '1' ? 'on' : 'off'
    }\n`,
  );

  const loop = startRpcLoop(handlers);

  // Clean shutdown on stdin EOF.
  process.stdin.on('end', async () => {
    process.stderr.write('[studio-sidecar] stdin closed, shutting down\n');
    for (const o of open.values()) {
      try {
        await o.watcher.close();
      } catch {
        // ignore
      }
    }
    loop.close();
    process.exit(0);
  });

  const onSignal = async (sig: string) => {
    process.stderr.write(`[studio-sidecar] received ${sig}, shutting down\n`);
    for (const o of open.values()) {
      try {
        await o.watcher.close();
      } catch {
        // ignore
      }
    }
    loop.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void onSignal('SIGINT'));
  process.on('SIGTERM', () => void onSignal('SIGTERM'));

  // The loop owns the event-loop tick now.
  return new Promise<number>(() => {});
}

main().then(
  (code) => process.exit(code),
  (err) => {
    logErr(`fatal: ${(err as Error).stack ?? String(err)}`);
    process.exit(1);
  },
);
