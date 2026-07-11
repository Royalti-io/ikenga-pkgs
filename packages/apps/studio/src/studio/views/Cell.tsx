// com.ikenga.studio · Cell view — CE-A "editor + living preview" (Wave 3)
//
// Concept: designs/redesign/cell-a-living-preview.html + the CE-C strip graft
// (cell-c-strip-context.html). A persistent all-cells strip (beat + status dot
// + rung) sits above a split of a CodeMirror source editor and a preview that
// plays the REAL rendered cell. Selecting a cell from the strip switches the
// edited cell without ever leaving the view — the old "No cell selected" dead
// end is gone.
//
// REAL seams (no fixture in real mode):
//   • Editor content — storyboard.read_cell_content reads the cell's actual
//     content.html off disk (the Cell record only points to it). The mock is
//     used ONLY in standalone/mock mode.
//   • Save — storyboard.write_cell_content persists the FULL edited html back
//     to content.html (durable; the render runner reads the same file). Explicit
//     Save button + Cmd/Ctrl-S + a dirty dot; per-cell buffers survive cell
//     switches AND view remounts so an unsaved edit is never silently dropped.
//     Failures surface as a retryable error banner that keeps the buffer.
//   • Preview — the rendered cell's real mp4 (renderApi.read_bytes → blob:,
//     the Wave-2 pattern). Un-rendered cells show an honest empty state with a
//     "Render this cell" action wired to the real composition.render enqueue +
//     adaptive poll; NO hand-coded mock preview in real mode. Progress is an
//     honest indeterminate bar — the sidecar reports no true percentage.
//   • Anchors — anchor.list (real project anchors) drives the drawer; the
//     fixture is kept only for standalone. Inserting a tile drops
//     <img data-anchor="…"> at the cursor via the anchor-insert extension.
//   • Narration — real check off the cell's narration_excerpt / the project
//     narration block. When absent, an honest note (with a Chi hint) stands in
//     for a dead toggle.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CodeEditor, type CodeEditorHandle } from '@ikenga/ui-lib';
import { insertAnchor } from '@ikenga/ui-lib/extensions';

import {
  getCellHtml,
  getNarrationExcerpt,
  setCellHtmlOverride,
  MOCK_CELLS,
  MOCK_ANCHORS,
  type CellColor,
} from '../__mocks__/cells';
import { selectCellUid, selectPlayheadMs, useSharedStore } from '../shared-state';
import { useProjectStore, selectOpenProject } from '../project-store';
import {
  useStoryboardStore,
  selectHydratedCells,
  selectHydratedProject,
  selectHasRealCells,
  selectRenderStatus,
  selectRenderRecords,
  toDisplayCell,
} from '../storyboard-store';
import {
  getMcpClient,
  storyboardApi,
  compositionApi,
  anchorApi,
  renderApi,
} from '../mcp-client';
import { pollRenderUntilDone } from '../lib/render-poll';
import { recordByUid, fmtRelative, base64ToBlob } from './composition/format';
import type { CellVideoAvailability } from './composition/CellVideo';
import type { Rung, AspectRatio, Anchor, RenderStatus } from '../mcp-types';
import { EmptyState } from '../components/EmptyState';
import { SafeZoneBands } from '../media-controls';

// ─── palette (warm Dusk-Wood role tokens; no hex fallbacks — canvas theme fix) ─

const COLOR_VAR: Record<CellColor, string> = {
  amber: '--achievement',
  rose: '--danger',
  emerald: '--live',
  sky: '--info',
  violet: '--agent',
  neutral: '--fg-muted',
};

function roleTint(color: CellColor, pct: number): string {
  return `color-mix(in oklab, var(${COLOR_VAR[color]}) ${pct}%, transparent)`;
}

const RUNG_ORDER: Rung[] = ['0_beat_sheet', '1_lofi', '2_hifi'];
const RUNG_SHORT: Record<Rung, string> = {
  '0_beat_sheet': 'Beat sheet',
  '1_lofi': 'Lo-fi',
  '2_hifi': 'Hi-fi',
};
const RUNG_LABEL: Record<Rung, string> = {
  '2_hifi': 'hifi',
  '1_lofi': 'lofi',
  '0_beat_sheet': 'beat sheet',
};
const RUNG_DIR: Record<Rung, string> = {
  '2_hifi': 'hifi',
  '1_lofi': 'lofi',
  '0_beat_sheet': 'beatsheet',
};

const ASPECT_RES: Record<AspectRatio, string> = {
  '16:9': '1920×1080',
  '9:16': '1080×1920',
  '1:1': '1080×1080',
};

function previewFrameStyle(aspect: AspectRatio): React.CSSProperties {
  if (aspect === '9:16') return { height: '100%', aspectRatio: '9 / 16', maxWidth: '100%' };
  if (aspect === '1:1') return { height: '100%', aspectRatio: '1 / 1', maxWidth: '100%' };
  return { width: '100%', height: '100%' };
}

// ─── unified strip cell shape (real hydrated OR mock fixture) ────────────

interface StripCell {
  uid: string;
  beat: string;
  rung: Rung;
  color: CellColor;
  block_id?: string;
}

// ─── per-cell edit buffers (module-level → survive view remount) ─────────
//
// Keyed by `${projectId}::${uid}` so an unsaved edit is preserved across cell
// switches AND across leaving/re-entering the Cell pane, never silently
// discarded. `saved*` track the last-persisted content so the dirty dot is
// truthful. These are the P1 stand-in for the shell relaying a cells/changed
// event; a save writes through to disk immediately (write_cell_content).

const editBuffers = new Map<string, string>();
const savedContent = new Map<string, string>();
const savedAtMap = new Map<string, number>();
const bufKey = (pid: string | null, uid: string) => `${pid ?? 'mock'}::${uid}`;

// ─── rendered-cell preview (reuses the Wave-2 read_bytes → blob pattern) ──
//
// bytes-over-bridge → Blob → blob: is the one media scheme the sandboxed
// srcdoc pane's CSP allows (see CellVideo header). Native <video controls> is
// the right affordance for reviewing a single cell (scrub / play / volume).
// Degrades honestly: a running server that predates render.read_bytes (or mock
// mode) returns empty base64 → we report 'unavailable' and the parent shows
// the status fallback instead of ever faking a player.

function RenderedCellVideo({
  recordId,
  onState,
}: {
  recordId: string;
  onState: (s: CellVideoAvailability) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    onStateRef.current('loading');
    (async () => {
      try {
        const client = await getMcpClient();
        const bytes = await renderApi.read_bytes(client, recordId);
        if (cancelled) return;
        if (!bytes.base64) {
          setSrc(null);
          onStateRef.current('unavailable');
          return;
        }
        url = URL.createObjectURL(base64ToBlob(bytes.base64, bytes.mime));
        setSrc(url);
      } catch {
        if (!cancelled) {
          setSrc(null);
          onStateRef.current('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [recordId]);

  if (!src) return null;
  return (
    <video
      src={src}
      controls
      playsInline
      preload="auto"
      className="h-full w-full object-contain"
      onCanPlay={() => onStateRef.current('ready')}
      onError={() => onStateRef.current('error')}
      aria-label="Rendered cell preview"
    />
  );
}

// ─── render lifecycle (enqueue + poll; honest indeterminate progress) ────

type RenderState = 'idle' | 'queued' | 'running' | 'done' | 'failed';

function useRenderLifecycle(
  cellUid: string | null,
  real: { isReal: boolean; projectId: string | null },
  hooks: { onEnqueued?: () => void; onSettled?: () => void },
) {
  const [state, setState] = useState<RenderState>('idle');
  // progress is only ever a real fraction in the mock timer path; real mode
  // keeps it 0 (the sidecar reports no true %) so the UI renders indeterminate.
  const [progress, setProgress] = useState(0);
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

  const trigger = useCallback(async () => {
    if (state === 'queued' || state === 'running') return;
    cancel();
    abortRef.current = { aborted: false };
    setState('queued');
    setProgress(0);

    if (real.isReal && real.projectId && cellUid) {
      try {
        const client = await getMcpClient();
        const { record_id } = await compositionApi.render(client, {
          project_id: real.projectId,
          cell_uid: cellUid,
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
        if (rec?.status === 'done') { setState('done'); setProgress(1); }
        else if (rec) setState('failed');
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
    return cancel;
  }, [cellUid, cancel]);

  return { state, progress, trigger };
}

// Nominal narration window for the excerpt highlight (P1 stand-in for real
// per-word timing when sync is on).
const NARRATION_WINDOW_MS = 3200;

// ─── View ───────────────────────────────────────────────────────────────

export function CellView() {
  const cellUid = useSharedStore(selectCellUid);
  const playheadMs = useSharedStore(selectPlayheadMs);
  const setCellUid = useSharedStore((s) => s.setCellUid);
  const project = useProjectStore(selectOpenProject);

  const hasRealCells = useStoryboardStore(selectHasRealCells);
  const hydratedCells = useStoryboardStore(selectHydratedCells);
  const projectDoc = useStoryboardStore(selectHydratedProject);
  const renderStatus = useStoryboardStore(selectRenderStatus);
  const renderRecords = useStoryboardStore(selectRenderRecords);
  const refetchStoryboard = useStoryboardStore((s) => s.refetch);
  const refreshRenders = useStoryboardStore((s) => s.refreshRenders);
  const bumpActivePoll = useStoryboardStore((s) => s.bumpActivePoll);

  const pid = hasRealCells ? project?.project_id ?? null : null;

  // Re-read on focus (POLL-on-demand stand-in for cells/changed).
  useEffect(() => { void refetchStoryboard(); }, [refetchStoryboard]);

  // Strip source: real hydrated cells, else the mock fixture.
  const stripCells = useMemo<StripCell[]>(() => {
    if (hasRealCells) {
      return hydratedCells.map((c) => {
        const d = toDisplayCell(c);
        return { uid: d.uid, beat: d.beat, rung: d.rung, color: d.color, block_id: d.block_id };
      });
    }
    return MOCK_CELLS.map((c) => ({
      uid: c.uid,
      beat: c.beat,
      rung: c.rung,
      color: c.color,
      block_id: c.block_id,
    }));
  }, [hasRealCells, hydratedCells]);

  const cell = useMemo<StripCell | null>(
    () => stripCells.find((c) => c.uid === cellUid) ?? null,
    [stripCells, cellUid],
  );
  const rawCell = useMemo(
    () => (hasRealCells ? hydratedCells.find((c) => c.uid === cellUid) ?? null : null),
    [hasRealCells, hydratedCells, cellUid],
  );

  // ── editor content + save state ──
  const [value, setValue] = useState('');
  const [contentState, setContentState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorRef = useRef<CodeEditorHandle>(null);

  // Load the active cell's content — reuse a preserved buffer if present, else
  // read the REAL content.html (real) / the mock fixture (standalone).
  useEffect(() => {
    if (!cellUid) { setContentState('idle'); return; }
    const key = bufKey(pid, cellUid);
    if (editBuffers.has(key)) {
      const buf = editBuffers.get(key)!;
      setValue(buf);
      setContentState('ready');
      setSaveError(null);
      setSaveState(buf !== savedContent.get(key) ? 'dirty' : 'saved');
      return;
    }
    let cancelled = false;
    setSaveError(null);
    if (!hasRealCells) {
      const html = getCellHtml(cellUid);
      editBuffers.set(key, html);
      savedContent.set(key, html);
      setValue(html);
      setContentState('ready');
      setSaveState('saved');
      return;
    }
    setContentState('loading');
    (async () => {
      try {
        const client = await getMcpClient();
        const res = await storyboardApi.read_cell_content(client, cellUid);
        if (cancelled) return;
        const html = res.html ?? '';
        editBuffers.set(key, html);
        savedContent.set(key, html);
        setValue(html);
        setContentState('ready');
        setSaveState('saved');
      } catch (err) {
        if (cancelled) return;
        setContentState('unavailable');
        setSaveError((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [cellUid, hasRealCells, pid]);

  const onEditorChange = useCallback((next: string) => {
    setValue(next);
    if (!cellUid) return;
    const key = bufKey(pid, cellUid);
    editBuffers.set(key, next);
    setSaveState(next !== savedContent.get(key) ? 'dirty' : 'saved');
    setSaveError((e) => (e ? null : e));
  }, [cellUid, pid]);

  const doSave = useCallback(async () => {
    if (!cellUid || contentState !== 'ready') return;
    const key = bufKey(pid, cellUid);
    const html = editBuffers.get(key) ?? value;
    if (html === savedContent.get(key) && saveState !== 'error') return;
    setSaveState('saving');
    setSaveError(null);
    try {
      const client = await getMcpClient();
      if (hasRealCells) {
        await storyboardApi.write_cell_content(client, cellUid, html);
        await refetchStoryboard();
        await refreshRenders();
      } else {
        // standalone/mock: no real disk — round-trip through the override cache.
        setCellHtmlOverride(cellUid, html);
      }
      savedContent.set(key, html);
      savedAtMap.set(key, Date.now());
      // The buffer may have moved on while the awaits were in flight — a
      // trailing unconditional 'saved' would clobber that dirtiness and the
      // newer keystrokes would read as persisted when they aren't.
      const current = editBuffers.get(key) ?? html;
      setSaveState(current === html ? 'saved' : 'dirty');
    } catch (err) {
      setSaveState('error');
      setSaveError((err as Error).message);
    }
  }, [cellUid, pid, value, contentState, saveState, hasRealCells, refetchStoryboard, refreshRenders]);

  // Cmd/Ctrl-S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void doSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doSave]);

  const dirty = saveState === 'dirty' || saveState === 'error';
  const canSave = dirty && contentState === 'ready';
  const savedAt = cellUid ? savedAtMap.get(bufKey(pid, cellUid)) : undefined;

  // ── anchors ──
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [anchorDrawerOpen, setAnchorDrawerOpen] = useState(false);
  useEffect(() => {
    if (!hasRealCells) { setAnchors([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const client = await getMcpClient();
        const res = await anchorApi.list(client);
        if (!cancelled) setAnchors(res.anchors ?? []);
      } catch {
        if (!cancelled) setAnchors([]);
      }
    })();
    return () => { cancelled = true; };
  }, [hasRealCells, pid]);

  const drawerAnchors: Array<{ id: string; name: string; kind: string; color: CellColor }> = hasRealCells
    ? anchors.map((a) => ({ id: a.id, name: a.name, kind: a.kind, color: 'neutral' as CellColor }))
    : MOCK_ANCHORS.map((a) => ({ id: a.id, name: a.name, kind: a.kind, color: a.color }));

  const insertAnchorAtCursor = (anchorId?: string) => {
    const view = editorRef.current?.view();
    if (!view) return;
    insertAnchor(anchorId)(view);
    // the doc change flows through CodeEditor.onChange → onEditorChange (dirty).
  };

  // ── render lifecycle + preview record ──
  const { state: renderState, progress: renderProgress, trigger: triggerRender } = useRenderLifecycle(
    cellUid,
    { isReal: hasRealCells, projectId: project?.project_id ?? null },
    {
      onEnqueued: () => bumpActivePoll(),
      onSettled: () => { void refreshRenders(); },
    },
  );

  const recByUid = useMemo(
    () => (hasRealCells ? recordByUid(renderRecords) : {}),
    [hasRealCells, renderRecords],
  );
  const activeRecord = cellUid ? recByUid[cellUid] : undefined;
  const activeRecordId = activeRecord?.status === 'done' ? activeRecord.id : null;
  const [videoState, setVideoState] = useState<CellVideoAvailability>('unavailable');
  useEffect(() => { setVideoState('unavailable'); }, [activeRecordId]);

  const storeStatus: RenderStatus | undefined = cellUid ? renderStatus[cellUid] : undefined;
  const stripStatus = useCallback(
    (uid: string): RenderStatus | undefined => {
      if (hasRealCells) return renderStatus[uid];
      const m = MOCK_CELLS.find((c) => c.uid === uid);
      return m?.progress != null ? 'running' : undefined;
    },
    [hasRealCells, renderStatus],
  );

  const rendering =
    renderState === 'queued' || renderState === 'running' || storeStatus === 'queued' || storeStatus === 'running';
  const failed = renderState === 'failed' || storeStatus === 'failed';

  // ── narration (honest) ──
  const [narrationSync, setNarrationSync] = useState(false);
  const narrationText = hasRealCells
    ? rawCell?.narration_excerpt ?? null
    : getNarrationExcerpt(cellUid)?.text ?? null;
  const narrationStaticIdx = hasRealCells ? 0 : getNarrationExcerpt(cellUid)?.activeWordIdx ?? 0;
  const narrationActiveIdx = (() => {
    if (!narrationText) return 0;
    if (!narrationSync) return narrationStaticIdx;
    const wordCount = narrationText.trim().split(/\s+/).length;
    if (wordCount === 0) return 0;
    const phase = ((playheadMs % NARRATION_WINDOW_MS) + NARRATION_WINDOW_MS) % NARRATION_WINDOW_MS;
    return Math.min(wordCount - 1, Math.floor((phase / NARRATION_WINDOW_MS) * wordCount));
  })();

  // ── header derived bits ──
  const aspect: AspectRatio = project?.aspect_ratio ?? '16:9';
  const isPortrait = aspect === '9:16';
  const contentPath = cell
    ? (rawCell?.content_path ?? `cells/${RUNG_DIR[cell.rung]}/${cell.uid}/content.html`)
    : '';
  const rungsForBeat = useMemo(() => {
    if (!cell) return new Set<Rung>();
    return new Set(stripCells.filter((c) => c.beat === cell.beat).map((c) => c.rung));
  }, [stripCells, cell]);

  // ── empty project (no cells at all) ──
  if (stripCells.length === 0) {
    return (
      <EmptyState glyph="▤" title="No cells yet" hint="the storyboard is written for you, not by hand">
        <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-faint">
          Ask your Chi in the chat dock to storyboard this project — try{' '}
          <span className="font-mono text-fg-muted">"storyboard a 30s explainer"</span>. It writes the
          cells straight into the canvas.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-base text-fg">
      {/* ═══ persistent cell strip (CE-C graft — no dead ends) ═══ */}
      <div
        role="tablist"
        aria-label="Cells in this project"
        className="flex items-stretch gap-2 overflow-x-auto border-b border-soft bg-sunken px-3 py-2"
      >
        {stripCells.map((c) => {
          const st = stripStatus(c.uid);
          const active = c.uid === cellUid;
          return (
            <button
              type="button"
              key={c.uid}
              role="tab"
              aria-selected={active}
              aria-label={`${c.beat} cell, ${c.uid}, ${RUNG_LABEL[c.rung]} rung`}
              onClick={() => setCellUid(c.uid)}
              title={`${c.uid} · ${c.beat} · ${RUNG_LABEL[c.rung]}`}
              className="flex min-w-[172px] flex-1 items-center gap-2.5 rounded-md border p-1.5 text-left transition-colors"
              style={{
                borderColor: active ? `var(${COLOR_VAR[c.color]})` : 'var(--border-soft)',
                background: active ? roleTint(c.color, 9) : 'var(--bg-surface)',
                boxShadow: active ? `inset 0 0 0 1px ${roleTint(c.color, 30)}` : undefined,
              }}
            >
              <span
                className="flex h-[38px] w-[64px] flex-none items-center justify-center overflow-hidden rounded-sm text-[8px]"
                style={{
                  background: `linear-gradient(160deg, ${roleTint(c.color, 22)}, var(--bg-sunken))`,
                  border: `1px solid ${roleTint(c.color, 26)}`,
                }}
              >
                <span className="font-mono uppercase tracking-wider" style={{ color: `var(${COLOR_VAR[c.color]})` }}>
                  {RUNG_LABEL[c.rung].slice(0, 4)}
                </span>
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-mono text-[11px] text-fg">{c.uid}</span>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-fg-muted">
                  <StatusDot status={st} />
                  <span className="truncate" style={{ color: `var(${COLOR_VAR[c.color]})` }}>{c.beat}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* no cell selected → inline prompt (strip stays put; not a dead end) */}
      {!cell ? (
        <div className="grid min-h-0 flex-1 place-items-center bg-sunken p-8 text-center">
          <div className="max-w-sm">
            <div
              aria-hidden="true"
              className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-soft bg-raised text-fg-faint"
            >
              ▤
            </div>
            <div className="font-display text-sm text-fg-muted">Pick a cell to edit</div>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">
              Choose any cell in the strip above — you never have to leave this view to switch.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* ═══ header: cell chip · rung ladder · save cluster · render ═══ */}
          <div className="flex items-center gap-3 border-b border-soft bg-sunken px-3 py-1.5 text-[11px]">
            <div className="flex min-w-0 items-center gap-2 text-fg-muted">
              <span className="font-mono">{contentPath}</span>
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset"
                style={{
                  color: `var(${COLOR_VAR[cell.color]})`,
                  background: roleTint(cell.color, 15),
                  borderColor: roleTint(cell.color, 40),
                }}
              >
                {cell.beat}
              </span>
            </div>

            {/* rung ladder — beat sheet → lo-fi → hi-fi (current cell's rung) */}
            <nav className="flex items-center gap-1" aria-label="Fidelity rung">
              {RUNG_ORDER.map((r) => {
                const isCurrent = r === cell.rung;
                const isDone = !isCurrent && rungsForBeat.has(r);
                return (
                  <span
                    key={r}
                    aria-current={isCurrent ? 'step' : undefined}
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
                    style={{ color: isCurrent ? 'var(--achievement)' : isDone ? 'var(--fg-muted)' : 'var(--fg-faint)' }}
                  >
                    <span
                      className="h-[7px] w-[7px] rounded-full border"
                      style={{
                        background: isCurrent ? 'var(--achievement)' : isDone ? 'var(--live)' : 'transparent',
                        borderColor: isCurrent ? 'var(--achievement)' : isDone ? 'var(--live)' : 'var(--fg-faint)',
                        boxShadow: isCurrent ? '0 0 0 3px var(--achievement-soft)' : undefined,
                      }}
                    />
                    {RUNG_SHORT[r]}
                  </span>
                );
              })}
            </nav>

            <div className="flex-1" />

            {/* save cluster */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background:
                      saveState === 'error'
                        ? 'var(--danger)'
                        : saveState === 'dirty'
                        ? 'var(--achievement)'
                        : saveState === 'saving'
                        ? 'transparent'
                        : 'var(--live)',
                    boxShadow:
                      saveState === 'error'
                        ? '0 0 0 3px var(--danger-soft)'
                        : saveState === 'dirty'
                        ? '0 0 0 3px var(--achievement-soft)'
                        : saveState === 'saved'
                        ? '0 0 0 3px var(--live-soft)'
                        : undefined,
                  }}
                />
                <span className="text-fg-muted">
                  {saveState === 'saved' && 'Saved'}
                  {saveState === 'dirty' && 'Unsaved changes'}
                  {saveState === 'saving' && 'Saving…'}
                  {saveState === 'error' && 'Save failed'}
                </span>
                {saveState === 'saved' && savedAt && (
                  <span className="font-mono text-[10px] text-fg-faint">{fmtHHMM(savedAt)}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => void doSave()}
                disabled={!canSave}
                className={
                  'flex items-center gap-1.5 rounded px-2 py-1 ring-1 ring-inset ' +
                  (canSave
                    ? 'bg-raised text-fg ring-[var(--border)] hover:bg-[color-mix(in_oklab,var(--bg-raised)_70%,var(--fg)_6%)]'
                    : 'cursor-not-allowed text-fg-faint ring-[var(--border-soft)] opacity-50')
                }
              >
                ⌘S Save
              </button>
              <button
                type="button"
                onClick={triggerRender}
                disabled={renderState === 'queued' || renderState === 'running'}
                className={
                  'flex items-center gap-1.5 rounded px-2 py-1 ring-1 ring-inset ' +
                  (renderState === 'idle' || renderState === 'done'
                    ? 'bg-[color-mix(in_oklab,var(--primary)_60%,transparent)] text-[var(--primary-fg)] ring-[color-mix(in_oklab,var(--primary)_50%,transparent)] hover:bg-[color-mix(in_oklab,var(--primary)_78%,transparent)]'
                    : renderState === 'failed'
                    ? 'bg-[color-mix(in_oklab,var(--danger)_18%,transparent)] text-[var(--danger)] ring-[color-mix(in_oklab,var(--danger)_40%,transparent)]'
                    : 'cursor-wait bg-raised text-fg-muted ring-[var(--border)]')
                }
              >
                {(renderState === 'idle') && <span>▶ Render cell</span>}
                {renderState === 'queued' && <span>● Queued…</span>}
                {renderState === 'running' && <span>● Rendering…</span>}
                {renderState === 'done' && <span>↻ Re-render</span>}
                {renderState === 'failed' && <span>! Retry render</span>}
              </button>
            </div>
          </div>

          {/* error banner (save failure — keeps the buffer, offers retry) */}
          {saveState === 'error' && (
            <div
              role="alert"
              className="flex items-center gap-2 border-b px-3 py-1.5 text-[11px]"
              style={{
                background: 'var(--danger-soft)',
                borderColor: 'color-mix(in oklab, var(--danger) 40%, var(--border))',
                color: 'color-mix(in oklab, var(--danger) 55%, var(--fg))',
              }}
            >
              <span className="flex-1">
                Couldn't save this cell{saveError ? ` — ${saveError}` : '.'} Your edits are kept.
              </span>
              <button
                type="button"
                onClick={() => void doSave()}
                className="underline"
                style={{ color: 'var(--danger)' }}
              >
                Retry
              </button>
            </div>
          )}

          {/* content-unavailable banner (server build lacks the read seam) */}
          {contentState === 'unavailable' && (
            <div
              role="status"
              className="border-b border-soft bg-base px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint"
            >
              couldn't load this cell's source — the studio server on this build doesn't expose cell content
            </div>
          )}

          {/* anchor drawer */}
          {anchorDrawerOpen && (
            <div className="border-b border-soft bg-surface px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                  project anchors · click to insert at cursor
                </div>
                <button
                  type="button"
                  onClick={() => setAnchorDrawerOpen(false)}
                  className="text-[11px] text-fg-faint hover:text-fg"
                >
                  close
                </button>
              </div>
              {drawerAnchors.length === 0 ? (
                <div className="text-[11px] text-fg-muted">
                  No anchors in this project yet — ask your Chi to import brand assets, or add one below.
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-2">
                  {drawerAnchors.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => insertAnchorAtCursor(a.id)}
                      className="rounded border border-[var(--border)] bg-base p-2 text-left hover:border-[var(--border-soft)] hover:bg-raised"
                      title={`Insert <img data-anchor="${a.id}"> at cursor`}
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: `var(${COLOR_VAR[a.color]})` }}
                        />
                        <span className="font-mono text-[10px] text-fg">{a.id}</span>
                      </div>
                      <div className="truncate text-[10px] text-fg">{a.name}</div>
                      <div className="font-mono text-[9px] text-fg-faint">{a.kind}</div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => insertAnchorAtCursor()}
                    title="Insert a new auto-numbered anchor at cursor"
                    className="flex items-center justify-center rounded border border-dashed border-[var(--border)] bg-base p-2 text-[11px] text-fg-faint hover:border-[var(--border-soft)] hover:text-fg"
                  >
                    + new
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ═══ split: editor | living preview ═══ */}
          <div className="flex min-h-0 flex-1">
            {/* editor */}
            <div className="flex min-h-0 flex-1 flex-col border-r border-soft bg-sunken">
              <div className="flex items-center gap-2 border-b border-soft bg-surface px-3 py-1.5 text-[11px] text-fg-muted">
                <span>Source</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">{contentPath.split('/').pop() ?? 'content.html'}</span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setAnchorDrawerOpen((o) => !o)}
                  aria-expanded={anchorDrawerOpen}
                  className={
                    'flex items-center gap-1.5 rounded px-2 py-0.5 ' +
                    (anchorDrawerOpen ? 'bg-raised text-fg' : 'text-fg-muted hover:bg-raised hover:text-fg')
                  }
                >
                  <span>✦ Anchors</span>
                  <span className="font-mono text-[10px] text-fg-faint">{drawerAnchors.length}</span>
                </button>
              </div>
              <div className="relative min-h-0 flex-1">
                <CodeEditor
                  ref={editorRef}
                  value={value}
                  onChange={onEditorChange}
                  readOnly={contentState !== 'ready'}
                  language="html"
                  ariaLabel={`Cell ${cell.uid} HTML editor`}
                  className="h-full min-h-0"
                />
                {contentState === 'loading' && (
                  <div
                    className="absolute inset-0 grid place-items-center font-mono text-[10px] uppercase tracking-wider text-fg-faint"
                    style={{ background: 'color-mix(in oklab, var(--bg-sunken) 70%, transparent)' }}
                  >
                    loading source…
                  </div>
                )}
              </div>
            </div>

            {/* living preview — the REAL rendered cell */}
            <div className="flex w-[46%] min-h-0 flex-col bg-base">
              <div className="flex items-center gap-2 border-b border-soft bg-surface px-3 py-1.5 text-[11px] text-fg-muted">
                <span>Preview</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                  {aspect} · {ASPECT_RES[aspect]}
                </span>
                <div className="flex-1" />
                {activeRecordId && videoState === 'ready' ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--live)', boxShadow: '0 0 0 3px var(--live-soft)' }} />
                    <span>Rendered</span>
                    <span className="font-mono text-[10px] text-fg-faint">
                      {fmtRelative(activeRecord?.finished_at, Date.now())}
                    </span>
                  </span>
                ) : rendering ? (
                  <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--ember)' }}>
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--ember)' }} />
                    <span>Rendering</span>
                  </span>
                ) : null}
              </div>

              <div className="grid min-h-0 flex-1 place-items-center p-3">
                <div
                  className="relative flex items-center justify-center overflow-hidden rounded-sm bg-sunken"
                  style={previewFrameStyle(aspect)}
                >
                  {isPortrait && <SafeZoneBands />}

                  {/* real rendered mp4 */}
                  {activeRecordId && (
                    <RenderedCellVideo recordId={activeRecordId} onState={setVideoState} />
                  )}

                  {/* honest overlays for every non-playing state */}
                  {(!activeRecordId || videoState === 'unavailable' || videoState === 'error') && (
                    <div className="grid place-items-center px-4 text-center">
                      {rendering ? (
                        <div className="grid gap-3 justify-items-center">
                          <div
                            className="h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--border)]"
                            style={{ borderTopColor: 'var(--ember)' }}
                          />
                          <div className="text-[13px] text-fg">Rendering this cell…</div>
                          {/* honest indeterminate bar — no fabricated percentage */}
                          <div className="relative h-1 w-48 overflow-hidden rounded-full bg-raised">
                            <div className="studio-indet rounded-full" />
                          </div>
                          <div className="font-mono text-[10px] text-fg-muted">HyperFrames · software GPU</div>
                        </div>
                      ) : failed ? (
                        <div className="grid gap-2 justify-items-center">
                          <div className="text-2xl" style={{ color: 'var(--danger)' }}>!</div>
                          <div className="text-[13px] text-fg-muted">Render failed</div>
                          <button
                            type="button"
                            onClick={triggerRender}
                            className="rounded px-2 py-1 text-[11px] ring-1 ring-inset ring-[var(--border)] text-fg hover:bg-raised"
                          >
                            ↻ Try again
                          </button>
                        </div>
                      ) : videoState === 'unavailable' && activeRecordId ? (
                        <div className="grid gap-2 justify-items-center">
                          <div className="text-[13px] text-fg-muted">Preview bytes unavailable on this build</div>
                          <div className="font-mono text-[10px] text-fg-faint">
                            render exists — bytes-over-bridge not served here
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-3 justify-items-center">
                          <div
                            aria-hidden="true"
                            className="flex h-11 w-11 items-center justify-center rounded-lg border border-soft bg-raised text-fg-faint"
                          >
                            ▷
                          </div>
                          <div className="text-[13px] text-fg-muted">Not rendered yet</div>
                          <button
                            type="button"
                            onClick={triggerRender}
                            className="rounded px-3 py-1 text-[11px] ring-1 ring-inset"
                            style={{
                              background: 'color-mix(in oklab, var(--primary) 60%, transparent)',
                              color: 'var(--primary-fg)',
                              borderColor: 'transparent',
                            }}
                          >
                            ▶ Render this cell
                          </button>
                          {!hasRealCells && (
                            <div className="max-w-[16rem] font-mono text-[9px] leading-relaxed text-fg-faint">
                              standalone preview · the rendered mp4 appears here once a render backend is attached
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* narration row (honest) */}
              <div className="flex items-center gap-3 border-t border-soft bg-surface px-3 py-2 text-[11px]">
                {narrationText ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setNarrationSync((s) => !s)}
                      aria-pressed={narrationSync}
                      className={
                        'flex flex-none items-center gap-1.5 rounded px-2 py-1 ' +
                        (narrationSync ? 'bg-raised text-fg' : 'text-fg-muted hover:bg-raised hover:text-fg')
                      }
                      title="Sync the narration highlight to the composition playhead"
                    >
                      <span>▸ Narration</span>
                    </button>
                    <div className="min-w-0 flex-1 leading-relaxed text-fg-muted">
                      {narrationText.split(/(\s+)/).map((tok, i) => {
                        if (/^\s+$/.test(tok)) return tok;
                        const wordIdx =
                          narrationText.slice(0, narrationText.indexOf(tok) + tok.length).split(/\s+/).length - 1;
                        const active = wordIdx === narrationActiveIdx;
                        return (
                          <span
                            key={`${i}-${tok}`}
                            className={active ? 'font-medium' : 'opacity-60'}
                            style={active ? { color: 'var(--achievement)' } : undefined}
                          >
                            {tok}
                          </span>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-fg-muted">
                    <span className="opacity-40">▸ Narration</span>
                    <span className="text-[11px]">
                      No narration on this cell yet — ask your Chi in chat to add voiceover.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── small helpers ────────────────────────────────────────────────────────

function StatusDot({ status }: { status: RenderStatus | undefined }) {
  if (status === 'done') {
    return <span className="h-[6px] w-[6px] rounded-full" style={{ background: 'var(--live)', boxShadow: '0 0 0 2px var(--live-soft)' }} />;
  }
  if (status === 'running' || status === 'queued') {
    return <span className="h-[6px] w-[6px] rounded-full" style={{ background: 'var(--ember)' }} />;
  }
  if (status === 'failed') {
    return <span className="h-[6px] w-[6px] rounded-full" style={{ background: 'var(--danger)' }} />;
  }
  return <span className="h-[6px] w-[6px] rounded-full" style={{ background: 'var(--fg-faint)' }} />;
}

function fmtHHMM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
