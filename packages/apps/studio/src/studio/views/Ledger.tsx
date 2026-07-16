// com.ikenga.studio · Ledger view — the shot ledger / production desk
//
// Locked concept: ledger-a-production-desk.html (Dusk Wood, tokens-only).
// A provenance table over the REAL render records: per shot — engine,
// model_id, seed, cost, variant, status, finished-at — plus a running-total
// cost meter against a soft $20 budget cap, and an Export-master action.
//
// Data model: one row per storyboard CELL (not per record) so every shot in
// the ledger order is visible even before it has a render — a cell with no
// record yet reads honestly as "Not rendered" rather than a fabricated row.
// `recordByUid` (shared with Composition) picks the winning record per cell
// (done > running > queued, most-recent tiebreak); every OTHER record for
// that cell_uid is a rejected variant — retried-but-discarded fal spend,
// logged (dim, expandable) so it isn't silently lost from the budget math.
//
// Track A/B is inferred from the winning record's `engine` string (no schema
// field carries "track" — Higgsfield clips return via render.ingest_external,
// the manual-provenance leg of export.prompt_package). A cell with no record
// yet has an unknown track — shown as "—", never guessed.

import { Fragment, useEffect, useMemo, useState } from 'react';

import { useProjectStore, selectOpenProject } from '../project-store';
import {
  useStoryboardStore,
  selectHydratedCells,
  selectHasRealCells,
  selectRenderRecords,
  selectLastSyncedAt,
  selectStoryboardSource,
} from '../storyboard-store';
import { getMcpClient, anchorApi, renderApi, exportApi } from '../mcp-client';
import type { BedCheck } from '../mcp-client';
import type { Anchor, Cell, RenderRecord } from '../mcp-types';
import { pollExportUntilDone } from '../lib/render-poll';
import { recordByUid, fidelityLabel } from './composition/format';

const BUDGET_CAP_USD = 20;
const MUSIC_PRESET_DEFAULT = 'upbeat';

// ─── small pure helpers (local — Ledger-specific presentation) ────────────

type Track = 'a' | 'b';

function trackOf(engine: string | undefined): Track | null {
  if (!engine) return null;
  return engine.toLowerCase().includes('higgsfield') ? 'b' : 'a';
}

function costOf(r: RenderRecord | null | undefined): number | null {
  if (!r) return null;
  if (typeof r.cost_actual === 'number') return r.cost_actual;
  if (typeof r.cost_estimate === 'number') return r.cost_estimate;
  return null;
}

function fmtUsd(n: number | null): string {
  if (n === null) return '—';
  return `$${n.toFixed(2)}`;
}

function seedOf(r: RenderRecord | null | undefined, cell: Cell): number | null {
  const metaSeed = r?.metadata?.seed;
  if (typeof metaSeed === 'number') return metaSeed;
  if (typeof cell.seed === 'number') return cell.seed;
  return null;
}

function fmtFinishedAt(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour12: false });
  return `${date} · ${time}`;
}

function statusLabel(status: RenderRecord['status'] | undefined): string {
  if (status === 'done') return 'Rendered';
  if (status === 'running') return 'Rendering';
  if (status === 'queued') return 'Queued';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Not rendered';
}

function statusColorVar(status: RenderRecord['status'] | undefined): string {
  if (status === 'done') return 'var(--live)';
  if (status === 'running' || status === 'queued') return 'var(--achievement)';
  if (status === 'failed') return 'var(--danger)';
  if (status === 'cancelled') return 'var(--fg-faint)';
  return 'var(--info)';
}

interface LedgerRow {
  cell: Cell;
  primary: RenderRecord | null;
  variants: RenderRecord[];
  track: Track | null;
}

// ─── inline "attach externally-produced clip" form (Higgsfield handoff) ────

function AttachClipForm({
  onCancel,
  onSubmit,
  busy,
}: {
  onCancel: () => void;
  onSubmit: (args: { filePath: string; engine: string; cost: string }) => void;
  busy: boolean;
}) {
  const [filePath, setFilePath] = useState('');
  const [engine, setEngine] = useState('higgsfield');
  const [cost, setCost] = useState('');

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-soft bg-sunken p-2">
      <input
        type="text"
        value={filePath}
        onChange={(e) => setFilePath(e.target.value)}
        placeholder="/path/to/returned-clip.mp4"
        aria-label="Returned clip file path"
        className="min-w-0 flex-1 rounded border border-soft bg-base px-2 py-1 font-mono text-[11px] text-fg"
      />
      <input
        type="text"
        value={engine}
        onChange={(e) => setEngine(e.target.value)}
        placeholder="engine (e.g. higgsfield)"
        aria-label="Engine name for this clip"
        className="w-36 rounded border border-soft bg-base px-2 py-1 font-mono text-[11px] text-fg"
      />
      <input
        type="text"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        placeholder="cost (optional)"
        aria-label="Cost, if billed — leave blank for manual"
        className="w-28 rounded border border-soft bg-base px-2 py-1 font-mono text-[11px] text-fg"
      />
      <button
        type="button"
        className="rounded-md border border-soft bg-raised px-2 py-1 text-[11px] font-medium text-fg hover:bg-surface disabled:opacity-50"
        disabled={busy || !filePath.trim() || !engine.trim()}
        onClick={() => onSubmit({ filePath, engine, cost })}
      >
        {busy ? 'Attaching…' : 'Attach'}
      </button>
      <button
        type="button"
        className="rounded-md px-2 py-1 text-[11px] text-fg-muted hover:text-fg"
        onClick={onCancel}
        disabled={busy}
      >
        Cancel
      </button>
    </div>
  );
}

export function LedgerView() {
  const project = useProjectStore(selectOpenProject);
  const cells = useStoryboardStore(selectHydratedCells);
  const hasRealCells = useStoryboardStore(selectHasRealCells);
  const source = useStoryboardStore(selectStoryboardSource);
  const renderRecords = useStoryboardStore(selectRenderRecords);
  const lastSyncedAt = useStoryboardStore(selectLastSyncedAt);
  const loading = useStoryboardStore((s) => s.loading);
  const storyboardError = useStoryboardStore((s) => s.error);
  const refetchStoryboard = useStoryboardStore((s) => s.refetch);
  const refreshRenders = useStoryboardStore((s) => s.refreshRenders);
  const bumpActivePoll = useStoryboardStore((s) => s.bumpActivePoll);

  const [refreshing, setRefreshing] = useState(false);
  const [anchorsById, setAnchorsById] = useState<Record<string, Anchor>>({});
  const [bedCheck, setBedCheck] = useState<BedCheck | null>(null);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [attachingUid, setAttachingUid] = useState<string | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const [exportState, setExportState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Initial hydrate — cells/renders/anchors/bed-check on mount + project change
  // (poll-on-demand: the shell can't push cells/render change events into
  // this iframe, so a view is responsible for its own refresh-on-mount).
  useEffect(() => {
    void refetchStoryboard();
  }, [refetchStoryboard]);

  useEffect(() => {
    void refreshRenders();
  }, [refreshRenders]);

  useEffect(() => {
    if (!hasRealCells) return;
    let cancelled = false;
    (async () => {
      try {
        const client = await getMcpClient();
        const { anchors } = await anchorApi.list(client);
        if (cancelled) return;
        const byId: Record<string, Anchor> = {};
        for (const a of anchors ?? []) byId[a.id] = a;
        setAnchorsById(byId);
      } catch {
        // anchor names are a labeling nicety — fall back to raw ids on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasRealCells, project?.project_id]);

  useEffect(() => {
    if (!hasRealCells) {
      setBedCheck(null);
      return;
    }
    const projectId = project?.project_id;
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const client = await getMcpClient();
        const res = await exportApi.check_bed(client, { project_id: projectId, music_preset: MUSIC_PRESET_DEFAULT });
        if (!cancelled) setBedCheck(res);
      } catch {
        if (!cancelled) setBedCheck({ has_bed: false, will_be_silent: true, by_design: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasRealCells, project?.project_id]);

  // ─── row model ──────────────────────────────────────────────────────────

  const cellsSorted = useMemo(() => [...cells].sort((a, b) => a.index - b.index), [cells]);

  const recordsByCellAll = useMemo(() => {
    const m: Record<string, RenderRecord[]> = {};
    for (const r of renderRecords) {
      if (!r?.cell_uid) continue;
      (m[r.cell_uid] ??= []).push(r);
    }
    return m;
  }, [renderRecords]);

  const primaryByUid = useMemo(() => recordByUid(renderRecords), [renderRecords]);

  const rows = useMemo<LedgerRow[]>(
    () =>
      cellsSorted.map((cell) => {
        const primary = primaryByUid[cell.uid] ?? null;
        const all = recordsByCellAll[cell.uid] ?? [];
        const variants = all.filter((r) => r !== primary);
        return { cell, primary, variants, track: primary ? trackOf(primary.engine) : null };
      }),
    [cellsSorted, primaryByUid, recordsByCellAll],
  );

  // "used" = referenced by at least one cell in this storyboard, not merely present
  // in the project's anchor list — an anchor can be locked and unreferenced.
  const usedAnchors = useMemo(() => {
    const ids = new Set<string>();
    for (const { cell } of rows) for (const id of cell.anchors) ids.add(id);
    return [...ids].map((id) => ({ id, name: anchorsById[id]?.name ?? id }));
  }, [rows, anchorsById]);

  const trackARecords = useMemo(() => renderRecords.filter((r) => trackOf(r.engine) === 'a'), [renderRecords]);
  const totalCostUsd = useMemo(() => trackARecords.reduce((sum, r) => sum + (costOf(r) ?? 0), 0), [trackARecords]);
  const budgetPct = Math.min(100, Math.max(0, (totalCostUsd / BUDGET_CAP_USD) * 100));
  const overBudget = totalCostUsd > BUDGET_CAP_USD;

  const trackACount = rows.filter((r) => r.track === 'a').length;
  const trackBCount = rows.filter((r) => r.track === 'b').length;
  const doneCount = rows.filter((r) => r.primary?.status === 'done').length;
  const totalCount = rows.length;
  const fullyRendered = totalCount > 0 && doneCount === totalCount;
  const notDoneShots = rows.filter((r) => r.primary?.status !== 'done').map((r) => r.cell.beat_id || r.cell.uid);

  const showSilentNotice = Boolean(bedCheck?.will_be_silent && !bedCheck?.by_design);

  // ─── actions ────────────────────────────────────────────────────────────

  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([refetchStoryboard(), refreshRenders()]);
    } finally {
      setRefreshing(false);
    }
  };

  const onAttachClip = async (uid: string, args: { filePath: string; engine: string; cost: string }) => {
    setAttachBusy(true);
    setAttachError(null);
    try {
      const client = await getMcpClient();
      const parsedCost = args.cost.trim() === '' ? undefined : Number(args.cost);
      await renderApi.ingest_external(client, {
        project_id: project?.project_id,
        cell_id: uid,
        file_path: args.filePath,
        engine: args.engine,
        cost_actual: Number.isFinite(parsedCost) ? parsedCost : undefined,
      });
      bumpActivePoll();
      await Promise.all([refetchStoryboard(), refreshRenders()]);
      setAttachingUid(null);
    } catch (err) {
      setAttachError((err as Error).message);
    } finally {
      setAttachBusy(false);
    }
  };

  const onExportMaster = async () => {
    const projectId = project?.project_id;
    if (!projectId) return;
    setExportState('running');
    setExportError(null);
    try {
      const client = await getMcpClient();
      const { export_id, export_path } = await exportApi.compose(client, {
        project_id: projectId,
        music_preset: MUSIC_PRESET_DEFAULT,
      });
      bumpActivePoll();
      const rec = await pollExportUntilDone(client, export_id);
      if (rec?.status === 'failed') {
        setExportError('The export failed before finishing. Nothing was written to disk.');
        setExportState('error');
        return;
      }
      setExportPath(rec?.output_uri ?? export_path);
      setExportState('done');
    } catch (err) {
      setExportError((err as Error).message);
      setExportState('error');
    }
  };

  const onExportCsv = () => {
    const header = ['shot', 'index', 'track', 'engine', 'model_id', 'seed', 'cost_usd', 'variant', 'status', 'finished_at'];
    const lines = [header.join(',')];
    for (const { cell, primary, track } of rows) {
      const seed = seedOf(primary, cell);
      const cost = costOf(primary);
      const cells = [
        cell.beat_id || cell.uid,
        String(cell.index),
        track ?? '',
        primary?.engine ?? '',
        primary?.model_id ?? '',
        seed === null ? '' : String(seed),
        cost === null ? '' : cost.toFixed(2),
        primary?.variant ?? '',
        statusLabel(primary?.status),
        primary?.finished_at ?? '',
      ];
      lines.push(cells.map((v) => (v.includes(',') ? `"${v.replace(/"/g, '""')}"` : v)).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.name ?? 'ledger'}-shot-ledger.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── render ─────────────────────────────────────────────────────────────

  if (loading && rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-base p-8 text-center" data-workspace="studio">
        <span className="font-display text-sm text-fg-muted">Loading the ledger…</span>
      </div>
    );
  }

  if (storyboardError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-base p-8 text-center" data-workspace="studio">
        <span className="font-display text-sm" style={{ color: 'var(--danger)' }}>Couldn't load the ledger</span>
        <span className="font-mono text-[11px] text-fg-faint">{storyboardError}</span>
        <button type="button" className="mt-2 rounded-md border border-soft bg-raised px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface" onClick={() => void onRefresh()}>
          Retry
        </button>
      </div>
    );
  }

  if (!hasRealCells) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-base p-8 text-center" data-workspace="studio">
        <span className="font-display text-sm text-fg-muted">No render provenance yet</span>
        <span className="max-w-sm font-mono text-[10px] uppercase tracking-wider text-fg-faint">
          {source === 'mock'
            ? 'the ledger reads real render records — connect the real MCP server to see them'
            : 'render a cell to start the ledger — every generation is logged here as it happens'}
        </span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-base p-8 text-center" data-workspace="studio">
        <span className="font-display text-sm text-fg-muted">No shots yet</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">add cells to the storyboard to populate the ledger</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-base text-[13px] text-fg" data-workspace="studio">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-4 border-b border-soft bg-surface px-5 py-2.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="truncate font-display text-lg font-medium text-fg">{project?.name ?? 'Ledger'}</h1>
          <span className="shrink-0 border-l border-soft pl-3 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
            Shot ledger
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-fg-muted">
          <span className="rounded border border-soft bg-sunken px-1.5 py-0.5">{project?.aspect_ratio ?? '—'}</span>
          <span className="rounded border border-soft bg-sunken px-1.5 py-0.5">{totalCount} shots</span>
        </div>
        <div className="flex-1" />
        {lastSyncedAt && (
          <span className="font-mono text-[10px] text-fg-faint">
            synced {new Date(lastSyncedAt).toLocaleTimeString(undefined, { hour12: false })}
          </span>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-soft bg-raised px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface disabled:opacity-50"
          onClick={() => void onRefresh()}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </header>

      {/* ── Summary strip — the spreadsheet-killer ───────────────────── */}
      <div className="grid shrink-0 grid-cols-1 border-b border-soft bg-surface sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5 border-r border-soft/60 px-5 py-3.5 last:border-r-0">
          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--chip-carve)' }}>
            Running total
          </span>
          <span className="flex items-baseline gap-2 font-display text-2xl leading-none text-fg">
            {fmtUsd(totalCostUsd)}
            <span className="font-mono text-xs font-normal text-fg-muted">of ${BUDGET_CAP_USD.toFixed(2)}</span>
          </span>
          <div className="relative mt-0.5 h-2 overflow-hidden rounded-full border border-soft bg-sunken" aria-hidden="true">
            <div
              className="h-full rounded-full"
              style={{
                width: `${budgetPct}%`,
                background: `linear-gradient(90deg, var(--agent), color-mix(in srgb, var(--agent) 55%, var(--achievement)))`,
              }}
            />
          </div>
          <span className="text-[11px] text-fg-muted">
            Track A (fal) only{overBudget ? ' — over the soft cap' : ' — Track B costs are billed outside Ikenga'}
          </span>
        </div>

        <div className="flex flex-col gap-1.5 border-r border-soft/60 px-5 py-3.5 last:border-r-0">
          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--chip-carve)' }}>
            Provenance split
          </span>
          <div className="flex items-center gap-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="font-display text-xl leading-none" style={{ color: 'var(--agent)' }}>{trackACount}</span>
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-fg-faint">fal · Track A</span>
            </div>
            <div className="h-6 w-px bg-border-soft" />
            <div className="flex flex-col gap-0.5">
              <span className="font-display text-xl leading-none text-fg-muted">{trackBCount}</span>
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-fg-faint">Higgsfield · Track B</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-r border-soft/60 px-5 py-3.5 last:border-r-0">
          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--chip-carve)' }}>
            Ledger status
          </span>
          <span className="font-display text-xl leading-none text-fg">
            {doneCount} <span className="font-mono text-xs font-normal text-fg-muted">done of {totalCount}</span>
          </span>
          <span className="truncate text-[11px] text-fg-muted">
            {fullyRendered ? 'every shot has a finished render' : `${notDoneShots.slice(0, 2).join(', ')}${notDoneShots.length > 2 ? '…' : ''} not yet rendered`}
          </span>
        </div>

        <div className="flex flex-col gap-1.5 px-5 py-3.5">
          <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--chip-carve)' }}>
            Anchors used this ledger
          </span>
          <div className="flex flex-wrap gap-1">
            {usedAnchors.length === 0 ? (
              <span className="text-[11px] text-fg-faint">—</span>
            ) : (
              usedAnchors.map((a) => (
                <span key={a.id} className="rounded border border-soft bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                  {a.name}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Legend ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-4 border-b border-soft bg-base px-5 py-2 font-mono text-[9.5px] uppercase tracking-wider text-fg-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--agent)' }} />
          Track A · fal
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-fg-faint" />
          Track B · Higgsfield handoff
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--live)' }} />
          Rendered
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--info)' }} />
          Not rendered
        </span>
        <span className="flex-1" />
        <span className="normal-case italic tracking-normal text-fg-muted">
          Every row is a real generation record — seed, cost, and finish time as reported by the engine.
        </span>
      </div>

      {/* ── Ledger table ────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {['Shot', 'Anchors', 'Track', 'Engine / model', 'Seed', 'Cost', 'Variant', 'Status', 'Finished', ''].map((h, i) => (
                <th
                  key={h || i}
                  className={
                    'sticky top-0 z-10 whitespace-nowrap border-b border-soft bg-sunken px-3 py-2 text-left font-mono text-[9.5px] font-medium uppercase tracking-wider'
                    + (h === 'Seed' || h === 'Cost' ? ' text-right' : '')
                  }
                  style={{ color: 'var(--chip-carve)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cell, primary, variants, track }, i) => {
              const isTrackB = track === 'b';
              const seed = seedOf(primary, cell);
              const cost = costOf(primary);
              const anchorPills = cell.anchors.map((id) => anchorsById[id]?.name ?? id);
              const expanded = expandedUid === cell.uid;
              const attaching = attachingUid === cell.uid;
              return (
                <Fragment key={cell.uid}>
                  <tr
                    className="border-b border-soft/60 transition-colors hover:bg-raised/40"
                    style={
                      isTrackB
                        ? {
                            background:
                              'repeating-linear-gradient(135deg, color-mix(in srgb, var(--bg-raised) 45%, transparent) 0px, color-mix(in srgb, var(--bg-raised) 45%, transparent) 7px, transparent 7px, transparent 14px)',
                            boxShadow: 'inset 3px 0 0 var(--fg-faint)',
                          }
                        : track === 'a'
                          ? { background: 'color-mix(in srgb, var(--agent) 8%, transparent)' }
                          : undefined
                    }
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-6 w-2 shrink-0 rounded-sm"
                          style={{ background: track === 'a' ? 'var(--agent)' : track === 'b' ? 'var(--fg-faint)' : 'var(--border)' }}
                        />
                        <div className="min-w-0">
                          <span className="block font-mono text-[10px] text-fg-faint">
                            {cell.uid} · {i + 1} / {totalCount}
                          </span>
                          <span className="block truncate font-medium text-fg">{cell.label || cell.beat_id}</span>
                          <span className="block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                            {cell.shot_type.toUpperCase()} · {fidelityLabel(cell.rung)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {anchorPills.length === 0 ? (
                          <span className="text-fg-faint">—</span>
                        ) : (
                          anchorPills.map((name, idx) => (
                            <span key={idx} className="whitespace-nowrap rounded border border-soft bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                              {name}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {track === 'a' ? (
                        <span
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-medium"
                          style={{ color: 'var(--agent)', background: 'var(--agent-soft)', borderColor: 'color-mix(in srgb, var(--agent) 32%, transparent)' }}
                        >
                          fal
                        </span>
                      ) : track === 'b' ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-soft bg-sunken px-2 py-0.5 text-[10.5px] font-medium text-fg-muted">
                          Higgsfield
                        </span>
                      ) : (
                        <span className="text-fg-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {primary ? (
                        <>
                          <span className="block font-mono text-[11px] text-fg">{primary.engine}</span>
                          {primary.model_id && <span className="block font-mono text-[10px] text-fg-muted">{primary.model_id}</span>}
                        </>
                      ) : (
                        <span className="text-fg-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {seed === null ? (
                        <span className="font-mono text-[11px] italic text-fg-faint">{isTrackB ? '— manual —' : '—'}</span>
                      ) : (
                        <span className="font-mono text-[11.5px] text-fg">{seed}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {cost === null ? (
                        <span className="font-mono text-[12px] italic text-fg-faint">{isTrackB ? 'manual' : '—'}</span>
                      ) : (
                        <span className="font-mono text-[12px] font-medium text-fg">{fmtUsd(cost)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="whitespace-nowrap rounded border border-soft bg-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted">
                        {primary?.variant ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          color: statusColorVar(primary?.status),
                          background: `color-mix(in srgb, ${statusColorVar(primary?.status)} 16%, transparent)`,
                          borderColor: `color-mix(in srgb, ${statusColorVar(primary?.status)} 30%, transparent)`,
                        }}
                      >
                        {statusLabel(primary?.status)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[10.5px] text-fg-muted">
                      {primary?.finished_at ? (
                        fmtFinishedAt(primary.finished_at)
                      ) : (
                        <span className="italic text-fg-faint">not yet returned</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {variants.length > 0 && (
                          <button
                            type="button"
                            className="rounded p-1 text-[11px] text-fg-muted hover:bg-raised hover:text-fg"
                            aria-label={expanded ? `Hide discarded takes for ${cell.uid}` : `Show ${variants.length} discarded take${variants.length === 1 ? '' : 's'} for ${cell.uid}`}
                            aria-expanded={expanded}
                            onClick={() => setExpandedUid(expanded ? null : cell.uid)}
                          >
                            {expanded ? '▾' : '▸'} {variants.length}
                          </button>
                        )}
                        {!primary && (
                          <button
                            type="button"
                            className="rounded p-1 text-[11px] text-fg-muted hover:bg-raised hover:text-agent"
                            aria-label={`Attach a returned clip for ${cell.uid}`}
                            onClick={() => {
                              setAttachError(null);
                              setAttachingUid(attaching ? null : cell.uid);
                            }}
                          >
                            ⤓
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {attaching && (
                    <tr key={`${cell.uid}-attach`}>
                      <td colSpan={10} className="px-3 pb-2.5">
                        <AttachClipForm
                          busy={attachBusy}
                          onCancel={() => {
                            setAttachingUid(null);
                            setAttachError(null);
                          }}
                          onSubmit={(args) => void onAttachClip(cell.uid, args)}
                        />
                        {attachError && (
                          <p className="mt-1 font-mono text-[10.5px]" style={{ color: 'var(--danger)' }}>
                            {attachError}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}

                  {expanded &&
                    variants
                      .slice()
                      .sort((a, b) => (Date.parse(b.finished_at ?? b.started_at ?? '') || 0) - (Date.parse(a.finished_at ?? a.started_at ?? '') || 0))
                      .map((v) => {
                        const vCost = costOf(v);
                        const vSeed = seedOf(v, cell);
                        return (
                          <tr key={v.id} className="border-b border-soft/40 bg-sunken/40 text-fg-faint opacity-70">
                            <td className="px-3 py-1.5 pl-9 font-mono text-[10.5px] italic">discarded take</td>
                            <td className="px-3 py-1.5" />
                            <td className="px-3 py-1.5 font-mono text-[10px]">{trackOf(v.engine) === 'b' ? 'Higgsfield' : 'fal'}</td>
                            <td className="px-3 py-1.5 font-mono text-[10.5px]">{v.engine}{v.model_id ? ` · ${v.model_id}` : ''}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-[10.5px]">{vSeed ?? '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-[10.5px]">{fmtUsd(vCost)}</td>
                            <td className="px-3 py-1.5 font-mono text-[10.5px]">{v.variant}</td>
                            <td className="px-3 py-1.5 font-mono text-[10.5px]">{statusLabel(v.status)}</td>
                            <td className="px-3 py-1.5 font-mono text-[10.5px]">{fmtFinishedAt(v.finished_at)}</td>
                            <td className="px-3 py-1.5" />
                          </tr>
                        );
                      })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Export-master strip ─────────────────────────────────────── */}
      <footer className="flex shrink-0 flex-wrap items-center gap-4 border-t border-soft bg-surface px-5 py-3.5">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-sm font-medium text-fg">Export master</h2>
          <p className="text-[11px] text-fg-muted">
            Composes all {totalCount} shots in ledger order · {doneCount} rendered
            {totalCount - doneCount > 0 ? ` · ${totalCount - doneCount} not yet ready` : ''}
          </p>
        </div>

        {showSilentNotice && (
          <div
            role="status"
            className="flex items-center gap-2 rounded px-2.5 py-2 text-[11.5px]"
            style={{
              background: 'var(--achievement-soft)',
              border: '1px solid color-mix(in srgb, var(--achievement) 34%, var(--border))',
              color: 'color-mix(in srgb, var(--achievement) 62%, var(--fg))',
            }}
          >
            <span aria-hidden="true">⚠</span>
            <span>
              No audio bed set — export will be <strong>video-only (silent)</strong>.
            </span>
          </div>
        )}

        {exportState === 'done' && exportPath && (
          <span className="font-mono text-[11px]" style={{ color: 'var(--live)' }}>
            ✓ exported → {exportPath}
          </span>
        )}
        {exportState === 'error' && exportError && (
          <span className="font-mono text-[11px]" style={{ color: 'var(--danger)' }}>
            {exportError}
          </span>
        )}

        <div className="flex-1" />

        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-soft bg-raised px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface"
          onClick={onExportCsv}
        >
          Export ledger (CSV)
        </button>

        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ background: 'var(--primary)', color: 'var(--primary-fg)' }}
          disabled={!fullyRendered || exportState === 'running'}
          title={fullyRendered ? undefined : `${notDoneShots.length} shot${notDoneShots.length === 1 ? '' : 's'} not ready`}
          onClick={() => void onExportMaster()}
          aria-busy={exportState === 'running'}
        >
          {exportState === 'running' ? 'Exporting…' : `Export master (${doneCount} / ${totalCount} ready)`}
        </button>
      </footer>
    </div>
  );
}
