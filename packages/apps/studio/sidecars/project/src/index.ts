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
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  DEFAULT_RESOLUTION,
  ProjectSchema,
  type AspectRatio,
  type Cell,
  type Project,
} from '@ikenga/studio-schema';

import { describeDb, openDb } from './db.js';
import {
  CellLRU,
  enqueue,
  hydrateProjectCells,
  queueDepth,
} from './queue.js';
import {
  logErr,
  startRpcLoop,
  toProjectSummary,
  type RpcHandlers,
} from './rpc.js';
import type {
  ErrorCode,
  GenericResult,
  ProjectInfoResult,
  ProjectListResult,
  ProjectOpenResult,
  ProjectSummary,
  RpcMethod,
} from './rpc-types.js';
import { startWatcher, type WatcherHandle } from './watcher.js';
import { requestProjectAccess } from './trust.js';
import * as storyboard from './storyboard.js';
import * as anchors from './anchors.js';
import * as assets from './assets.js';
import * as archetypes from './archetypes.js';
import { buildPromptPackage } from './prompt-package.js';
import { RenderRunner, type ProjectLookup } from './render-runner.js';
import { ExportRunner, type ExportLookup, type MusicPreset } from './exporter.js';
import { getAdapter, listEngines, resolveEngineWithRequest, EngineResolutionError } from './registry.js';
import { stdoutEventWriter } from './events.js';
import type { RenderContext } from './renderers/types.js';

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
  // Expand a leading `~` to the home dir. UI callers (the iframe) have no
  // access to $HOME and can only emit `~/…` paths — e.g. the launcher's
  // `~/Projects/<name>` — so the sidecar, which does run in node, resolves it.
  if (p === '~' || p.startsWith('~/')) {
    return join(homedir(), p.slice(1));
  }
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
  // exists: cheap per-row fs.existsSync so the Launcher can dim stale/dead
  // paths (moved or deleted project folders) instead of rendering them as
  // first-class openable recents (audit: Recents hygiene).
  return rows.map((row) => ({ ...toProjectSummary(row), exists: existsSync(row.path) }));
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

// Shared between the extended handlers + the render runner: refresh the
// in-memory project copy after a mutation so subsequent reads (and the render
// runner's cell lookup) see the new state without a disk round-trip.
function syncOpenProject(projectId: string, project: Project): void {
  const o = open.get(projectId);
  if (o) o.project = project;
}

function defaultResolution(p: Project): { w: number; h: number } {
  return p.resolution ?? DEFAULT_RESOLUTION[p.aspect_ratio];
}

function cellDirOf(projectRoot: string, cell: Cell): string {
  const abs = isAbsolute(cell.content_path)
    ? cell.content_path
    : resolve(projectRoot, cell.content_path);
  return dirname(abs);
}

function buildHandlers(db: Db): RpcHandlers {
  // ProjectLookup over the in-memory open-project map for the render runner.
  const lookup: ProjectLookup = {
    projectRoot: (projectId) => open.get(projectId)?.path,
    cell: (projectId, cellId) =>
      open.get(projectId)?.project.cells.find((c) => c.uid === cellId),
    aspectRatio: (projectId) => open.get(projectId)?.project.aspect_ratio as AspectRatio | undefined,
    resolution: (projectId) => {
      const p = open.get(projectId)?.project;
      return p ? defaultResolution(p) : undefined;
    },
  };

  const runner = new RenderRunner({ db, lookup, writer: stdoutEventWriter });
  // Recover any 'running' rows orphaned by a prior crash, then start draining.
  runner.recover();

  // Export runner (WP-07c / G-38) — composes per-cell MP4s into one
  // deliverable. Mirrors RenderRunner's serial-drain + recover semantics.
  const exportLookup: ExportLookup = {
    projectRoot: (projectId) => open.get(projectId)?.path,
    project: (projectId) => open.get(projectId)?.project,
    resolution: (projectId) => {
      const p = open.get(projectId)?.project;
      return p ? defaultResolution(p) : undefined;
    },
  };
  const exporter = new ExportRunner({ db, lookup: exportLookup, writer: stdoutEventWriter });
  exporter.recover();

  // Helper: resolve an open project's root path or return a structured error.
  const rootOf = (projectId: unknown): { root: string } | { err: GenericResult } => {
    if (typeof projectId !== 'string') {
      return { err: { ok: false, error: 'invalid-args', message: 'projectId must be a string' } };
    }
    const o = open.get(projectId);
    if (!o) return { err: { ok: false, error: 'project-not-open', message: `projectId ${projectId} is not open` } };
    return { root: o.path };
  };

  // composition.preview / composition.validate — resolve engine by extension
  // (G23) and call the adapter's preview/validate with a RenderContext.
  const compositionCall = async (
    kind: 'preview' | 'validate',
    params: Record<string, unknown>,
  ): Promise<GenericResult> => {
    const projectId = params.projectId;
    const cellId = params.cellId;
    const r = rootOf(projectId);
    if ('err' in r) return r.err;
    const cell = lookup.cell(projectId as string, cellId as string);
    if (!cell) return { ok: false, error: 'cell-not-found', message: `cell ${String(cellId)} not found` };
    let engine: string;
    try {
      engine = resolveEngineWithRequest(cell.content_path, params.engine as string | undefined);
    } catch (e) {
      if (e instanceof EngineResolutionError) return { ok: false, error: e.code, message: e.message };
      return { ok: false, error: 'internal-error', message: (e as Error).message };
    }
    const adapter = getAdapter(engine);
    if (!adapter) return { ok: false, error: 'unresolvable-engine', message: `no adapter for ${engine}` };

    const p = open.get(projectId as string)!.project;
    const aspect = (p.aspect_ratio as AspectRatio) ?? '16:9';
    const ctx: RenderContext = {
      projectRoot: r.root,
      cellDir: cellDirOf(r.root, cell),
      rendersDir: join(r.root, 'renders'),
      aspectRatio: aspect,
      resolution: defaultResolution(p),
      vault: { get: async (key: string) => (key === 'fal.key' ? process.env.FAL_KEY : undefined) },
      emit: () => {}, // preview/validate are cheap + synchronous-ish; no progress
      signal: new AbortController().signal,
    };
    try {
      if (kind === 'preview') {
        const url = await adapter.preview(cell, ctx);
        return { ok: true, engine, preview: url };
      }
      const diagnostics = await adapter.validate(cell, ctx);
      return { ok: true, engine, diagnostics };
    } catch (e) {
      return { ok: false, error: 'internal-error', message: (e as Error).message };
    }
  };

  const extended = async (method: RpcMethod, rawParams: unknown): Promise<GenericResult> => {
    const params = (rawParams ?? {}) as Record<string, unknown>;

    // Methods that DON'T need an open project root resolved up-front: the
    // engine-list, render-record lookups, and export-record lookups all key
    // on an id rather than an open-project path. `export.compose` resolves
    // (and validates the selection against) the open project inside the
    // runner, so it's exempt here too.
    const NO_ROOT = new Set<RpcMethod>([
      'render.list_engines',
      'render.status',
      'render.cancel',
      'render.list',
      'render.read_bytes',
      'render.read_poster',
      'export.compose',
      'export.status',
      'export.list',
      'export.read_bytes',
    ]);

    let root = '';
    if (!NO_ROOT.has(method)) {
      const r = rootOf(params.projectId);
      if ('err' in r) return r.err;
      root = r.root;
    }

    switch (method) {
      // ── storyboard.* ──
      case 'storyboard.read':
        return storyboard.read(root).result;
      case 'storyboard.read_cell':
        return storyboard.readCell(root, params.cellId as string).result;
      case 'storyboard.read_fountain':
        return storyboard.readFountain(root).result;
      case 'storyboard.write_fountain':
        return storyboard.writeFountain(root, params.text).result;
      case 'storyboard.read_cell_content':
        return storyboard.readCellContent(root, params.cellId as string).result;
      case 'storyboard.write_cell_content': {
        const r = storyboard.writeCellContent(root, params.cellId as string, params.html);
        if (r.project) syncOpenProject(params.projectId as string, r.project);
        return r.result;
      }
      case 'storyboard.list_cells':
        return storyboard.listCells(root, {
          beat_id: params.beat_id as string | undefined,
          rung: params.rung as never,
        }).result;
      case 'storyboard.create_cell': {
        const r = storyboard.createCell(root, params.cell);
        if (r.project) syncOpenProject(params.projectId as string, r.project);
        return r.result;
      }
      case 'storyboard.write_cell': {
        const r = storyboard.writeCell(root, params.cell);
        if (r.project) syncOpenProject(params.projectId as string, r.project);
        return r.result;
      }
      case 'storyboard.delete_cell': {
        const r = storyboard.deleteCell(root, params.cellId as string);
        if (r.project) syncOpenProject(params.projectId as string, r.project);
        return r.result;
      }
      case 'storyboard.set_approved': {
        const r = storyboard.setApproved(root, params.cellId as string, Boolean(params.approved));
        if (r.project) syncOpenProject(params.projectId as string, r.project);
        return r.result;
      }
      case 'storyboard.upsert_beat': {
        const r = storyboard.upsertBeat(root, params.beat);
        if (r.project) syncOpenProject(params.projectId as string, r.project);
        return r.result;
      }
      case 'storyboard.upsert_rung': {
        const r = storyboard.upsertRung(
          root,
          params.cellId as string,
          params.rung,
          params.rungKey as string | undefined,
        );
        if (r.project) syncOpenProject(params.projectId as string, r.project);
        return r.result;
      }

      // ── anchor.* ──
      case 'anchor.list':
        return anchors.list(root).result;
      case 'anchor.create': {
        const r = anchors.create(root, params.anchor);
        if (r.project) syncOpenProject(params.projectId as string, r.project);
        return r.result;
      }
      case 'anchor.generate': {
        const r = await anchors.generate(root, {
          kind: params.kind as 'character' | 'location' | 'style' | 'image',
          name: params.name as string,
          prompt: params.prompt as string,
          seed: params.seed as number | undefined,
          model: params.model as string | undefined,
        });
        if (r.project) syncOpenProject(params.projectId as string, r.project);
        return r.result;
      }
      case 'anchor.delete': {
        const r = anchors.remove(root, params.anchorId as string);
        if (r.project) syncOpenProject(params.projectId as string, r.project);
        return r.result;
      }

      // ── asset.* ──
      case 'asset.list':
        return assets.list(root, params.kind as string | undefined).result;
      case 'asset.import':
        return (await assets.importAsset(root, params.source as string, params.kind as string | undefined)).result;
      case 'asset.resolve':
        return assets.resolveAsset(root, params.assetId as string).result;

      // ── composition.* ──
      case 'composition.preview':
        return compositionCall('preview', params);
      case 'composition.validate':
        return compositionCall('validate', params);

      // ── archetype.* ──
      case 'archetype.instantiate_into_project': {
        const r = archetypes.instantiateIntoProject(root, params.archetypeId as string);
        if (r.project) syncOpenProject(params.projectId as string, r.project);
        return r.result;
      }

      // ── render.* ──
      case 'render.enqueue':
        return runner.enqueue(params.projectId as string, params.cellId as string, {
          engine: params.engine as string | undefined,
          aspect_ratio: params.aspect_ratio as never,
          resolution: params.resolution as { w: number; h: number } | undefined,
          variant: params.variant as string | undefined,
          range: params.range as { start_ms?: number; end_ms?: number } | undefined,
        });
      case 'render.status':
        return runner.status(params.recordId as string);
      case 'render.cancel':
        return runner.cancel(params.recordId as string);
      case 'render.list':
        return runner.list({
          projectId: params.projectId as string | undefined,
          status: params.status as string | undefined,
        });
      case 'render.list_engines':
        return { ok: true, engines: listEngines() };
      case 'render.read_bytes':
        return runner.readBytes(params.recordId as string);
      case 'render.read_poster':
        return runner.readPoster(params.recordId as string);
      case 'render.ingest_external':
        return runner.ingestExternal(params.projectId as string, params.cellId as string, {
          filePath: params.filePath as string,
          engine: params.engine as string,
          model_id: params.model_id as string | undefined,
          cost_actual: params.cost_actual as number | undefined,
        });

      // ── export.* (WP-07c / G-38) ──
      case 'export.compose':
        return exporter.compose(params.projectId as string, {
          rung: params.rung as number | undefined,
          cellIds: params.cellIds as string[] | undefined,
          music_preset: params.music_preset as MusicPreset | undefined,
          outputPath: params.outputPath as string | undefined,
          engine: params.engine as string | undefined,
        });
      case 'export.status':
        return exporter.status(params.exportId as string);
      case 'export.list':
        return exporter.list(params.projectId as string | undefined);
      case 'export.read_bytes':
        return exporter.readBytes(params.exportId as string);
      case 'export.check_bed': {
        // Honest silent-bed check (F7): does a real music-bed file exist on
        // disk for the chosen preset? Mirrors the exporter's own resolver
        // (`assets/music/<preset>.mp3`). none/silent are silent by design.
        const preset = (params.music_preset as string | undefined) ?? 'none';
        if (preset === 'none' || preset === 'silent') {
          return { ok: true, hasBed: false, willBeSilent: true, byDesign: true };
        }
        const bed = join(root, 'assets', 'music', `${preset}.mp3`);
        const hasBed = existsSync(bed);
        return { ok: true, hasBed, willBeSilent: !hasBed, byDesign: false, path: hasBed ? bed : undefined };
      }

      // ── export.* (Stage 4 / Track B — prompt handoff) ──
      case 'export.prompt_package':
        return buildPromptPackage(root, {
          cellId: params.cellId as string | undefined,
          platform: params.platform,
        }).result;

      default:
        return { ok: false, error: 'method-not-implemented', message: method };
    }
  };

  const handlers: RpcHandlers = {
    extended,
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
