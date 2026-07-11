/**
 * Per-method param + result shapes for the project sidecar's JSON-RPC
 * surface. Kept in a sibling file (NOT `types.ts`) because the renderer
 * adapter trait already owns `renderers/types.ts` (frozen by WP-05a).
 */

import type { Project } from '@ikenga/studio-schema';

export type ErrorCode =
  | 'trust-denied'
  | 'trust-unreachable'
  | 'project-not-found'
  | 'project-already-open'
  | 'invalid-path'
  | 'invalid-args'
  | 'internal-error';

export interface ProjectOpenParams {
  path: string;
}
export type ProjectOpenResult =
  | { ok: true; projectId: string; project: Project }
  | { ok: false; error: ErrorCode; message?: string };

export interface ProjectCloseParams {
  projectId: string;
}
export type ProjectCloseResult =
  | { ok: true }
  | { ok: false; error: ErrorCode; message?: string };

export type ProjectListParams = Record<string, never>;
export interface ProjectSummary {
  projectId: string;
  path: string;
  name: string;
  lastOpened: number;
}
export type ProjectListResult = { ok: true; projects: ProjectSummary[] };

export interface ProjectCreateParams {
  archetype_id: string;
  path: string;
  name: string;
}
export type ProjectCreateResult =
  | { ok: true; projectId: string; project: Project }
  | { ok: false; error: ErrorCode; message?: string };

export interface ProjectInfoParams {
  projectId: string;
}
export type ProjectInfoResult =
  | { ok: true; project: Project; openCells: number; queueDepth: number }
  | { ok: false; error: ErrorCode; message?: string };

/**
 * Generic envelope for the WP-03b method surface (storyboard / anchor /
 * asset / composition / archetype / render). Handlers return a plain
 * `Record<string, unknown>` that already carries `ok: true|false`; the
 * dispatcher writes it straight onto the JSON-RPC `result`.
 */
export type GenericResult = Record<string, unknown>;

/** Dispatch-table value type. */
export type RpcMethod =
  | 'project.open'
  | 'project.close'
  | 'project.list'
  | 'project.create'
  | 'project.info'
  // storyboard.*
  | 'storyboard.read'
  | 'storyboard.read_cell'
  | 'storyboard.read_cell_content'
  | 'storyboard.write_cell'
  | 'storyboard.write_cell_content'
  | 'storyboard.create_cell'
  | 'storyboard.delete_cell'
  | 'storyboard.list_cells'
  | 'storyboard.upsert_beat'
  | 'storyboard.upsert_rung'
  | 'storyboard.set_approved'
  // anchor.*
  | 'anchor.list'
  | 'anchor.create'
  | 'anchor.delete'
  // asset.*
  | 'asset.list'
  | 'asset.import'
  | 'asset.resolve'
  // composition.*
  | 'composition.preview'
  | 'composition.validate'
  // archetype.*
  | 'archetype.instantiate_into_project'
  // render.*
  | 'render.enqueue'
  | 'render.status'
  | 'render.cancel'
  | 'render.list'
  | 'render.list_engines'
  | 'render.read_bytes'
  // export.* (WP-07c / G-38)
  | 'export.compose'
  | 'export.status'
  | 'export.list'
  | 'export.read_bytes'
  | 'export.check_bed';
