// com.ikenga.studio · shared open-project flow
//
// Extracted verbatim from the Launcher (views/Launcher.tsx `openByPath`) so BOTH
// the launcher's recent-row / open-folder / auto-reopen paths AND the shell
// side-menu's `recent:<path>` rows route through ONE real flow:
// project.open → best-effort project.info enrichment → project-store.openProject
// (which persists the last-project entry). The M-A menu MUST NOT fork this — a
// second open path would drift from the launcher's enrichment + persistence.
//
// Note the deliberate use of `useProjectStore.getState().openProject` rather
// than a passed-in setter: this helper is called from a plain module (menu.ts)
// as well as from React, so it reads the store action off the store directly.

import { getMcpClient, projectApi } from '../mcp-client';
import { useProjectStore } from '../project-store';
import type { AspectRatio } from '../mcp-types';

/** Strip the internal `[studio] <tool> failed:` prefix from an error for
 *  user-facing surfaces. Shared by the Launcher's toasts/banners and App's
 *  optimistic-resume failure banner so the two don't drift on copy. */
export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^\[studio\]\s*/, '').slice(0, 200);
}

/** Open a project by its on-disk path, enrich its header from project.info, and
 *  flip the project store open (persisting it as last-project). Rejects if the
 *  real project.open fails — callers surface that (toast / menu is fire-and-log). */
export async function openProjectByPath(path: string, fallbackName: string): Promise<void> {
  const client = await getMcpClient();
  const { project_id } = await projectApi.open(client, path);
  let archetype_id = '';
  let aspect_ratio: AspectRatio = '16:9';
  let name = fallbackName;
  try {
    const info = await projectApi.info(client, project_id);
    if (info?.archetype_id) archetype_id = info.archetype_id;
    if (info?.aspect_ratio) aspect_ratio = info.aspect_ratio;
    if (info?.title) name = info.title;
  } catch {
    // project.info is best-effort enrichment; the open still succeeds without it.
  }
  useProjectStore.getState().openProject({ project_id, name, archetype_id, aspect_ratio, path });
}
