/**
 * anchor.* RPC implementations (WP-03b).
 *
 * Storage choice: anchors live as the project-level `Project.anchors[]`
 * array inside `storyboard.json` (per schema — `ProjectSchema.anchors`).
 * The schema ships an `anchors/` directory in the project skeleton too, but
 * that is reserved for anchor *payload* files; the canonical anchor records
 * are the in-document array, so list/create/delete mutate `Project.anchors`
 * and persist atomically (tmp+rename) through `writeProjectAtomic`. The FS
 * watcher emits `cells/changed` on the storyboard.json rename.
 */

import { AnchorSchema, type Project } from '@ikenga/studio-schema';

import { readProject, writeProjectAtomic } from './storyboard-fs.js';

export interface AnchorResult {
  result: Record<string, unknown>;
  project?: Project;
}

export function list(projectRoot: string): AnchorResult {
  const project = readProject(projectRoot);
  return { result: { ok: true, anchors: project.anchors } };
}

export function create(projectRoot: string, anchorInput: unknown): AnchorResult {
  const parsed = AnchorSchema.safeParse(anchorInput);
  if (!parsed.success) {
    return { result: { ok: false, error: 'invalid-args', message: parsed.error.message } };
  }
  const anchor = parsed.data;
  const project = readProject(projectRoot);
  if (project.anchors.some((a) => a.id === anchor.id)) {
    return { result: { ok: false, error: 'anchor-already-exists', message: anchor.id } };
  }
  const next = writeProjectAtomic(projectRoot, {
    ...project,
    anchors: [...project.anchors, anchor],
  });
  return { result: { ok: true, anchor }, project: next };
}

export function remove(projectRoot: string, anchorId: string): AnchorResult {
  const project = readProject(projectRoot);
  const idx = project.anchors.findIndex((a) => a.id === anchorId);
  if (idx < 0) {
    return { result: { ok: false, error: 'anchor-not-found', message: anchorId } };
  }
  const next = writeProjectAtomic(projectRoot, {
    ...project,
    anchors: project.anchors.filter((a) => a.id !== anchorId),
  });
  return { result: { ok: true, anchorId }, project: next };
}
