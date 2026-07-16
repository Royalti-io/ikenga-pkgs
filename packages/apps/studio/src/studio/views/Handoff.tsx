// com.ikenga.studio · Handoff view — Track B "production desk"
//
// Concept: designs/redesign-ai/handoff-a-production-desk.html. Two-step
// round-trip for a shot that's handed off to an external image-to-video tool
// instead of Ikenga's own fal render path:
//
//   1 SEND OUT  — pick a platform (Higgsfield / Google Flow / Veo / generic),
//                 preview the shaped prompt package (export.prompt_package),
//                 copy/export it.
//   2 BRING HOME — drop the clip generated elsewhere back onto the same cell
//                 (render.ingest_external), landing it on the board as a
//                 done render with manual provenance, same as any other clip.
//
// REAL seams (no fixture in real mode):
//   • Shot context + shotlist — the open project's hydrated cells
//     (storyboard-store). Selecting a shot in the rail sets the shared
//     cellUid so Cell/Composition pick up the same selection.
//   • Anchors in frame — anchor.list, filtered to the current cell's
//     anchors[] ids.
//   • Prompt package — export.prompt_package(cell_id, platform), refetched
//     whenever the cell or platform changes.
//   • Ingest-back — render.ingest_external attaches the dropped clip to the
//     current cell with manual provenance, then refetches the storyboard +
//     render list so it shows up everywhere else immediately.
//
// This view has no read seam for actual reference-image bytes (anchors carry
// a project-relative/on-disk asset uri the sandboxed iframe cannot resolve as
// an <img src>), so reference frames are labeled placeholder tiles — same
// treatment the locked design concept uses throughout, not a fabricated
// thumbnail.
//
// There is likewise no host file-picker seam for a single file (only
// `host.openFolder()` exists, see bridge.ts). The dropzone accepts a native
// browser drop and tries the dropped File's `.path` (present in some
// webview/Electron-style environments); when that isn't available the view
// falls back to an explicit "paste the absolute path" field rather than
// silently failing or fabricating a path.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSharedStore, selectCellUid } from '../shared-state';
import { useProjectStore, selectOpenProject } from '../project-store';
import {
  useStoryboardStore,
  selectHydratedCells,
  selectHasRealCells,
  selectRenderRecords,
} from '../storyboard-store';
import { useAnchorsStore, selectAnchors } from '../anchors-store';
import { getMcpClient, exportApi, renderApi } from '../mcp-client';
import type { Cell, PromptPackage, PromptPackageEntry, RenderRecord } from '../mcp-types';
import { EmptyState } from '../components/EmptyState';
import { useLayoutStore } from '../layout-store';
import { fmtSeconds, fmtRelative } from './composition/format';

// ─── platform picker (schema PromptPlatform — no more/less than this) ────

type PlatformId = PromptPackageEntry['platform'];

const PLATFORMS: Array<{ id: PlatformId; name: string; meta: string }> = [
  { id: 'higgsfield', name: 'Higgsfield', meta: 'Image-to-video · camera control' },
  { id: 'flow', name: 'Google Flow', meta: 'Veo 3 · scene extend' },
  { id: 'veo', name: 'Veo', meta: 'Google · direct prompt' },
  { id: 'generic', name: 'Generic', meta: 'Plain package · any tool' },
];

const SHOT_LABEL: Record<string, string> = {
  ews: 'EWS', ws: 'WS', ls: 'LS', fs: 'FS', ms: 'MS', cu: 'CU', ecu: 'ECU',
  ots: 'OTS', pov: 'POV', insert: 'INSERT', aerial: 'AERIAL', unset: '—',
};

function shotLabel(shot: string | undefined): string {
  if (!shot) return '—';
  return SHOT_LABEL[shot] ?? shot.toUpperCase();
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

// ─── ingest-back state ────────────────────────────────────────────────────

type IngestState = 'idle' | 'attaching' | 'error';

// ─── View ─────────────────────────────────────────────────────────────────

export function HandoffView() {
  const cellUid = useSharedStore(selectCellUid);
  const setCellUid = useSharedStore((s) => s.setCellUid);
  const project = useProjectStore(selectOpenProject);

  const hasRealCells = useStoryboardStore(selectHasRealCells);
  const hydratedCells = useStoryboardStore(selectHydratedCells);
  const renderRecords = useStoryboardStore(selectRenderRecords);
  const refetchStoryboard = useStoryboardStore((s) => s.refetch);
  const refreshRenders = useStoryboardStore((s) => s.refreshRenders);

  // Re-read on focus (POLL-on-demand stand-in for cells/changed).
  useEffect(() => { void refetchStoryboard(); }, [refetchStoryboard]);

  const cell: Cell | null = useMemo(
    () => (hasRealCells ? hydratedCells.find((c) => c.uid === cellUid) ?? null : null),
    [hasRealCells, hydratedCells, cellUid],
  );

  const recordByUid = useMemo(() => {
    const map = new Map<string, RenderRecord>();
    for (const r of renderRecords) {
      const prev = map.get(r.cell_uid);
      if (!prev || (r.finished_at ?? '') > (prev.finished_at ?? '')) map.set(r.cell_uid, r);
    }
    return map;
  }, [renderRecords]);

  // ── shot nav (prev/next through the hydrated cell order) ──
  const orderedUids = useMemo(() => hydratedCells.map((c) => c.uid), [hydratedCells]);
  const cellIdx = cellUid ? orderedUids.indexOf(cellUid) : -1;
  const prevUid = cellIdx > 0 ? orderedUids[cellIdx - 1] : null;
  const nextUid = cellIdx >= 0 && cellIdx < orderedUids.length - 1 ? orderedUids[cellIdx + 1] : null;

  const backToBoard = useCallback(() => {
    const { focusedPane, setPaneView } = useLayoutStore.getState();
    setPaneView(focusedPane, 'canvas');
  }, []);

  // ── anchors in frame (shared store — review §2.4) ──
  const storeAnchors = useAnchorsStore(selectAnchors);
  const ensureAnchors = useAnchorsStore((s) => s.ensure);
  useEffect(() => {
    if (hasRealCells && project?.project_id) ensureAnchors(project.project_id);
  }, [hasRealCells, project?.project_id, ensureAnchors]);
  const anchors = hasRealCells ? storeAnchors : [];

  const anchorsInFrame = useMemo(
    () => (cell ? anchors.filter((a) => cell.anchors.includes(a.id)) : []),
    [anchors, cell],
  );

  // ── platform + prompt package ──
  const [platform, setPlatform] = useState<PlatformId>('higgsfield');
  const [pkg, setPkg] = useState<PromptPackage | null>(null);
  const [pkgState, setPkgState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [pkgError, setPkgError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasRealCells || !cellUid) { setPkg(null); setPkgState('idle'); return; }
    let cancelled = false;
    setPkgState('loading');
    setPkgError(null);
    (async () => {
      try {
        const client = await getMcpClient();
        const res = await exportApi.prompt_package(client, { cell_id: cellUid, platform });
        if (cancelled) return;
        setPkg(res);
        setPkgState('ready');
      } catch (err) {
        if (cancelled) return;
        setPkg(null);
        setPkgState('error');
        setPkgError((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [hasRealCells, cellUid, platform]);

  const entry: PromptPackageEntry | null = useMemo(
    () => pkg?.packages.find((p) => p.cellId === cellUid) ?? pkg?.packages[0] ?? null,
    [pkg, cellUid],
  );

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyPackage = useCallback(async () => {
    if (!pkg) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(pkg, null, 2));
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1800);
    }
  }, [pkg]);

  const exportJson = useCallback(() => {
    if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cellUid ?? 'prompt-package'}-${platform}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [pkg, cellUid, platform]);

  // ── ingest-back ──
  const [filePath, setFilePath] = useState('');
  const [ingestState, setIngestState] = useState<IngestState>('idle');
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const attachedRecord = cellUid ? recordByUid.get(cellUid) : undefined;
  const attachedIsManual = attachedRecord?.engine === platform || attachedRecord?.metadata?.provenance === 'manual';

  const doIngest = useCallback(async (path: string) => {
    if (!cellUid || !path.trim()) return;
    setIngestState('attaching');
    setIngestError(null);
    try {
      const client = await getMcpClient();
      await renderApi.ingest_external(client, {
        cell_id: cellUid,
        file_path: path.trim(),
        engine: platform,
      });
      await refetchStoryboard();
      await refreshRenders();
      setIngestState('idle');
      setFilePath('');
    } catch (err) {
      setIngestState('error');
      setIngestError((err as Error).message);
    }
  }, [cellUid, platform, refetchStoryboard, refreshRenders]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
    if (!file) return;
    // Some webview/Electron-style hosts expose an absolute filesystem path on
    // the dropped File; the browser File API otherwise never does. Fall back
    // to letting the filmmaker paste the path rather than guessing.
    if (file.path) {
      void doIngest(file.path);
    } else {
      setFilePath(file.name);
    }
  }, [doIngest]);

  // ── guard states ──

  if (!project) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-base text-fg" data-workspace="studio">
        <EmptyState glyph="⇄" title="No project open" hint="handoff needs an open project">
          <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-faint">
            Open a project from the Launcher, then come back here to hand a shot off to an
            external tool.
          </p>
        </EmptyState>
      </div>
    );
  }

  if (!hasRealCells) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-base text-fg" data-workspace="studio">
        <EmptyState glyph="⇄" title="Handoff needs a real project" hint="standalone / demo mode has no shots to hand off">
          <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-faint">
            This view shapes a prompt package from real cell + anchor data — it has nothing
            honest to show against the demo fixture. Open a real project to use it.
          </p>
        </EmptyState>
      </div>
    );
  }

  if (hydratedCells.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-base text-fg" data-workspace="studio">
        <EmptyState glyph="▤" title="No cells yet" hint="the storyboard is written for you, not by hand">
          <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-faint">
            Ask your Chi in the chat dock to storyboard this project, then come back to hand
            a shot off to an external tool.
          </p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-base text-fg" data-workspace="studio">
      {/* ═══ top bar ═══ */}
      <div className="flex flex-none items-center justify-between border-b border-soft bg-surface px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-fg-faint">
            <b className="font-medium text-fg-muted">{project.name}</b> / handoff
            {cell ? ` / ${cell.uid}` : ''}
          </span>
          <h1 className="font-display text-[20px] font-medium tracking-tight text-fg">Handoff</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!prevUid}
            onClick={() => prevUid && setCellUid(prevUid)}
            className="rounded border border-soft px-2.5 py-1.5 font-mono text-[11px] text-fg-faint transition-colors hover:border-[var(--fg-faint)] hover:text-fg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← {prevUid ?? 'start'}
          </button>
          <button
            type="button"
            disabled={!nextUid}
            onClick={() => nextUid && setCellUid(nextUid)}
            className="rounded border border-soft px-2.5 py-1.5 font-mono text-[11px] text-fg-faint transition-colors hover:border-[var(--fg-faint)] hover:text-fg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {nextUid ?? 'end'} →
          </button>
          <button
            type="button"
            onClick={backToBoard}
            className="rounded border border-soft bg-raised px-3 py-1.5 text-[12.5px] font-medium text-fg-muted transition-colors hover:text-fg"
          >
            Back to board
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_1px_1fr]">
        {/* ═══ left: shot context rail ═══ */}
        <div className="flex min-w-0 flex-col overflow-y-auto bg-sunken">
          <div className="flex flex-none items-center justify-between border-b border-soft px-5 py-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Shot in handoff</span>
            <span className="font-mono text-[11px] text-fg-faint">Track B</span>
          </div>

          {!cell ? (
            <div className="p-5">
              <p className="text-[11.5px] leading-relaxed text-fg-muted">
                Pick a shot from the board below to prepare its handoff package.
              </p>
            </div>
          ) : (
            <>
              <div className="border-b border-soft px-5 py-4">
                <div className="mb-2 flex items-center gap-2 font-mono text-[12px] text-fg-muted">
                  {cell.uid}
                  <span className="rounded-sm border border-soft px-1.5 py-0.5 font-mono text-[9.5px] tracking-wider text-fg-faint">
                    {shotLabel(cell.shot_type)}
                  </span>
                </div>
                <p className="mb-1.5 font-display text-[17px] font-medium leading-snug text-fg">
                  {cell.label || cell.uid}
                </p>
                <p className="text-[12.5px] leading-relaxed text-fg-muted">
                  {cell.action || cell.prompt || 'No shot description yet.'}
                </p>
              </div>

              <div className="mx-5 mt-4 flex h-[110px] items-end rounded border border-soft bg-sunken px-3 py-2.5">
                <span className="font-mono text-[10px] text-fg-faint">
                  {anchorsInFrame[0]?.name ?? cell.label} — ref still
                </span>
              </div>

              <div className="border-b border-soft px-5 py-4">
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Anchors in frame</span>
                <div className="mt-2 flex flex-col gap-2">
                  {anchorsInFrame.length === 0 ? (
                    <span className="text-[11px] text-fg-faint">No anchors on this cell.</span>
                  ) : (
                    anchorsInFrame.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between rounded border border-[var(--border)] bg-raised px-2.5 py-2"
                      >
                        <div>
                          <div className="text-[11.5px] font-medium text-fg">{a.name}</div>
                          <div className="font-mono text-[9px] uppercase tracking-wider text-fg-faint">{a.kind}</div>
                        </div>
                        {typeof a.metadata?.seed === 'number' && (
                          <span className="font-mono text-[10px] text-fg-faint">{a.metadata.seed}</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          <div className="px-5 py-4">
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
              Board — {hydratedCells.length} shot{hydratedCells.length === 1 ? '' : 's'}
            </span>
            <div className="mt-2.5 flex flex-col gap-0.5">
              {hydratedCells.map((c) => {
                const rec = recordByUid.get(c.uid);
                const status = rec?.status === 'done'
                  ? (rec.metadata?.provenance === 'manual' ? 'ingested' : 'rendered')
                  : rec?.status ?? 'no render';
                const active = c.uid === cellUid;
                return (
                  <button
                    type="button"
                    key={c.uid}
                    onClick={() => setCellUid(c.uid)}
                    className="flex items-center gap-2.5 rounded px-2 py-1.5 text-left font-mono text-[11px] transition-colors"
                    style={{
                      background: active ? 'color-mix(in oklab, var(--achievement) 8%, transparent)' : 'transparent',
                      borderLeft: active ? '2px solid var(--achievement)' : '2px solid transparent',
                      color: active ? 'var(--fg)' : 'var(--fg-faint)',
                    }}
                  >
                    <span className="w-[54px] flex-none truncate">{c.uid}</span>
                    <span className="truncate">{shotLabel(c.shot_type)} {c.label}</span>
                    <span
                      className="ml-auto flex-none text-[9.5px]"
                      style={{
                        color:
                          status === 'rendered' ? 'var(--live)'
                          : status === 'ingested' ? 'var(--live)'
                          : status === 'running' || status === 'queued' ? 'var(--agent)'
                          : status === 'failed' ? 'var(--danger)'
                          : 'var(--fg-faint)',
                      }}
                    >
                      {status}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-border-soft" />

        {/* ═══ right: handoff workspace ═══ */}
        <div className="flex min-w-0 flex-col overflow-y-auto">
          {!cell ? (
            <div className="grid flex-1 place-items-center p-8">
              <EmptyState glyph="⇄" title="No shot selected" hint="pick a shot from the board on the left" />
            </div>
          ) : (
            <div className="flex flex-col gap-5 px-7 py-6">
              {/* step 1 */}
              <StepDivider n={1} label="Choose platform" />

              <div className="flex gap-2.5" role="radiogroup" aria-label="Handoff platform">
                {PLATFORMS.map((p) => {
                  const selected = p.id === platform;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPlatform(p.id)}
                      className="flex flex-1 flex-col gap-1 rounded border px-3.5 py-3 text-left transition-colors"
                      style={{
                        borderColor: selected ? 'var(--achievement)' : 'var(--border)',
                        background: selected ? 'color-mix(in oklab, var(--achievement) 5.5%, var(--bg-raised))' : 'var(--bg-raised)',
                      }}
                    >
                      <span className="font-display text-[14.5px] font-medium text-fg">{p.name}</span>
                      <span
                        className="font-mono text-[9.5px] tracking-wide"
                        style={{ color: selected ? 'var(--achievement)' : 'var(--fg-faint)' }}
                      >
                        {p.meta}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* prompt package preview */}
              <div className="overflow-hidden rounded-md border border-soft bg-surface">
                <div className="flex items-center justify-between border-b border-soft bg-raised px-4.5 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-sm border border-[var(--border)] bg-sunken px-2 py-1 font-mono text-[9.5px] uppercase tracking-wider text-fg">
                      Prompt package
                    </span>
                    <span className="font-mono text-[11px] text-fg-muted">
                      shaped for {PLATFORMS.find((p) => p.id === platform)?.name}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-fg-faint">{cell.uid} · {shotLabel(cell.shot_type)}</span>
                </div>

                {pkgState === 'loading' && (
                  <div className="px-4.5 py-8 text-center font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                    shaping prompt package…
                  </div>
                )}
                {pkgState === 'error' && (
                  <div className="px-4.5 py-6 text-[12px] text-fg-muted">
                    Couldn't shape a prompt package{pkgError ? ` — ${pkgError}` : '.'}
                  </div>
                )}
                {pkgState === 'ready' && entry && (
                  <>
                    <div className="grid grid-cols-[220px_1fr]">
                      <div className="flex flex-col gap-3 border-r border-soft p-4.5">
                        <div className="flex h-[124px] items-end rounded border border-soft bg-sunken px-2.5 py-2.5">
                          <span className="font-mono text-[9.5px] text-fg-faint">
                            {entry.ref_image_uri ? fileNameOf(entry.ref_image_uri) : 'no reference image'}
                          </span>
                        </div>
                        {entry.ref_note && (
                          entry.ref_image_uri ? (
                            // Resolved-but-local: a routine instruction (upload before
                            // generating), not a problem — muted hint, not a warning.
                            <span className="text-[9.5px] leading-relaxed text-fg-faint">
                              {entry.ref_note}
                            </span>
                          ) : (
                            // Unresolved ref (e.g. orphaned/deleted anchor asset): the
                            // shot silently degrades to text-to-video — this is real
                            // breakage, styled like Composition's silent-bed notice.
                            <div
                              role="status"
                              className="flex items-start gap-1.5 rounded px-2 py-1.5 text-[9.5px] leading-relaxed"
                              style={{
                                background: 'var(--beat-accent-amber-soft)',
                                border: '1px solid var(--beat-accent-amber-border)',
                                color: 'var(--fg)',
                              }}
                            >
                              <span aria-hidden="true" style={{ color: 'var(--beat-accent-amber)' }}>⚠</span>
                              <span>{entry.ref_note}</span>
                            </div>
                          )
                        )}
                        <div className="flex flex-col gap-1.5">
                          <SpecRow k="aspect" v={entry.aspect_ratio} />
                          <SpecRow k="duration" v={fmtSeconds(entry.duration_ms)} />
                          <SpecRow k="camera" v={shotLabel(entry.camera.shot_type)} />
                          {typeof cell.seed === 'number' && <SpecRow k="seed lock" v={String(cell.seed)} />}
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-col gap-2.5 p-4.5">
                        <span className="font-mono text-[9.5px] uppercase tracking-wider text-fg-faint">
                          Prompt text — copy as-is
                        </span>
                        <div className="whitespace-pre-wrap rounded border border-soft bg-sunken px-4 py-3.5 font-mono text-[12px] leading-relaxed text-fg">
                          {entry.prompt}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 border-t border-soft bg-raised px-4.5 py-3">
                      <button
                        type="button"
                        onClick={() => void copyPackage()}
                        className="rounded border px-3.5 py-2 text-[12.5px] font-semibold transition-colors"
                        style={{
                          borderColor: 'color-mix(in oklab, var(--achievement) 60%, transparent)',
                          background: 'color-mix(in oklab, var(--achievement) 70%, var(--bg-raised))',
                          color: 'var(--bg-sunken)',
                        }}
                      >
                        {copyState === 'copied' ? 'Copied ✓' : copyState === 'error' ? 'Copy failed' : 'Copy prompt package'}
                      </button>
                      <button
                        type="button"
                        onClick={exportJson}
                        className="rounded border border-[var(--border)] px-3.5 py-2 text-[12.5px] font-medium text-fg-muted transition-colors hover:text-fg"
                      >
                        Export .json
                      </button>
                      <div className="flex-1" />
                      <span className="font-mono text-[11px] text-fg-faint">
                        Paste into {PLATFORMS.find((p) => p.id === platform)?.name} → generate there → bring the clip back below
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* step 2 */}
              <StepDivider n={2} label="Bring it home" />

              <div className="overflow-hidden rounded-md border border-soft bg-surface">
                <div className="flex items-center justify-between border-b border-soft bg-raised px-4.5 py-3">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Ingest-back</span>
                  <span className="font-mono text-[11px] text-fg-faint">attaches to {cell.uid} as a render</span>
                </div>

                {attachedRecord?.status === 'done' && attachedIsManual ? (
                  <div className="mx-4.5 my-4.5 flex items-center gap-3 rounded border px-3.5 py-3" style={{
                    background: 'var(--live-soft)',
                    borderColor: 'color-mix(in oklab, var(--live) 40%, var(--border))',
                  }}>
                    <div className="h-[34px] w-[56px] flex-none rounded-sm border" style={{ background: 'var(--bg-sunken)', borderColor: 'color-mix(in oklab, var(--live) 40%, var(--border))' }} />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11.5px] text-fg">
                        {attachedRecord.output?.uri ? fileNameOf(attachedRecord.output.uri) : attachedRecord.id}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px]" style={{ color: 'var(--live)' }}>
                        <span className="h-[5px] w-[5px] rounded-full" style={{ background: 'var(--live)' }} />
                        manual · attached to {cell.uid} · {fmtRelative(attachedRecord.finished_at, Date.now())}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFilePath('')}
                      className="rounded border border-soft px-2.5 py-1.5 text-[11.5px] text-fg-muted hover:text-fg"
                    >
                      Replace
                    </button>
                  </div>
                ) : (
                  <>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="Drop the clip you generated here"
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                      className="m-4.5 flex flex-col items-center gap-2 rounded-md border-[1.5px] border-dashed px-5 py-8 text-center transition-colors"
                      style={{
                        borderColor: dragOver ? 'var(--live)' : 'var(--border)',
                        background: dragOver ? 'color-mix(in oklab, var(--live) 18%, transparent)' : undefined,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-[34px] w-[34px] items-center justify-center rounded-full border-[1.5px] text-[15px]"
                        style={{ borderColor: dragOver ? 'var(--live)' : 'var(--fg-faint)', color: dragOver ? 'var(--live)' : 'var(--fg-faint)' }}
                      >
                        ↓
                      </span>
                      <span className="text-[13px] text-fg-muted">Drop the clip you generated here</span>
                      <span className="font-mono text-[10.5px] text-fg-faint">
                        .mp4 / .mov — matched to {cell.uid} · manual provenance
                      </span>
                    </div>

                    <div className="mx-4.5 mb-4.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        value={filePath}
                        onChange={(e) => setFilePath(e.target.value)}
                        placeholder="/absolute/path/to/generated-clip.mp4"
                        className="min-w-0 flex-1 rounded border border-soft bg-sunken px-3 py-2 font-mono text-[11.5px] text-fg placeholder:text-fg-faint"
                      />
                      <button
                        type="button"
                        disabled={!filePath.trim() || ingestState === 'attaching'}
                        onClick={() => void doIngest(filePath)}
                        className="flex-none rounded border border-[var(--border)] bg-raised px-3.5 py-2 text-[12px] font-medium text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {ingestState === 'attaching' ? 'Attaching…' : 'Attach'}
                      </button>
                    </div>
                    {ingestState === 'error' && (
                      <div className="mx-4.5 mb-4.5 rounded px-3 py-2 text-[11.5px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                        Couldn't attach that clip{ingestError ? ` — ${ingestError}` : '.'}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ footer legend ═══ */}
      <div className="flex flex-none items-center gap-4.5 border-t border-soft bg-surface px-6 py-2.5">
        <LegendDot color="var(--agent)" label="Track A — Ikenga generates (fal)" />
        <LegendDot outline label="Track B — prompt handoff" />
        <LegendDot color="var(--live)" label="manual render · ingested" />
        <div className="flex-1" />
        <span className="text-[11px] text-fg-faint">
          Generate elsewhere → drop the clip → it lands on the board like any other render.
        </span>
      </div>
    </div>
  );
}

// ─── small helpers ─────────────────────────────────────────────────────

function StepDivider({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-soft text-[9.5px]">
          {n}
        </span>
        {label}
      </span>
      <div className="h-px flex-1 bg-border-soft" />
    </div>
  );
}

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between font-mono text-[10.5px] text-fg-faint">
      <span>{k}</span>
      <b className="font-medium text-fg-muted">{v}</b>
    </div>
  );
}

function LegendDot({ color, outline, label }: { color?: string; outline?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-fg-faint">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={outline ? { border: '1px solid var(--fg-faint)' } : { background: color }}
      />
      {label}
    </span>
  );
}
