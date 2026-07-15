// com.ikenga.studio · Canvas view
//
// Beat × rung storyboard. Mounts @ikenga/contract/canvas (WP-07 commit 16 —
// G-CANVAS: the local stub is gone, this is the real extracted home-page
// Canvas). Reads REAL cells hydrated from disk (storyboard.read) when a real
// project is open, else the __mocks__/cells.ts fixture for standalone dev.
// Reads `cellUid` from the shared store for selection and writes back on every
// selection change, which lights up click-to-focus cross-linking across panes.
//
// Wave 4 — Canvas truth:
//   • Tiles show REAL per-cell render status (storyboard-store renderStatus,
//     kept fresh by the adaptive poll) — a tick/tint for rendered cells, a
//     pulsing beacon while rendering, honest neutral when un-rendered. No fake
//     "cell.html" placeholder, no fabricated %.
//   • Add / delete cells via the real storyboard.create_cell / delete_cell MCP
//     seams (behind a focus-trapped confirm for delete).
//   • Interactive zoom controls (+/−/Fit buttons, keyboard +/-/0) wired to the
//     canvas pan/zoom model; the raw pan/scale debug HUD is gone.
//
// Visual contract: designs/canvas.html. Role-mapped tokens only (--live for the
// emerald/rendered role, --info for the in-flight role — per the design
// contract's beat-accent mapping), no raw hex fallbacks.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  Canvas,
  type CanvasHandle,
  type ItemId,
  type ItemRenderState,
  type Placement,
  type Viewport,
} from '@ikenga/contract/canvas';
import '@ikenga/contract/canvas/canvas.css';
import {
  selectCellUid,
  selectHoverBeat,
  selectPlayheadMs,
  useSharedStore,
} from '../shared-state';
import { useProjectStore, selectOpenProject } from '../project-store';
import {
  useStoryboardStore,
  selectHydratedCells,
  selectHasRealCells,
  selectHydratedProject,
  selectRenderStatus,
  selectRenderRecords,
  toDisplayCell,
} from '../storyboard-store';
import { useLayoutStore } from '../layout-store';
import {
  getMcpClient,
  storyboardApi,
  compositionApi,
  renderApi,
  anchorApi,
  exportApi,
} from '../mcp-client';
import { SafeZoneBands } from '../media-controls';
import type {
  Anchor,
  AspectRatio,
  Cell,
  PromptPlatform,
  RenderRecord,
  RenderStatus,
  Rung,
} from '../mcp-types';
import { rungDir } from '../mcp-types';
import {
  MOCK_CELLS,
  type CellColor,
  type MockCell,
} from '../__mocks__/cells';
import { COMPOSITION_TIMELINE } from '../__mocks__/composition';
import { buildTimelineModel, clipAt } from '../lib/composition-model';
import { EmptyState } from '../components/EmptyState';

// @ikenga/contract/canvas ships `ItemId` as an opaque branded string but does
// not export a helper to brand one — consumers mint their own ids from
// already-typed sources. This is the same one-line cast the stub had.
const asItemId = (s: string): ItemId => s as ItemId;

const COLUMN_X = (col: number) => col * 200;
const CELL_W = 176; // ~w-44 in the design
const CELL_H = 132; // 96 thumb + ~36 footer
// hi-fi cells carry the per-shot generation card (engine picker / generate /
// status / anchors / approve-reject) — a real cell needs more room than the
// plain lofi/beat-sheet tile. Row gutters below are sized off this.
const HIFI_CELL_H = 292;
const ROW_GAP = 48;
const ROW_Y: Record<Rung, number> = {
  '2_hifi':       0,
  '1_lofi':       HIFI_CELL_H + ROW_GAP,
  '0_beat_sheet': HIFI_CELL_H + ROW_GAP + CELL_H + ROW_GAP,
};

// Bias each beat to its own column so the storyboard reads left→right per rung.
function columnsByBeat(cells: MockCell[]): Record<string, number> {
  const map: Record<string, number> = {};
  let col = 0;
  for (const c of cells) if (!(c.beat in map)) map[c.beat] = col++;
  return map;
}

// ─── Rung labels — also canvas items so they pan with the cells ─────────

interface RungLabel {
  kind: 'rung-label';
  id: string;
  text: string;
  rung: Rung;
}

const RUNG_LABELS: RungLabel[] = [
  { kind: 'rung-label', id: 'gutter-2_hifi',       text: 'hi-fi',      rung: '2_hifi'       },
  { kind: 'rung-label', id: 'gutter-1_lofi',       text: 'lo-fi',      rung: '1_lofi'       },
  { kind: 'rung-label', id: 'gutter-0_beat_sheet', text: 'beat sheet', rung: '0_beat_sheet' },
];

// ─── Item discriminator for the Canvas generic ──────────────────────────

type Item =
  | (MockCell & { kind: 'cell' })
  | RungLabel;

const isCell = (item: Item): item is MockCell & { kind: 'cell' } => item.kind === 'cell';

// ─── Per-color thumb tint (role-mapped tokens; no raw hex) ──────────────

const THUMB_TINT: Record<CellColor, string> = {
  amber:   'bg-[color-mix(in_oklab,var(--achievement)_18%,var(--bg-raised))]',
  rose:    'bg-[color-mix(in_oklab,var(--danger)_18%,var(--bg-raised))]',
  emerald: 'bg-[color-mix(in_oklab,var(--live)_18%,var(--bg-raised))]',
  sky:     'bg-[color-mix(in_oklab,var(--info)_18%,var(--bg-raised))]',
  violet:  'bg-[color-mix(in_oklab,var(--agent)_18%,var(--bg-raised))]',
  neutral: 'bg-raised',
};

// ─── Render-status → honest tile state ──────────────────────────────────

type TileState = 'rendered' | 'rendering' | 'queued' | 'failed' | 'cancelled' | 'none';

function tileStateFor(status: RenderStatus | undefined): TileState {
  switch (status) {
    case 'done':      return 'rendered';
    case 'running':   return 'rendering';
    case 'queued':    return 'queued';
    case 'failed':    return 'failed';
    case 'cancelled': return 'cancelled';
    default:          return 'none';
  }
}

/** label + role token per tile state — colours resolve under data-theme="A". */
const TILE_STATUS: Record<TileState, { label: string; varName: string }> = {
  rendered:  { label: 'rendered',     varName: '--live' },
  rendering: { label: 'rendering',    varName: '--info' },
  queued:    { label: 'queued',       varName: '--fg-muted' },
  failed:    { label: 'failed',       varName: '--danger' },
  cancelled: { label: 'cancelled',    varName: '--fg-faint' },
  none:      { label: 'not rendered', varName: '--fg-faint' },
};

function rungLabel(rung: Rung): string {
  if (rung === '2_hifi') return 'hi-fi';
  if (rung === '1_lofi') return 'lo-fi';
  return 'beat sheet';
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return `${s % 1 === 0 ? s.toFixed(0) : s.toFixed(1)}s`;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'beat';
const rnd = () => Math.random().toString(36).slice(2, 8);

// Project.aspect_ratio → the inner thumb frame's box style.
function aspectFrameStyle(aspect: AspectRatio): React.CSSProperties {
  if (aspect === '9:16') return { height: '100%', aspectRatio: '9 / 16' };
  if (aspect === '1:1') return { height: '100%', aspectRatio: '1 / 1' };
  return { width: '100%', height: '100%' };
}

// ─── Focus-trapped modal (add / delete confirm) ─────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const focusables = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((f) => f.offsetParent !== null);
    (focusables()[0] ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portal to <body> so the app-level pane focus-trap doesn't fight this one
  // (the pane trap treats in-pane focusables as its own; body-level escapes it).
  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-sunken)_82%,transparent)] p-4"
      onMouseDown={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-soft bg-surface p-4 text-fg shadow-xl outline-none"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ─── View ───────────────────────────────────────────────────────────────

export function CanvasView() {
  const selectedCellUid = useSharedStore(selectCellUid);
  const hoverBeat = useSharedStore(selectHoverBeat);
  const playheadMs = useSharedStore(selectPlayheadMs);
  const setCellUid = useSharedStore((s) => s.setCellUid);
  const setHoverBeat = useSharedStore((s) => s.setHoverBeat);

  const project = useProjectStore(selectOpenProject);
  const aspect: AspectRatio = project?.aspect_ratio ?? '16:9';
  const isPortrait = aspect === '9:16';

  const [viewport, setViewport] = useState<Viewport>({ x: 80, y: 30, scale: 0.9 });
  const [editMode, setEditMode] = useState(false);

  // add/delete cell + error UI
  const [addOpen, setAddOpen] = useState(false);
  const [newBeat, setNewBeat] = useState('');
  const [newRung, setNewRung] = useState<Rung>('0_beat_sheet');
  const [confirmDelete, setConfirmDelete] = useState<{ uid: string; beat: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cell source: REAL cells hydrated from disk when a real project is open,
  // else the __mocks__/cells.ts fixture for standalone-dev / mock mode.
  const hydratedCells = useStoryboardStore(selectHydratedCells);
  const hasRealCells = useStoryboardStore(selectHasRealCells);
  const projectDoc = useStoryboardStore(selectHydratedProject);
  const renderStatusMap = useStoryboardStore(selectRenderStatus);
  const renderRecords = useStoryboardStore(selectRenderRecords);
  const refreshRenders = useStoryboardStore((s) => s.refreshRenders);
  const bumpActivePoll = useStoryboardStore((s) => s.bumpActivePoll);
  const refetchStoryboard = useStoryboardStore((s) => s.refetch);
  const displayCells = useMemo<MockCell[]>(
    () => (hasRealCells ? hydratedCells.map(toDisplayCell) : MOCK_CELLS),
    [hasRealCells, hydratedCells],
  );

  // Real per-cell durations (schema field) — surfaced as an honest thumb detail.
  const durationByUid = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of hydratedCells) if (c.duration_ms) m[c.uid] = c.duration_ms;
    return m;
  }, [hydratedCells]);

  // Cross-linking §12 — Composition scrub → playheadMs → Canvas active highlight.
  const scrubClips = useMemo(
    () => (hasRealCells ? buildTimelineModel(hydratedCells, projectDoc, {}).clips : COMPOSITION_TIMELINE),
    [hasRealCells, hydratedCells, projectDoc],
  );
  const activeAtPlayheadUid = clipAt(scrubClips, playheadMs)?.uid ?? null;

  useEffect(() => { void refetchStoryboard(); }, [refetchStoryboard]);

  // ── per-shot generation (hi-fi cells only) ──────────────────────────────
  // Anchors resolve id → name/kind for the shot tile's ref chips. Best-effort:
  // an unreachable anchor.list just leaves chips showing the raw id.
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await getMcpClient();
        const { anchors: list } = await anchorApi.list(client);
        if (!cancelled) setAnchors(list ?? []);
      } catch {
        // anchor.list unreachable — chips fall back to the raw anchor id.
      }
    })();
    return () => { cancelled = true; };
  }, [project?.project_id]);
  const anchorById = useMemo(() => {
    const m: Record<string, Anchor> = {};
    for (const a of anchors) m[a.id] = a;
    return m;
  }, [anchors]);

  // Latest render record per cell — for the cost/error/model readout. Prefers
  // the record whose status matches the folded renderStatus (the canonical
  // one per foldRenderStatus's active-wins rule); falls back to the last seen.
  const recordByUid = useMemo(() => {
    const m: Record<string, RenderRecord> = {};
    for (const r of renderRecords) {
      if (!r || typeof r.cell_uid !== 'string' || !r.cell_uid) continue;
      const prev = m[r.cell_uid];
      if (!prev || r.status === renderStatusMap[r.cell_uid]) m[r.cell_uid] = r;
    }
    return m;
  }, [renderRecords, renderStatusMap]);
  const totalSpend = useMemo(
    () => Object.values(recordByUid).reduce((sum, r) => sum + (r.cost_actual ?? r.cost_estimate ?? 0), 0),
    [recordByUid],
  );
  const fmtCost = (n: number) => `$${n.toFixed(2)}`;

  // Per-cell engine choice — Track A (fal, direct API render) vs Track B
  // (handoff — no API, prompt-package + ingest_external round trip). UI-local:
  // it isn't a persisted Cell field, just which generation path the Generate
  // button takes.
  const FAL_MODELS = ['ltx-video', 'flux', 'flux-i2v'] as const;
  const HANDOFF_PLATFORMS: PromptPlatform[] = ['higgsfield', 'flow', 'veo', 'generic'];
  interface GenChoice { mode: 'fal' | 'handoff'; model: string; platform: PromptPlatform; }
  const DEFAULT_GEN_CHOICE: GenChoice = { mode: 'fal', model: FAL_MODELS[0], platform: 'higgsfield' };
  const [genChoice, setGenChoiceMap] = useState<Record<string, GenChoice>>({});
  const [genBusy, setGenBusy] = useState<Record<string, boolean>>({});
  const [genError, setGenErrorMap] = useState<Record<string, string>>({});
  const [dropPath, setDropPath] = useState<Record<string, string>>({});
  const [copiedUid, setCopiedUid] = useState<string | null>(null);

  const choiceFor = (uid: string): GenChoice => genChoice[uid] ?? DEFAULT_GEN_CHOICE;
  const patchChoice = (uid: string, patch: Partial<GenChoice>) =>
    setGenChoiceMap((prev) => ({ ...prev, [uid]: { ...choiceFor(uid), ...patch } }));
  const setGenErrorFor = (uid: string, message: string | null) =>
    setGenErrorMap((prev) => {
      const next = { ...prev };
      if (message) next[uid] = message;
      else delete next[uid];
      return next;
    });

  async function generateShot(uid: string) {
    if (genBusy[uid]) return;
    setGenBusy((prev) => ({ ...prev, [uid]: true }));
    setGenErrorFor(uid, null);
    try {
      const client = await getMcpClient();
      await compositionApi.render(client, {
        project_id: project?.project_id ?? '',
        cell_uid: uid,
        engine: 'fal',
      });
      bumpActivePoll();
      await Promise.all([refetchStoryboard(), refreshRenders()]);
    } catch (err) {
      setGenErrorFor(uid, `Generate failed — ${(err as Error).message}`);
    } finally {
      setGenBusy((prev) => ({ ...prev, [uid]: false }));
    }
  }

  async function cancelShot(uid: string) {
    const recordId = recordByUid[uid]?.id;
    if (!recordId) return;
    try {
      const client = await getMcpClient();
      await renderApi.cancel(client, recordId);
      await refreshRenders();
    } catch (err) {
      setGenErrorFor(uid, `Cancel failed — ${(err as Error).message}`);
    }
  }

  async function setApproval(uid: string, approved: boolean) {
    try {
      const client = await getMcpClient();
      await storyboardApi.set_approved(client, uid, approved);
      await refetchStoryboard();
    } catch (err) {
      setGenErrorFor(uid, `Couldn't ${approved ? 'approve' : 'reject'} — ${(err as Error).message}`);
    }
  }

  async function copyPromptPackage(uid: string, platform: PromptPlatform) {
    try {
      const client = await getMcpClient();
      const pkg = await exportApi.prompt_package(client, { cell_id: uid, platform });
      const entry = pkg.packages.find((p) => p.cellId === uid) ?? pkg.packages[0];
      if (entry && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(entry.prompt);
      }
      setCopiedUid(uid);
      window.setTimeout(() => setCopiedUid((u) => (u === uid ? null : u)), 2000);
    } catch (err) {
      setGenErrorFor(uid, `Couldn't build the prompt package — ${(err as Error).message}`);
    }
  }

  async function dropClip(uid: string, platform: PromptPlatform) {
    const path = (dropPath[uid] ?? '').trim();
    if (!path || genBusy[uid]) return;
    setGenBusy((prev) => ({ ...prev, [uid]: true }));
    setGenErrorFor(uid, null);
    try {
      const client = await getMcpClient();
      await renderApi.ingest_external(client, { cell_id: uid, file_path: path, engine: platform });
      await Promise.all([refetchStoryboard(), refreshRenders()]);
      setDropPath((prev) => ({ ...prev, [uid]: '' }));
    } catch (err) {
      setGenErrorFor(uid, `Couldn't attach the clip — ${(err as Error).message}`);
    } finally {
      setGenBusy((prev) => ({ ...prev, [uid]: false }));
    }
  }

  const items = useMemo<Item[]>(() => {
    const cells: Item[] = displayCells.map((c) => ({ ...c, kind: 'cell' as const }));
    return [...RUNG_LABELS, ...cells];
  }, [displayCells]);

  const [layout, setLayout] = useState<Record<ItemId, Placement>>({});
  useEffect(() => {
    const colByBeat = columnsByBeat(displayCells);
    const map: Record<ItemId, Placement> = {};
    for (const c of displayCells) {
      map[asItemId(c.uid)] = {
        x: COLUMN_X(colByBeat[c.beat] ?? 0),
        y: ROW_Y[c.rung],
        w: CELL_W,
        h: c.rung === '2_hifi' ? HIFI_CELL_H : CELL_H,
      };
    }
    for (const l of RUNG_LABELS) {
      map[asItemId(l.id)] = { x: -70, y: ROW_Y[l.rung] + 60, w: 60, h: 14 };
    }
    setLayout(map);
  }, [displayCells]);

  const canvasRef = useRef<CanvasHandle | null>(null);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const selectedId: ItemId | null =
    selectedCellUid ? asItemId(selectedCellUid) : null;

  // ── zoom controls, wired to the canvas primitive's own pan/zoom model ──
  // The primitive is uncontrolled for pan/zoom (it owns internal state and only
  // notifies via onViewportChange); its keyboard handler zooms when the canvas
  // root holds focus. So the +/− buttons focus that root and replay the native
  // zoom keydown — driving the real model rather than a parallel one.
  const canvasRootEl = (): HTMLElement | null =>
    stageWrapRef.current?.querySelector<HTMLElement>('.ikenga-canvas') ?? null;
  const nudgeZoom = (dir: 'in' | 'out') => {
    const root = canvasRootEl();
    if (!root) return;
    root.focus();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: dir === 'in' ? 'Equal' : 'Minus', bubbles: true }),
    );
  };
  const fitView = () => canvasRef.current?.autoFit(true);

  // Keyboard 0 / f → fit (native +/- zoom is handled by the primitive on
  // canvas-root focus). Guarded to real key presses inside the canvas surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.isTrusted) return;
      const wrap = stageWrapRef.current;
      const active = document.activeElement as HTMLElement | null;
      if (!wrap || !active || !wrap.contains(active)) return;
      if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) return;
      if (e.key === '0' || e.key === 'f' || e.key === 'F') {
        canvasRef.current?.autoFit(true);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function createCell() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const label = newBeat.trim() || 'new beat';
    const beatId = `${slugify(label)}-${rnd()}`;
    const uid = `${beatId}-${rnd()}`;
    // Minimal valid Cell — the sidecar's CellSchema.parse fills the remaining
    // defaults (shot_type, renderer, approved, …). Cast because the inferred
    // Cell type lists those defaulted fields as present.
    const cell = {
      uid,
      beat_id: beatId,
      rung: newRung,
      index: displayCells.length,
      label,
      time: { start: 0, end: 0 },
      frames: { start: 0, end: 0 },
      content_path: `cells/${rungDir(newRung)}/${uid}/content.html`,
      rungs: {
        '0_beat_sheet': { status: 'pending' },
        '1_lofi': { status: 'pending' },
        '2_hifi': { status: 'pending' },
      },
      last_edited: new Date().toISOString(),
    } as unknown as Cell;
    try {
      const client = await getMcpClient();
      await storyboardApi.create_cell(client, cell);
      await refetchStoryboard();
      setCellUid(uid);
      // Open the new cell in the focused pane's Cell view.
      const { focusedPane, setPaneView } = useLayoutStore.getState();
      setPaneView(focusedPane, 'cell');
      setAddOpen(false);
      setNewBeat('');
      setNewRung('0_beat_sheet');
    } catch (err) {
      setError(`Couldn't create the cell — ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCell(uid: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const client = await getMcpClient();
      await storyboardApi.delete_cell(client, uid);
      if (selectedCellUid === uid) setCellUid(null);
      await refetchStoryboard();
      setConfirmDelete(null);
    } catch (err) {
      setError(`Couldn't delete the cell — ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // Empty-project state — before any cells materialize from an archetype chain.
  if (displayCells.length === 0) {
    return (
      <EmptyState
        glyph="▦"
        title="No cells yet"
        hint="cells materialize from an archetype chain — beatsheet → lofi → hifi"
      >
        <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-faint">
          The agent can scaffold the full grid via chat — try{' '}
          <span className="font-mono text-fg-muted">"storyboard a 30s explainer"</span>.
        </p>
      </EmptyState>
    );
  }

  // Per-shot generation card — rendered for a real hi-fi cell (`item.raw`
  // present, see MockCell.raw doc). Plain closure fn (not a component) so it
  // shares every handler/selector declared above without re-plumbing props.
  function renderShotCard(
    item: MockCell & { kind: 'cell' },
    raw: Cell,
    state: ItemRenderState,
    tstate: TileState,
    sMeta: { label: string; varName: string },
    dur: number | undefined,
  ) {
    const choice = choiceFor(item.uid);
    const record = recordByUid[item.uid];
    const busy = genBusy[item.uid] ?? false;
    const shotError = genError[item.uid];
    const isTrackA = choice.mode === 'fal';
    const hoverLinked = hoverBeat === item.uid;
    const scrubActive = !state.isSelected && activeAtPlayheadUid === item.uid;
    const cost =
      record?.cost_actual != null
        ? fmtCost(record.cost_actual)
        : record?.cost_estimate != null
          ? `est. ${fmtCost(record.cost_estimate)}`
          : isTrackA
            ? '—'
            : 'no fal cost';
    const failedReason = tstate === 'failed' ? (record?.error ?? shotError) : undefined;

    const openInCellView = () => {
      setCellUid(item.uid);
      const { focusedPane, setPaneView } = useLayoutStore.getState();
      setPaneView(focusedPane, 'cell');
    };

    return (
      <div
        role="button"
        tabIndex={state.isSelected ? 0 : -1}
        onMouseEnter={() => setHoverBeat(item.uid)}
        onMouseLeave={() => setHoverBeat(null)}
        onClick={() => setCellUid(item.uid)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCellUid(item.uid);
          }
        }}
        className={[
          'cell-card group relative flex flex-col overflow-y-auto rounded-md text-left transition-shadow',
          'border border-[var(--border)] bg-surface hover:shadow-lg',
          state.isSelected
            ? 'outline-2 outline outline-offset-2 outline-[var(--achievement)]'
            : scrubActive
              ? 'outline-2 outline outline-offset-2 outline-[var(--info)]'
              : '',
          state.isEditMode
            ? 'ring-1 ring-dashed ring-[color-mix(in_oklab,var(--achievement)_50%,transparent)]'
            : '',
          hoverLinked ? ' is-hover-link' : '',
        ].join(' ')}
        style={{ height: HIFI_CELL_H, borderTop: `2px solid var(${isTrackA ? '--agent' : '--fg-faint'})` }}
      >
        {/* delete (hover / focus revealed) — real storyboard.delete_cell */}
        <button
          type="button"
          aria-label={`Delete cell ${item.beat}`}
          title="Delete cell"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setError(null);
            setConfirmDelete({ uid: item.uid, beat: item.beat });
          }}
          className="absolute right-1 top-1 z-10 hidden h-5 w-5 items-center justify-center rounded border border-[var(--border)] bg-surface text-[11px] leading-none text-fg-faint hover:border-[var(--danger)] hover:text-[var(--danger)] group-hover:flex focus-visible:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--danger)_45%,transparent)]"
        >
          <span aria-hidden>✕</span>
        </button>

        {/* header — index / uid / shot type */}
        <div className="flex items-center justify-between gap-1 border-b border-soft px-2 py-1">
          <span className="font-mono text-[9px] text-fg-faint">{String(raw.index + 1).padStart(2, '0')}</span>
          <span className="truncate font-mono text-[9.5px] text-fg-muted">{item.uid}</span>
          <span className="rounded border border-soft bg-raised px-1 font-mono text-[9px] uppercase text-fg-muted">
            {raw.shot_type}
          </span>
        </div>

        {/* status thumb */}
        <div className="relative flex h-12 items-center justify-center border-b border-soft bg-sunken">
          <span
            className="flex items-center gap-1 font-mono text-[9px]"
            style={{ color: `var(${sMeta.varName})` }}
          >
            {tstate === 'rendered' ? (
              <span aria-hidden>✓</span>
            ) : (
              <span
                className={'h-1.5 w-1.5 rounded-full' + (tstate === 'rendering' ? ' animate-pulse' : '')}
                style={{ background: `var(${sMeta.varName})` }}
              />
            )}
            {sMeta.label}
          </span>
          {dur != null && <span className="ml-1 font-mono text-[8px] text-fg-faint">{fmtDuration(dur)}</span>}
        </div>

        {/* beat + approved + prompt preview */}
        <div className="px-2 pt-1">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-[11px] font-medium text-fg">{item.beat}</span>
            {raw.approved && (
              <span aria-label="approved" className="font-mono text-[10px] text-[var(--live)]">
                ✓
              </span>
            )}
          </div>
          {raw.prompt && (
            <p className="mt-0.5 truncate text-[10px] text-fg-muted" title={raw.prompt}>
              {raw.prompt}
            </p>
          )}
        </div>

        {/* anchor-ref chips */}
        {raw.anchors.length > 0 && (
          <div className="flex flex-wrap gap-1 px-2 pt-1">
            {raw.anchors.map((aid) => {
              const a = anchorById[aid];
              const dotVar =
                a?.kind === 'character' ? '--agent' : a?.kind === 'location' ? '--info' : '--fg-faint';
              return (
                <span
                  key={aid}
                  className="flex items-center gap-1 rounded-full border border-soft bg-raised px-1.5 py-px font-mono text-[9px] text-fg-muted"
                  title={aid}
                >
                  <span className="h-1 w-1 rounded-full" style={{ background: `var(${dotVar})` }} />
                  {a?.name ?? aid}
                </span>
              );
            })}
          </div>
        )}

        {/* engine picker — Track A (fal, direct render) vs Track B (handoff, no API) */}
        <div className="mt-1 flex items-center gap-1 px-2">
          <select
            value={choice.mode}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => patchChoice(item.uid, { mode: e.target.value as GenChoice['mode'] })}
            className="rounded border border-soft bg-raised px-1 py-0.5 font-mono text-[9.5px] text-fg"
            aria-label="Generation path"
          >
            <option value="fal">fal</option>
            <option value="handoff">handoff</option>
          </select>
          {isTrackA ? (
            <select
              value={choice.model}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => patchChoice(item.uid, { model: e.target.value })}
              className="min-w-0 flex-1 rounded border border-soft bg-raised px-1 py-0.5 font-mono text-[9.5px] text-fg"
              aria-label="fal model"
            >
              {FAL_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <select
              value={choice.platform}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => patchChoice(item.uid, { platform: e.target.value as PromptPlatform })}
              className="min-w-0 flex-1 rounded border border-soft bg-raised px-1 py-0.5 font-mono text-[9.5px] text-fg"
              aria-label="Handoff platform"
            >
              {HANDOFF_PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
        </div>

        {/* actions */}
        <div className="mt-1 flex flex-col gap-1 px-2">
          {isTrackA ? (
            tstate === 'rendering' ? (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); void cancelShot(item.uid); }}
                className="rounded border border-soft bg-raised px-2 py-1 text-[10px] text-fg hover:bg-sunken"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); void generateShot(item.uid); }}
                className={[
                  'rounded px-2 py-1 text-[10px] font-medium disabled:opacity-50',
                  tstate === 'rendered' || tstate === 'failed'
                    ? 'border border-soft bg-raised text-fg hover:bg-sunken'
                    : 'bg-[var(--achievement)] text-[var(--bg-base)]',
                ].join(' ')}
              >
                {busy
                  ? 'Queuing…'
                  : tstate === 'rendered'
                    ? 'Regenerate'
                    : tstate === 'failed'
                      ? 'Retry'
                      : 'Generate'}
              </button>
            )
          ) : (
            <>
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); void copyPromptPackage(item.uid, choice.platform); }}
                className="rounded border border-soft bg-raised px-2 py-1 text-[10px] text-fg hover:bg-sunken"
              >
                {copiedUid === item.uid ? 'Copied ✓' : 'Copy prompt package'}
              </button>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={dropPath[item.uid] ?? ''}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDropPath((prev) => ({ ...prev, [item.uid]: e.target.value }))}
                  placeholder="returned clip path…"
                  className="min-w-0 flex-1 rounded border border-soft bg-sunken px-1.5 py-1 font-mono text-[9.5px] text-fg outline-none focus:border-[var(--info)]"
                />
                <button
                  type="button"
                  disabled={busy || !(dropPath[item.uid] ?? '').trim()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); void dropClip(item.uid, choice.platform); }}
                  className="shrink-0 rounded border border-soft bg-raised px-2 py-1 text-[10px] text-fg hover:bg-sunken disabled:opacity-50"
                >
                  Attach
                </button>
              </div>
            </>
          )}
        </div>

        {/* approve / reject */}
        <div className="mt-1 flex gap-1 px-2">
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); void setApproval(item.uid, true); }}
            className={[
              'flex-1 rounded border px-2 py-0.5 text-[10px]',
              raw.approved
                ? 'border-[var(--live)] bg-[color-mix(in_oklab,var(--live)_16%,var(--bg-raised))] text-[var(--live)]'
                : 'border-soft bg-raised text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            Approve
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); void setApproval(item.uid, false); }}
            className="flex-1 rounded border border-soft bg-raised px-2 py-0.5 text-[10px] text-fg-muted hover:text-[var(--danger)]"
          >
            Reject
          </button>
        </div>

        {/* status row — dot/label + cost */}
        <div className="mt-1 flex items-center justify-between px-2 pb-1 font-mono text-[9.5px] text-fg-muted">
          <span style={{ color: `var(${sMeta.varName})` }}>{sMeta.label}</span>
          <span>{cost}</span>
        </div>

        {/* seed-lock footer note */}
        {raw.seed != null && (
          <div className="px-2 pb-1 font-mono text-[9px] text-fg-faint">seed locked · {raw.seed}</div>
        )}

        {/* failed reason + retry / edit prompt */}
        {failedReason && (
          <div className="mx-2 mb-1.5 rounded border border-dashed border-[var(--danger)] bg-[color-mix(in_oklab,var(--danger)_10%,var(--bg-sunken))] px-1.5 py-1 text-[10px] text-[var(--danger)]">
            <p className="truncate" title={failedReason}>{failedReason}</p>
            <div className="mt-1 flex gap-1">
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); void generateShot(item.uid); }}
                className="rounded border border-[var(--danger)] px-1.5 py-0.5 text-[9.5px] text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_18%,transparent)]"
              >
                Retry
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); openInCellView(); }}
                className="rounded border border-soft px-1.5 py-0.5 text-[9.5px] text-fg-muted hover:text-fg"
              >
                Edit prompt
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-base text-fg">
      {/* Top chrome — folder path + archetype chip + viewport/add actions. */}
      <div className="ikenga-canvas-bar flex items-center justify-between gap-2 border-b border-soft bg-sunken px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-2 text-fg-muted">
          <span className="font-mono">{project?.name ? `~/${project.name}/` : '~/Projects/'}</span>
          <span className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--achievement)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--achievement)_40%,transparent)]">
            studio
          </span>
          <span className="text-fg-faint">·</span>
          <span className="text-fg-faint">archetype</span>
          <span className="font-mono text-fg">{project?.archetype_id ?? '—'}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 font-mono text-[10px] text-fg-muted">
            spend <span className="text-[var(--achievement)]">{fmtCost(totalSpend)}</span>
          </span>
          <span className="mx-0.5 h-4 w-px bg-[var(--border-soft)]" aria-hidden />
          <button
            type="button"
            onClick={() => nudgeZoom('out')}
            aria-label="Zoom out"
            title="Zoom out (−)"
            className="rounded px-1.5 py-1 font-mono text-fg-muted hover:bg-raised hover:text-fg"
          >
            −
          </button>
          <span
            className="min-w-[3.5ch] text-center font-mono text-[10px] tabular-nums text-fg-muted"
            title="Zoom level"
          >
            {Math.round(viewport.scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => nudgeZoom('in')}
            aria-label="Zoom in"
            title="Zoom in (+)"
            className="rounded px-1.5 py-1 font-mono text-fg-muted hover:bg-raised hover:text-fg"
          >
            +
          </button>
          <button
            type="button"
            onClick={fitView}
            title="Fit all cells (0)"
            className="rounded px-2 py-1 text-fg-muted hover:bg-raised hover:text-fg"
          >
            Fit
          </button>
          <span className="mx-0.5 h-4 w-px bg-[var(--border-soft)]" aria-hidden />
          <button
            type="button"
            onClick={() => { setError(null); setAddOpen(true); }}
            className="rounded px-2 py-1 text-fg-muted hover:bg-raised hover:text-fg"
          >
            + New cell
          </button>
          <button
            type="button"
            onClick={() => setEditMode((m) => !m)}
            className={
              'rounded px-2 py-1 ' +
              (editMode
                ? 'bg-[color-mix(in_oklab,var(--achievement)_20%,transparent)] text-[var(--achievement)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--achievement)_40%,transparent)]'
                : 'text-fg-muted hover:bg-raised hover:text-fg')
            }
          >
            {editMode ? 'Editing layout' : 'Edit layout'}
          </button>
        </div>
      </div>

      {/* Error banner — real MCP create/delete failures surface here. */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b border-[var(--beat-accent-rose-border,var(--danger))] bg-[color-mix(in_oklab,var(--danger)_12%,var(--bg-sunken))] px-3 py-1.5 text-[11px] text-[var(--danger)]"
        >
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="rounded px-1.5 py-0.5 text-fg-muted hover:bg-raised hover:text-fg"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Canvas stage */}
      <div ref={stageWrapRef} className="relative min-h-0 flex-1">
        <Canvas<Item>
          ref={canvasRef}
          items={items}
          itemId={(item) => asItemId(isCell(item) ? item.uid : item.id)}
          itemKind={(item) => (isCell(item) ? 'cell' : 'rung-label')}
          layout={layout}
          viewport={viewport}
          editMode={editMode}
          selectedId={selectedId}
          gridSnap={24}
          autoFitOnResize={false}
          onViewportChange={setViewport}
          onLayoutChange={setLayout}
          onEditModeChange={setEditMode}
          onSelectionChange={(id) => {
            if (id === null) {
              setCellUid(null);
              return;
            }
            const item = items.find((it) => (isCell(it) ? it.uid : it.id) === id);
            if (!item || !isCell(item)) return;
            setCellUid(item.uid);
          }}
          renderItem={(item, state) => {
            if (!isCell(item)) {
              return (
                <div className="pointer-events-none font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                  {item.text}
                </div>
              );
            }
            const tint = THUMB_TINT[item.color];
            // Real render status (adaptive poll) drives the tile; mock mode
            // keeps the fixture's numeric progress bar.
            const tstate: TileState = hasRealCells
              ? tileStateFor(renderStatusMap[item.uid])
              : item.progress != null && item.progress < 1
                ? 'rendering'
                : 'none';
            const sMeta = TILE_STATUS[tstate];
            const mockProgress =
              !hasRealCells && item.progress != null && item.progress < 1 ? item.progress : null;
            const dur = durationByUid[item.uid];

            // Real hi-fi cells get the per-shot generation card (engine picker,
            // Generate/Regenerate/Cancel, approve/reject, anchor chips, spend).
            // Lofi/beat-sheet cells and mock-fixture rows (no `raw`) keep the
            // plain tile below — there's no authored prompt/anchors/seed to back
            // a generation surface for those.
            if (item.rung === '2_hifi' && item.raw) {
              return renderShotCard(item, item.raw, state, tstate, sMeta, dur);
            }

            const hoverLinked = hoverBeat === item.uid;
            const scrubActive = !state.isSelected && activeAtPlayheadUid === item.uid;
            return (
              <div
                role="button"
                tabIndex={state.isSelected ? 0 : -1}
                onMouseEnter={() => setHoverBeat(item.uid)}
                onMouseLeave={() => setHoverBeat(null)}
                onClick={() => setCellUid(item.uid)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setCellUid(item.uid);
                  }
                }}
                className={[
                  'cell-card group relative rounded-md text-left transition-shadow',
                  'border border-[var(--border)] bg-surface hover:shadow-lg',
                  state.isSelected
                    ? 'outline-2 outline outline-offset-2 outline-[var(--achievement)]'
                    : scrubActive
                      ? 'outline-2 outline outline-offset-2 outline-[var(--info)]'
                      : '',
                  state.isEditMode
                    ? 'ring-1 ring-dashed ring-[color-mix(in_oklab,var(--achievement)_50%,transparent)]'
                    : '',
                  hoverLinked ? ' is-hover-link' : '',
                ].join(' ')}
                style={{ height: CELL_H }}
              >
                {/* delete (hover / focus revealed) — real storyboard.delete_cell */}
                <button
                  type="button"
                  aria-label={`Delete cell ${item.beat}`}
                  title="Delete cell"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setError(null);
                    setConfirmDelete({ uid: item.uid, beat: item.beat });
                  }}
                  className="absolute right-1 top-1 z-10 hidden h-5 w-5 items-center justify-center rounded border border-[var(--border)] bg-surface text-[11px] leading-none text-fg-faint hover:border-[var(--danger)] hover:text-[var(--danger)] group-hover:flex focus-visible:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--danger)_45%,transparent)]"
                >
                  <span aria-hidden>✕</span>
                </button>

                <div className="relative flex h-24 items-center justify-center overflow-hidden rounded-t-md border-b border-[var(--border)] bg-sunken">
                  {/* aspect-framed honest card — rung + render status + duration.
                      No poster seam yet, so no image thumbnail is faked. */}
                  <div
                    className={[
                      'relative flex items-center justify-center overflow-hidden',
                      isPortrait ? 'rounded-sm' : '',
                      tint,
                    ].join(' ')}
                    style={aspectFrameStyle(aspect)}
                  >
                    <div className="flex flex-col items-center justify-center gap-1 px-1 text-center">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                        {rungLabel(item.rung)}
                      </span>
                      <span
                        className="flex items-center gap-1 font-mono text-[9px]"
                        style={{ color: `var(${sMeta.varName})` }}
                      >
                        {tstate === 'rendered' ? (
                          <span aria-hidden>✓</span>
                        ) : (
                          <span
                            className={
                              'h-1.5 w-1.5 rounded-full' + (tstate === 'rendering' ? ' animate-pulse' : '')
                            }
                            style={{ background: `var(${sMeta.varName})` }}
                          />
                        )}
                        {sMeta.label}
                      </span>
                      {dur != null && (
                        <span className="font-mono text-[8px] text-fg-faint">{fmtDuration(dur)}</span>
                      )}
                    </div>
                    {isPortrait && <SafeZoneBands />}
                    {mockProgress != null && (
                      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--bg-sunken)]">
                        <div
                          className="h-full bg-[var(--info)]"
                          style={{ width: `${mockProgress * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {mockProgress != null && (
                    <div className="absolute right-1.5 top-1.5 flex items-center gap-1 font-mono text-[9px] text-[var(--info)]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--info)]" />
                      {Math.round(mockProgress * 100)}%
                    </div>
                  )}
                  {isPortrait && (
                    <span className="absolute left-1 top-1 rounded border border-[var(--beat-accent-sky-border)] bg-[var(--beat-accent-sky-soft)] px-1 py-px font-mono text-[7px] uppercase tracking-wider text-[var(--info)]">
                      9:16
                    </span>
                  )}
                </div>
                <div className="px-2 py-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] font-medium text-fg">{item.beat}</span>
                    {item.approved && (
                      <span aria-label="approved" className="font-mono text-[10px] text-[var(--live)]">
                        ✓
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-fg-faint">{item.uid}</div>
                </div>
              </div>
            );
          }}
        />
      </div>

      {/* New cell dialog */}
      {addOpen && (
        <Modal title="New cell" onClose={() => setAddOpen(false)}>
          <h2 className="font-display text-sm font-semibold">New cell</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
            Adds an empty cell to the storyboard at the chosen rung, then opens it in the Cell view.
          </p>
          <label className="mt-3 block text-[11px] text-fg-muted">
            Beat label
            <input
              type="text"
              value={newBeat}
              onChange={(e) => setNewBeat(e.target.value)}
              placeholder="e.g. hook"
              className="mt-1 w-full rounded border border-soft bg-sunken px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-[var(--info)]"
            />
          </label>
          <label className="mt-3 block text-[11px] text-fg-muted">
            Rung
            <select
              value={newRung}
              onChange={(e) => setNewRung(e.target.value as Rung)}
              className="mt-1 w-full rounded border border-soft bg-sunken px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-[var(--info)]"
            >
              <option value="0_beat_sheet">beat sheet</option>
              <option value="1_lofi">lo-fi</option>
              <option value="2_hifi">hi-fi</option>
            </select>
          </label>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="rounded px-2.5 py-1 text-[11px] text-fg-muted hover:bg-raised hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void createCell()}
              className="rounded bg-[color-mix(in_oklab,var(--achievement)_22%,transparent)] px-2.5 py-1 text-[11px] text-[var(--achievement)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--achievement)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--achievement)_30%,transparent)] disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create cell'}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <Modal title="Delete cell" onClose={() => setConfirmDelete(null)}>
          <h2 className="font-display text-sm font-semibold">Delete this cell?</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
            <span className="font-mono text-fg">{confirmDelete.beat}</span>{' '}
            <span className="font-mono text-fg-faint">({confirmDelete.uid})</span> will be removed
            from the storyboard. Its render files on disk are left in place.
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="rounded px-2.5 py-1 text-[11px] text-fg-muted hover:bg-raised hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteCell(confirmDelete.uid)}
              className="rounded bg-[color-mix(in_oklab,var(--danger)_18%,transparent)] px-2.5 py-1 text-[11px] text-[var(--danger)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--danger)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--danger)_26%,transparent)] disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete cell'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
