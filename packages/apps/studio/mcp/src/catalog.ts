/**
 * Block + archetype catalog loader.
 *
 * Walks (silently — missing dirs return empty lists, NOT errors):
 *   <pkgRoot>/skills/* /blocks/** /block.json     — built-in blocks (WP-09/WP-10)
 *   <pkgRoot>/skills/archetype-* /archetype.json  — built-in archetypes (WP-09)
 *   <projectRoot>/blocks/custom/** /block.json    — project-scoped custom blocks
 *
 * <pkgRoot> resolves to the studio package root (packages/apps/studio/) via
 * `import.meta.url` walked up from the MCP's dist/src/index.js location.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BlockEntry {
  block_id: string;
  kind?: string;
  name?: string;
  tags?: string[];
  source: 'builtin' | 'custom';
  /** Absolute path to the source block.json. */
  path: string;
  /** Raw block.json contents. */
  body: Record<string, unknown>;
}

export interface ArchetypeEntry {
  archetype_id: string;
  name?: string;
  source: 'builtin' | 'custom';
  path: string;
  body: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────
// Path resolution
// ─────────────────────────────────────────────────────────────────────────

/** Resolve the studio pkg root (packages/apps/studio/). */
export function studioPkgRoot(): string {
  // After build: dist/index.js → studio/
  // During typecheck (source-relative): src/catalog.ts → studio/mcp/ → studio/
  const here = dirname(fileURLToPath(import.meta.url));
  // Walk two levels up regardless (works for both src/ and dist/).
  return resolvePath(here, '..', '..');
}

// ─────────────────────────────────────────────────────────────────────────
// Generic walker
// ─────────────────────────────────────────────────────────────────────────

function walkForFiles(root: string, filename: string, maxDepth = 6): string[] {
  const hits: string[] = [];
  if (!existsSync(root)) return hits;
  function recurse(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      let s: ReturnType<typeof statSync>;
      try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) {
        recurse(full, depth + 1);
      } else if (s.isFile() && e === filename) {
        hits.push(full);
      }
    }
  }
  recurse(root, 0);
  return hits;
}

function safeParseJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    process.stderr.write(`[studio-mcp][catalog] failed to parse ${path}: ${(e as Error).message}\n`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Built-in block + archetype loaders
// ─────────────────────────────────────────────────────────────────────────

export function loadBuiltinBlocks(pkgRoot: string = studioPkgRoot()): BlockEntry[] {
  // skills/*/blocks/**/block.json
  const skillsDir = join(pkgRoot, 'skills');
  if (!existsSync(skillsDir)) return [];
  const entries: BlockEntry[] = [];
  let skillNames: string[];
  try { skillNames = readdirSync(skillsDir); } catch { return []; }
  for (const skill of skillNames) {
    const blocksDir = join(skillsDir, skill, 'blocks');
    if (!existsSync(blocksDir)) continue;
    for (const file of walkForFiles(blocksDir, 'block.json')) {
      const body = safeParseJson(file);
      if (!body) continue;
      const block_id = (body.block_id ?? body.id) as string | undefined;
      if (!block_id) continue;
      entries.push({
        block_id,
        kind: body.kind as string | undefined,
        name: body.name as string | undefined,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
        source: 'builtin',
        path: file,
        body,
      });
    }
  }
  return entries;
}

export function loadBuiltinArchetypes(pkgRoot: string = studioPkgRoot()): ArchetypeEntry[] {
  const skillsDir = join(pkgRoot, 'skills');
  if (!existsSync(skillsDir)) return [];
  const entries: ArchetypeEntry[] = [];
  let skillNames: string[];
  try { skillNames = readdirSync(skillsDir); } catch { return []; }
  for (const skill of skillNames) {
    if (!skill.startsWith('archetype-')) continue;
    const file = join(skillsDir, skill, 'archetype.json');
    if (!existsSync(file)) continue;
    const body = safeParseJson(file);
    if (!body) continue;
    const archetype_id = (body.archetype_id ?? body.id) as string | undefined;
    if (!archetype_id) continue;
    entries.push({
      archetype_id,
      name: body.name as string | undefined,
      source: 'builtin',
      path: file,
      body,
    });
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────────────
// Project-scoped custom blocks/archetypes
// ─────────────────────────────────────────────────────────────────────────

export function loadCustomBlocks(projectRoot: string): BlockEntry[] {
  const customDir = join(projectRoot, 'blocks', 'custom');
  const entries: BlockEntry[] = [];
  for (const file of walkForFiles(customDir, 'block.json')) {
    const body = safeParseJson(file);
    if (!body) continue;
    const block_id = (body.block_id ?? body.id) as string | undefined;
    if (!block_id) continue;
    entries.push({
      block_id,
      kind: body.kind as string | undefined,
      name: body.name as string | undefined,
      tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
      source: 'custom',
      path: file,
      body,
    });
  }
  return entries;
}

export function loadCustomArchetypes(projectRoot: string): ArchetypeEntry[] {
  const customDir = join(projectRoot, 'archetypes');
  const entries: ArchetypeEntry[] = [];
  if (!existsSync(customDir)) return entries;
  for (const file of walkForFiles(customDir, 'archetype.json')) {
    const body = safeParseJson(file);
    if (!body) continue;
    const archetype_id = (body.archetype_id ?? body.id) as string | undefined;
    if (!archetype_id) continue;
    entries.push({
      archetype_id,
      name: body.name as string | undefined,
      source: 'custom',
      path: file,
      body,
    });
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────────────
// Catalog (combined view)
// ─────────────────────────────────────────────────────────────────────────

export class Catalog {
  private builtinBlocks: BlockEntry[];
  private builtinArchetypes: ArchetypeEntry[];
  private customBlocksByProject = new Map<string, BlockEntry[]>();
  private customArchetypesByProject = new Map<string, ArchetypeEntry[]>();

  constructor() {
    this.builtinBlocks = loadBuiltinBlocks();
    this.builtinArchetypes = loadBuiltinArchetypes();
  }

  refreshForProject(projectId: string, projectRoot: string): void {
    this.customBlocksByProject.set(projectId, loadCustomBlocks(projectRoot));
    this.customArchetypesByProject.set(projectId, loadCustomArchetypes(projectRoot));
  }

  dropProject(projectId: string): void {
    this.customBlocksByProject.delete(projectId);
    this.customArchetypesByProject.delete(projectId);
  }

  listBlocks(opts: { projectId?: string; kind?: string; tags?: string[] } = {}): BlockEntry[] {
    const merged = [
      ...this.builtinBlocks,
      ...(opts.projectId ? (this.customBlocksByProject.get(opts.projectId) ?? []) : []),
    ];
    return merged.filter((b) => {
      if (opts.kind && b.kind !== opts.kind) return false;
      if (opts.tags && opts.tags.length > 0) {
        const have = new Set(b.tags ?? []);
        if (!opts.tags.some((t) => have.has(t))) return false;
      }
      return true;
    });
  }

  getBlock(block_id: string, projectId?: string): BlockEntry | undefined {
    return this.listBlocks({ projectId }).find((b) => b.block_id === block_id);
  }

  listArchetypes(opts: { projectId?: string } = {}): ArchetypeEntry[] {
    return [
      ...this.builtinArchetypes,
      ...(opts.projectId ? (this.customArchetypesByProject.get(opts.projectId) ?? []) : []),
    ];
  }

  getArchetype(archetype_id: string, projectId?: string): ArchetypeEntry | undefined {
    return this.listArchetypes({ projectId }).find((a) => a.archetype_id === archetype_id);
  }

  // ── Custom writes ────────────────────────────────────────────────────

  /** Write a custom block to <projectRoot>/blocks/custom/<block_id>/block.json. */
  writeCustomBlock(projectRoot: string, projectId: string, block: Record<string, unknown>): BlockEntry {
    const block_id = (block.block_id ?? block.id) as string | undefined;
    if (!block_id) throw new Error('block.block_id is required');
    const dir = join(projectRoot, 'blocks', 'custom', block_id);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'block.json');
    writeFileSync(file, JSON.stringify(block, null, 2) + '\n', 'utf8');
    this.refreshForProject(projectId, projectRoot);
    const found = this.getBlock(block_id, projectId);
    if (!found) throw new Error(`failed to register block ${block_id} after write`);
    return found;
  }

  /** Delete a custom block. Returns false if not found (or built-in). */
  deleteCustomBlock(projectRoot: string, projectId: string, block_id: string): { ok: boolean; reason?: string } {
    const entry = this.getBlock(block_id, projectId);
    if (!entry) return { ok: false, reason: 'not-found' };
    if (entry.source === 'builtin') return { ok: false, reason: 'cannot-delete-builtin' };
    try {
      const dir = dirname(entry.path);
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
    this.refreshForProject(projectId, projectRoot);
    return { ok: true };
  }

  /** Write a custom archetype to <projectRoot>/archetypes/<archetype_id>/archetype.json. */
  writeCustomArchetype(projectRoot: string, projectId: string, archetype: Record<string, unknown>): ArchetypeEntry {
    const archetype_id = (archetype.archetype_id ?? archetype.id) as string | undefined;
    if (!archetype_id) throw new Error('archetype.archetype_id is required');
    const dir = join(projectRoot, 'archetypes', archetype_id);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'archetype.json');
    writeFileSync(file, JSON.stringify(archetype, null, 2) + '\n', 'utf8');
    this.refreshForProject(projectId, projectRoot);
    const found = this.getArchetype(archetype_id, projectId);
    if (!found) throw new Error(`failed to register archetype ${archetype_id} after write`);
    return found;
  }

  deleteCustomArchetype(projectRoot: string, projectId: string, archetype_id: string): { ok: boolean; reason?: string } {
    const entry = this.getArchetype(archetype_id, projectId);
    if (!entry) return { ok: false, reason: 'not-found' };
    if (entry.source === 'builtin') return { ok: false, reason: 'cannot-delete-builtin' };
    try {
      const dir = dirname(entry.path);
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
    this.refreshForProject(projectId, projectRoot);
    return { ok: true };
  }
}
