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

/** Dispatch-table value type. */
export type RpcMethod =
  | 'project.open'
  | 'project.close'
  | 'project.list'
  | 'project.create'
  | 'project.info';
