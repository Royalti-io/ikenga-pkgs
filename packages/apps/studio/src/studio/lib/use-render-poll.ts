// com.ikenga.studio · adaptive render-status poll
//
// The shell can't relay pkg:// render/progress events to the iframe (Round-13
// Finding), so real mode POLLS render.list. The old poll was a fixed 2.5s
// setInterval that ran forever while a project was open — unconditional MCP
// traffic + console chatter even when 6/6 cells were long done
// (audit: `poll-render-list-unbounded` + `composition-render-poll-lag`).
//
// This hook replaces it with an ADAPTIVE poll: fast (~2s) ONLY while a render
// is queued/running or inside the post-enqueue grace window (`activeUntil`);
// when the queue goes idle the loop stops entirely (no heartbeat) until the
// user enqueues (bumpActivePoll) or hits Refresh (refreshRenders). While
// active, the counter/timeline can't lag reality by more than one 2s tick.
//
// No immediate `refreshRenders()` on mount here — `hydrateStoryboard` already
// does the one mount-time `render.list` (storyboard-store.ts) right after
// cells load. This hook only arms off the resulting `hasActive`/`activeUntil`
// state; when that reconciled read lands, `hasActive` flips and the effect
// re-runs, arming the fast loop if a render was already in flight at mount.

import { useEffect } from 'react';

import { useProjectStore } from '../project-store';
import {
  useStoryboardStore,
  selectStoryboardSource,
  selectHasActiveRenders,
} from '../storyboard-store';

const FAST_MS = 2_000;

export function useRenderPoll(): void {
  const projectId = useProjectStore((s) => s.project?.project_id);
  const source = useStoryboardStore(selectStoryboardSource);
  const hasActive = useStoryboardStore(selectHasActiveRenders);
  const activeUntil = useStoryboardStore((s) => s.activeUntil);
  const refreshRenders = useStoryboardStore((s) => s.refreshRenders);

  useEffect(() => {
    if (!projectId || source !== 'real') return;
    let stopped = false;
    let timer: number | undefined;

    // Arm off whatever `hasActive`/`activeUntil` already say — no fetch here;
    // hydrate's mount-time render.list (or the last poll tick) already owns
    // reconciling that state. If it lands active after this runs, the
    // selector change re-triggers the effect and arm() re-evaluates.
    const arm = () => {
      if (stopped) return;
      const active = hasActive || Date.now() < activeUntil;
      if (!active) return; // idle → stop; effect re-runs when hasActive/activeUntil change
      timer = window.setTimeout(async () => {
        await refreshRenders();
        arm();
      }, FAST_MS);
    };
    arm();

    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [projectId, source, hasActive, activeUntil, refreshRenders]);
}
