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

    // One immediate read so the pane shows current truth the instant it mounts
    // (or the moment work is enqueued), then arm the fast loop only if active.
    void refreshRenders();

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
