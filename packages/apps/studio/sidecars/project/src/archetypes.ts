/**
 * archetype.* RPC implementations (WP-03b) — instantiate_into_project.
 *
 * Scaffolds an archetype's beats + cells into an ALREADY-OPEN project.
 * Resolution order for a definition:
 *   1. `<projectRoot>/archetypes/<archetypeId>.json` (project-custom)
 *   2. Built-in archetype skills — the `@ikenga/studio-archetypes` package
 *      shipped in WP-17B/WP-22. Roots are resolved in the same precedence
 *      as the MCP catalog (mcp/src/catalog.ts): materialized `<pkgRoot>/skills`,
 *      the self-contained `<pkgRoot>/mcp/dist/skills` copy, node-module
 *      resolution of `@ikenga/studio-archetypes`, then a workspace-relative
 *      walk back to `packages/skills/studio-archetypes/skills`.
 *
 * If no definition is found we return an HONEST domain error
 * (`archetype-not-found`) — never `sidecar-method-not-implemented`, because
 * the method IS implemented. When a definition exists we materialize its
 * chain into the project's cells[] and persist atomically.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  ArchetypeSchema,
  CellSchema,
  rungDir,
  type Cell,
  type Project,
} from '@ikenga/studio-schema';

import { readProject, writeProjectAtomic } from './storyboard-fs.js';

export interface ArchetypeResult {
  result: Record<string, unknown>;
  project?: Project;
}

// ─────────────────────────────────────────────────────────────────────────
// Built-in archetype skill-root resolution (mirrors mcp/src/catalog.ts)
// ─────────────────────────────────────────────────────────────────────────

/** The studio pkg root (packages/apps/studio/), resolved from this module. */
function studioPkgRoot(): string {
  // dist: sidecars/project/dist/archetypes.js → up 3 → studio/
  // src:  sidecars/project/src/archetypes.ts  → up 3 → studio/
  const here = dirname(fileURLToPath(import.meta.url));
  return resolvePath(here, '..', '..', '..');
}

/** Resolve the @ikenga/studio-archetypes package skills/ dir via node. */
function resolveArchetypesPkgSkills(): string | null {
  try {
    const req = createRequire(import.meta.url);
    const manifest = req.resolve('@ikenga/studio-archetypes/manifest.json');
    return join(dirname(manifest), 'skills');
  } catch {
    return null;
  }
}

/** Ordered candidate skills dirs that may hold built-in `archetype-` subdirs. */
function builtinArchetypeRoots(): string[] {
  const pkgRoot = studioPkgRoot();
  const roots: string[] = [];
  const push = (dir: string | null | undefined): void => {
    if (dir && existsSync(dir) && !roots.includes(dir)) roots.push(dir);
  };
  // 1. Packaged / materialized-into-pkg.
  push(join(pkgRoot, 'skills'));
  // 1b. Self-contained MCP dist/skills copy (build.sh materializes it there).
  push(join(pkgRoot, 'mcp', 'dist', 'skills'));
  // 2a. Node resolution of the extracted @ikenga/studio-archetypes package.
  push(resolveArchetypesPkgSkills());
  // 2b. Workspace-relative: packages/apps/studio → packages/skills/studio-archetypes.
  push(resolvePath(pkgRoot, '..', '..', 'skills', 'studio-archetypes', 'skills'));
  return roots;
}

/**
 * Walk built-in archetype roots for each `archetype-` subdir's
 * `archetype.json` whose `id` (or `archetype_id`) matches. Returns the
 * parsed JSON or undefined.
 */
function findBuiltinArchetype(archetypeId: string): unknown | undefined {
  for (const skillsDir of builtinArchetypeRoots()) {
    let skillNames: string[];
    try { skillNames = readdirSync(skillsDir); } catch { continue; }
    for (const skill of skillNames) {
      if (!skill.startsWith('archetype-')) continue;
      const file = join(skillsDir, skill, 'archetype.json');
      if (!existsSync(file)) continue;
      try {
        const body = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        const id = (body.archetype_id ?? body.id) as string | undefined;
        if (id === archetypeId) return body;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function findArchetypeDefinition(projectRoot: string, archetypeId: string): unknown | undefined {
  // 1. Project-custom (flat file).
  const projectCustom = join(projectRoot, 'archetypes', `${archetypeId}.json`);
  if (existsSync(projectCustom)) {
    try {
      return JSON.parse(readFileSync(projectCustom, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
  }
  // 2. Built-in archetype skills (@ikenga/studio-archetypes).
  return findBuiltinArchetype(archetypeId);
}

export function instantiateIntoProject(
  projectRoot: string,
  archetypeId: string,
): ArchetypeResult {
  const raw = findArchetypeDefinition(projectRoot, archetypeId);
  if (raw === undefined) {
    return {
      result: {
        ok: false,
        error: 'archetype-not-found',
        message: `archetype '${archetypeId}' not found in project or built-in catalog`,
      },
    };
  }

  const parsed = ArchetypeSchema.safeParse(raw);
  if (!parsed.success) {
    return { result: { ok: false, error: 'invalid-archetype', message: parsed.error.message } };
  }
  const archetype = parsed.data;

  const project = readProject(projectRoot);
  const now = new Date().toISOString();
  const newCells: Cell[] = [];
  const newBeatIds: string[] = [];

  // Materialize each chain entry into a beat_id + a beatsheet-rung cell. This
  // is the minimal scaffold: a cell per block at rung 0, with the block_id
  // back-reference set. Higher rungs + per-block bindings render later.
  let index = 0;
  for (const entry of archetype.chain) {
    const beatId = `${archetypeId}-${entry.block_id}-${index}`;
    const uid = `${beatId}-${Math.random().toString(36).slice(2, 8)}`;
    const cell = CellSchema.parse({
      uid,
      beat_id: beatId,
      rung: '0_beat_sheet',
      index,
      label: entry.block_id,
      block_id: entry.block_id,
      time: { start: 0, end: 0 },
      frames: { start: 0, end: 0 },
      content_path: join('cells', rungDir('0_beat_sheet'), uid, 'content.html'),
      rungs: {
        '0_beat_sheet': { status: 'pending' },
        '1_lofi': { status: 'pending' },
        '2_hifi': { status: 'pending' },
      },
      last_edited: now,
    });
    newCells.push(cell);
    newBeatIds.push(beatId);
    index += 1;
  }

  const next = writeProjectAtomic(projectRoot, {
    ...project,
    archetype_id: archetypeId,
    cells: [...project.cells, ...newCells],
  });

  return {
    result: {
      ok: true,
      archetype_id: archetypeId,
      beats: newBeatIds,
      cells: newCells,
    },
    project: next,
  };
}
