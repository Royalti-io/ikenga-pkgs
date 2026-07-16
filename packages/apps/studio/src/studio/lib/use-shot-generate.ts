// com.ikenga.studio · useShotGenerate — the one "generate a shot" pipeline
//
// "Generate a shot" was independently reimplemented in Cell and Canvas with
// divergent capability: Cell resolved the engine from the server's
// render.list_engines matrix and offered the Track-B Higgsfield handoff, while
// Canvas hardcoded `engine: 'fal'`. They couldn't share fixes. This hook is the
// single home for the action pipeline — engine capability, the Track-A render
// enqueue, the per-cell render lifecycle (enqueue + adaptive poll), the Track-B
// prompt-package + ingest-return legs, and the render-job cancel. Each view
// keeps its OWN presentation (buttons, trays, chips, busy/error surfaces) and
// drives it through these actions.
//
// The render-lifecycle (enqueue + poll with the POLL_FAILED handling from
// Wave 1) is preserved verbatim below and composed for the primary cell —
// Cell's live progress spinner reads it. Canvas doesn't poll per cell (the
// storyboard store's adaptive poll refreshes its tiles), so it drives the
// stateless `enqueueRender` directly. Both enqueue through this module, so the
// engine capability + render call live in exactly one place.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getMcpClient,
  getProbedEngines,
  compositionApi,
  renderApi,
  exportApi,
} from '../mcp-client';
import { pollRenderUntilDone, POLL_FAILED } from './render-poll';
import type {
  EngineCapability,
  PromptPackage,
  PromptPlatform,
  RenderRecord,
} from '../mcp-types';

// ─── render lifecycle (enqueue + poll; honest indeterminate progress) ────

export type RenderState = 'idle' | 'queued' | 'running' | 'done' | 'failed';

/** What a render enqueue is billed against. Omitted engine → the sidecar
 *  resolves one from the cell's content_path (registry.resolveEngineWithRequest);
 *  omitted variant → the adapter's own model resolution. */
export type RenderOpts = { engine?: string; variant?: string };

function useRenderLifecycle(
  cellUid: string | null,
  real: { isReal: boolean; projectId: string | null },
  hooks: { onEnqueued?: () => void; onSettled?: () => void },
) {
  const [state, setState] = useState<RenderState>('idle');
  // progress is only ever a real fraction in the mock timer path; real mode
  // keeps it 0 (the sidecar reports no true %) so the UI renders indeterminate.
  const [progress, setProgress] = useState(0);
  // What the last enqueue actually dispatched. A retry has to replay THIS
  // rather than re-read the desk (which may have been switched since the
  // failure), and the in-flight readout names it rather than guessing — the
  // spend is against these, so nothing else may claim to speak for it.
  const [lastOpts, setLastOpts] = useState<RenderOpts | null>(null);
  const timersRef = useRef<{ kick?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval> }>({});
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  const cancel = useCallback(() => {
    if (timersRef.current.kick) clearTimeout(timersRef.current.kick);
    if (timersRef.current.tick) clearInterval(timersRef.current.tick);
    timersRef.current = {};
    abortRef.current.aborted = true;
  }, []);

  // `variant` is the engine-specific model pick (fal's resolveVideoModel reads
  // opts.variant first). Omitted → the adapter's own default.
  const trigger = useCallback(async (opts?: RenderOpts) => {
    if (state === 'queued' || state === 'running') return;
    cancel();
    abortRef.current = { aborted: false };
    setState('queued');
    setProgress(0);
    setLastOpts({ engine: opts?.engine, variant: opts?.variant });

    if (real.isReal && real.projectId && cellUid) {
      try {
        const client = await getMcpClient();
        const { record_id } = await compositionApi.render(client, {
          project_id: real.projectId,
          cell_uid: cellUid,
          engine: opts?.engine,
          variant: opts?.variant,
        });
        hooksRef.current.onEnqueued?.();
        const rec = await pollRenderUntilDone(client, record_id, {
          signal: abortRef.current,
          onTick: (r) => {
            if (abortRef.current.aborted) return;
            if (r.status === 'running') setState('running');
            else if (r.status === 'queued') setState('queued');
            else if (r.status === 'done') { setState('done'); setProgress(1); }
            else if (r.status === 'failed' || r.status === 'cancelled') setState('failed');
          },
        });
        if (abortRef.current.aborted) return;
        // POLL_FAILED means the status RPC itself kept failing (sidecar blip
        // outlasting the poll's own retries) — a null/undefined here would
        // otherwise match neither branch and leave renderState stuck at
        // queued/running forever with a spinner and a disabled button.
        if (rec !== POLL_FAILED && rec.status === 'done') { setState('done'); setProgress(1); }
        else setState('failed');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[studio] cell render failed', err);
        setState('failed');
      } finally {
        hooksRef.current.onSettled?.();
      }
      return;
    }

    // Mock / standalone: local timer simulation so the control still animates.
    timersRef.current.kick = setTimeout(() => setState('running'), 400);
    timersRef.current.tick = setInterval(() => {
      setProgress((p) => {
        const next = Math.min(1, p + 0.08);
        if (next >= 1) {
          if (timersRef.current.tick) clearInterval(timersRef.current.tick);
          setState('done');
        }
        return next;
      });
    }, 250);
  }, [state, cancel, real.isReal, real.projectId, cellUid]);

  useEffect(() => {
    cancel();
    setState('idle');
    setProgress(0);
    setLastOpts(null);
    return cancel;
  }, [cellUid, cancel]);

  return { state, progress, trigger, lastOpts };
}

// ─── the shot-generate hook ───────────────────────────────────────────────

export interface ShotGenerateConfig {
  isReal: boolean;
  projectId: string | null;
  /** Post-enqueue kick — the views pass `bumpActivePoll` so the store's
   *  adaptive poll arms immediately. */
  onEnqueued?: () => void;
  /** Fires once the primary-cell lifecycle settles — the views pass
   *  `refreshRenders`. */
  onSettled?: () => void;
}

export interface ShotGenerateHandle {
  // engine capability (loaded once, shared by both views)
  engines: EngineCapability[];
  /** Engines that actually report video generation, else the full list (so a
   *  build reporting no capability booleans still offers a pick). */
  trackAEngines: EngineCapability[];
  /** Resolve a Track-A (direct render) engine id, preferring the caller's hint
   *  when the server reports it — the fix for Canvas's old `engine: 'fal'`
   *  literal. Honors the hint when the matrix is unknown; falls back to a
   *  fal-aliased or the first video engine when the hint isn't reported. */
  resolveTrackAEngineId(preferred?: string): string | undefined;

  // primary-cell render lifecycle (Cell's live preview reads these)
  renderState: RenderState;
  renderProgress: number;
  lastRenderOpts: RenderOpts | null;
  triggerRender(opts?: RenderOpts): Promise<void>;

  // shared actions (either view; throw on failure so the caller owns busy/error)
  /** Track A — enqueue a render for `uid` and arm the poll. Resolves to the
   *  record id. Callers wrap this with their own busy/error presentation. */
  enqueueRender(uid: string, opts?: RenderOpts): Promise<string>;
  /** Track B return leg — attach an externally produced clip to `uid`. */
  ingestExternal(uid: string, args: { filePath: string; engine: string }): Promise<RenderRecord>;
  /** Track B — build the platform-shaped prompt bundle for `uid`. */
  packagePrompt(uid: string, args: { platform: PromptPlatform }): Promise<PromptPackage>;
  /** Cancel an in-flight render job by record id. */
  cancelRenderJob(recordId: string): Promise<void>;
}

export function useShotGenerate(
  cellUid: string | null,
  cfg: ShotGenerateConfig,
): ShotGenerateHandle {
  // Engine capability, loaded once. Reuse the probe's own render.list_engines
  // result when getMcpClient() already captured it (no second round-trip);
  // otherwise fetch it here. Cheap either way (mock returns flat rows).
  const [engines, setEngines] = useState<EngineCapability[]>(() => getProbedEngines() ?? []);
  useEffect(() => {
    let cancelled = false;
    const probed = getProbedEngines();
    if (probed && probed.length > 0) {
      setEngines(probed);
      return;
    }
    (async () => {
      try {
        const client = await getMcpClient();
        const { engines: list } = await renderApi.list_engines(client);
        if (!cancelled) setEngines(list ?? []);
      } catch {
        if (!cancelled) setEngines([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const videoEngines = engines.filter((e) => e.video === true);
  const trackAEngines = videoEngines.length > 0 ? videoEngines : engines;

  const resolveTrackAEngineId = useCallback((preferred?: string): string | undefined => {
    const vids = engines.filter((e) => e.video === true);
    if (vids.length === 0) return preferred; // matrix unknown → honor caller's hint
    if (preferred && vids.some((e) => e.id === preferred)) return preferred;
    const aliased = vids.find((e) => /fal/i.test(e.id));
    return aliased ? aliased.id : (preferred ?? vids[0].id);
  }, [engines]);

  const lifecycle = useRenderLifecycle(
    cellUid,
    { isReal: cfg.isReal, projectId: cfg.projectId },
    { onEnqueued: cfg.onEnqueued, onSettled: cfg.onSettled },
  );

  const enqueueRender = useCallback(async (uid: string, opts?: RenderOpts): Promise<string> => {
    const client = await getMcpClient();
    const { record_id } = await compositionApi.render(client, {
      project_id: cfg.projectId ?? '',
      cell_uid: uid,
      engine: opts?.engine,
      variant: opts?.variant,
    });
    cfg.onEnqueued?.();
    return record_id;
  }, [cfg.projectId, cfg.onEnqueued]);

  const ingestExternal = useCallback(
    async (uid: string, args: { filePath: string; engine: string }): Promise<RenderRecord> => {
      const client = await getMcpClient();
      return renderApi.ingest_external(client, {
        project_id: cfg.projectId ?? undefined,
        cell_id: uid,
        file_path: args.filePath,
        engine: args.engine,
      });
    },
    [cfg.projectId],
  );

  const packagePrompt = useCallback(
    async (uid: string, args: { platform: PromptPlatform }): Promise<PromptPackage> => {
      const client = await getMcpClient();
      return exportApi.prompt_package(client, {
        project_id: cfg.projectId ?? undefined,
        cell_id: uid,
        platform: args.platform,
      });
    },
    [cfg.projectId],
  );

  const cancelRenderJob = useCallback(async (recordId: string): Promise<void> => {
    const client = await getMcpClient();
    await renderApi.cancel(client, recordId);
  }, []);

  return {
    engines,
    trackAEngines,
    resolveTrackAEngineId,
    renderState: lifecycle.state,
    renderProgress: lifecycle.progress,
    lastRenderOpts: lifecycle.lastOpts,
    triggerRender: lifecycle.trigger,
    enqueueRender,
    ingestExternal,
    packagePrompt,
    cancelRenderJob,
  };
}
