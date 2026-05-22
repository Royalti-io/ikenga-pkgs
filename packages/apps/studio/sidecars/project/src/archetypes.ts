/**
 * archetype.* RPC implementations (WP-03b) — instantiate_into_project.
 *
 * Scaffolds an archetype's beats + cells into an ALREADY-OPEN project. The
 * archetype definitions themselves ship in WP-09 (not yet present in this
 * tree). Resolution order for a definition:
 *   1. `<projectRoot>/archetypes/<archetypeId>.json` (project-custom)
 *   2. (future) bundled built-in archetypes — WP-09.
 *
 * If no definition is found we return an HONEST domain error
 * (`archetype-not-found`, message points at WP-09) — never
 * `sidecar-method-not-implemented`, because the method IS implemented; it is
 * the *data* that ships later. When a definition exists we materialize its
 * chain into the project's cells[] and persist atomically.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function findArchetypeDefinition(projectRoot: string, archetypeId: string): unknown | undefined {
  const projectCustom = join(projectRoot, 'archetypes', `${archetypeId}.json`);
  if (existsSync(projectCustom)) {
    try {
      return JSON.parse(readFileSync(projectCustom, 'utf8')) as unknown;
    } catch {
      return undefined;
    }
  }
  // Built-in archetype definitions ship in WP-09; nothing to load yet.
  return undefined;
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
        message: 'archetype definitions ship in WP-09',
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
