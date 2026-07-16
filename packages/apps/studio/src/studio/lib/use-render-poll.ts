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

import { subscribeStudioEvent } from '../bridge';
import { useProjectStore } from '../project-store';
import {
  useStoryboardStore,
  selectStoryboardSource,
  selectHasActiveRenders,
} from '../storyboard-store';

const FAST_MS = 2_000;

// Coalesce a burst of relayed render/progress + render/done frames into one
// render.list refresh. Small enough to feel immediate (a finished render shows
// in <0.25s vs the old 2s poll lag), large enough that a 20/s progress stream
// can't fan out to 20 render.list calls/s.
const RELAY_COALESCE_MS = 200;

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

  // Low-latency path: refresh immediately (coalesced) whenever the host relays
  // a render/progress or render/done frame. This is additive to the adaptive
  // poll above — the poll remains the fallback when no relay arrives (a dropped
  // frame, standalone dev, or a frame that landed before this mounted).
  useEffect(() => {
    if (!projectId || source !== 'real') return;
    let coalesce: number | undefined;
    const trigger = () => {
      if (coalesce !== undefined) return;
      coalesce = window.setTimeout(() => {
        coalesce = undefined;
        void refreshRenders();
      }, RELAY_COALESCE_MS);
    };
    const unsubProgress = subscribeStudioEvent('render/progress', trigger);
    const unsubDone = subscribeStudioEvent('render/done', trigger);
    return () => {
      unsubProgress();
      unsubDone();
      if (coalesce !== undefined) window.clearTimeout(coalesce);
    };
  }, [projectId, source, refreshRenders]);
}
