// com.ikenga.studio · Cast & World view — anchor library / continuity threads
//
// Concept: designs/redesign-ai/cast-world-c-novel.html ("the lookbook, not
// the file list"). Every project-level Anchor (character/location/style/
// prop) gets one row: a seed-locked plate card + a horizontal continuity
// THREAD showing every cell it's wired into, so drift is caught by looking,
// not by memory. This is the anti-drift surface for multi-shot narrative
// work (per-anchor seed-locking is what keeps "Adaora" looking like Adaora
// across six separate generations).
//
// REAL seams (no fixture in real mode):
//   • Anchors        — anchor.list. Kind filter + generate bar are real.
//   • Threads        — derived client-side: Cell.anchors[] (Anchor.id[] on
//                       every cell, per @ikenga/studio-schema) tells us which
//                       cells reference which anchor; storyboard-store's
//                       polled render.list records (recordByUid-style, best
//                       record per cell) tell us whether that shot is
//                       rendered / still pending / a Higgsfield handoff.
//   • Generate        — anchor.generate (fal reference-plate still). Only
//                       the 4 kinds the sidecar's fal path supports
//                       (character/location/style/image) are offered.
//   • Regenerate      — there is no anchor.update RPC — only
//                       list/create/generate/delete. A fresh plate always
//                       mints a NEW anchor id (sidecars/project/src/
//                       anchors.ts `generate()` → `randomUUID()`), which
//                       would silently orphan every cell.anchors[] reference
//                       that pointed at the old id — exactly the kind of
//                       drift this surface exists to prevent. So "Regenerate"
//                       re-creates the anchor UNDER ITS ORIGINAL ID: generate
//                       a fresh plate (new id), delete both the old record
//                       and the fresh one, then `create()` the fresh asset's
//                       fields back under the original id. Slower (4 round
//                       trips) but it's the only path that doesn't strand
//                       existing shot references.
//   • Lock / unlock   — same no-update constraint. Toggling
//                       `metadata.locked` (and, for an unseeded anchor,
//                       minting a seed to lock in) goes through the same
//                       delete → create(under the same id) pattern.
//   • "Open in storyboard" — this view doesn't own routing (a later wiring
//                       stage owns menu/routes), but it DOES own one of the
//                       four cross-pane shared values: setting `cellUid`
//                       here means whichever pane the user switches to next
//                       (Canvas/Cell) opens already focused on that shot.
//
// Standalone/mock mode (no real project) shows "The Forge" — the fixture
// narrative used across this redesign wave (Adaora / The Workshop /
// Ember-noir / Iron mask) — clearly read-only; every mutation controls are
// disabled rather than pretending to write into a fixture with nothing to
// persist to.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useProjectStore, selectOpenProject } from '../project-store';
import {
  useStoryboardStore,
  selectHydratedCells,
  selectHasRealCells,
  selectRenderRecords,
} from '../storyboard-store';
import { useSharedStore } from '../shared-state';
import { getMcpClient, anchorApi } from '../mcp-client';
import { recordByUid, engineLabel } from './composition/format';
import type { Anchor, Cell, ShotType } from '../mcp-types';
import { EmptyState } from '../components/EmptyState';

// ─── kind metadata (badge label + token color) ───────────────────────────

type GenerateKind = 'character' | 'location' | 'style' | 'image';
const GENERATE_KINDS: GenerateKind[] = ['character', 'location', 'style', 'image'];

const KIND_META: Record<Anchor['kind'], { label: string; colorVar: string; filterLabel: string }> = {
  character: { label: 'Character',    colorVar: '--primary',     filterLabel: 'Character' },
  location:  { label: 'Location',     colorVar: '--live',        filterLabel: 'Location' },
  style:     { label: 'Style',        colorVar: '--info',        filterLabel: 'Style' },
  image:     { label: 'Prop / Image', colorVar: '--achievement', filterLabel: 'Prop' },
  video:     { label: 'Video',        colorVar: '--agent',       filterLabel: 'Video' },
  audio:     { label: 'Audio',        colorVar: '--agent',       filterLabel: 'Audio' },
  sketch:    { label: 'Sketch',       colorVar: '--fg-muted',    filterLabel: 'Sketch' },
};

function kindTint(kind: Anchor['kind'], pct: number): string {
  return `color-mix(in oklab, var(${KIND_META[kind].colorVar}) ${pct}%, transparent)`;
}

const SHOT_LABEL: Record<ShotType, string> = {
  ews: 'EWS', ws: 'WS', ls: 'LS', fs: 'FS', ms: 'MS', cu: 'CU', ecu: 'ECU',
  ots: 'OTS', pov: 'POV', insert: 'INS', aerial: 'AER', unset: '—',
};

// Render engines with no generation API — a prompt package is handed off and
// the clip returns later via render.ingest_external (export.prompt_package's
// PromptPlatform union). Anything else came back through a real generation
// call (fal, hyperframes, remotion, …) — "Track A" in the footnote.
const HANDOFF_ENGINES = new Set(['higgsfield', 'flow', 'veo', 'generic']);

// ─── unified row shape (real hydrated OR "The Forge" fixture) ────────────

interface ThreadNode {
  cellUid: string;
  shot: string;
  label: string;
  isHandoff: boolean;
  rendered: boolean;
  failed: boolean;
  trackLabel: string;
}

interface DisplayAnchor {
  id: string;
  name: string;
  kind: Anchor['kind'];
  description: string;
  seed?: number;
  locked: boolean;
  thumbUri?: string;
  usedSummary: string;
  totalCells: number;
  nodes: ThreadNode[];
  raw?: Anchor; // present only in real mode — mutation handlers need it
}

function buildRealAnchors(anchors: Anchor[], cells: Cell[]): DisplayAnchor[] {
  const byUid = recordByUid(useStoryboardStore.getState().renderRecords);
  return anchors.map((a) => {
    const used = cells.filter((c) => c.anchors?.includes(a.id));
    const nodes: ThreadNode[] = used.map((c) => {
      const rec = byUid[c.uid];
      const isHandoff = !!rec && HANDOFF_ENGINES.has(rec.engine);
      const rendered = rec?.status === 'done';
      const failed = rec?.status === 'failed' || rec?.status === 'cancelled';
      const trackLabel = !rec
        ? 'not yet shot'
        : isHandoff
          ? `${engineLabel(rec.engine)} handoff`
          : `${engineLabel(rec.engine)}${rec.model_id ? ` · ${rec.model_id}` : ''}`;
      return {
        cellUid: c.uid,
        shot: SHOT_LABEL[c.shot_type] ?? '—',
        label: c.action || c.camera_text || c.label || c.uid,
        isHandoff,
        rendered,
        failed,
        trackLabel,
      };
    });
    const seed = typeof a.metadata?.seed === 'number' ? (a.metadata.seed as number) : undefined;
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      description: typeof a.metadata?.prompt === 'string' ? (a.metadata.prompt as string) : '',
      seed,
      locked: a.metadata?.locked === true,
      thumbUri: a.asset?.uri,
      usedSummary: used.length === 0 ? 'not used yet' : used.map((c) => c.uid).join(', '),
      totalCells: cells.length,
      nodes,
      raw: a,
    };
  });
}

// ─── "The Forge" fixture (standalone/mock — read-only demo) ──────────────

const FORGE_FIXTURE: DisplayAnchor[] = [
  {
    id: 'anc-adaora', name: 'Adaora', kind: 'character',
    description: 'Young West African blacksmith, soot-marked, leather apron, firelit.',
    seed: 44821, locked: true, totalCells: 6,
    usedSummary: 'sc1_sh2, sc1_sh4, sc1_sh6',
    nodes: [
      { cellUid: 'sc1_sh2', shot: 'MS', label: 'at anvil, hammer raised', isHandoff: false, rendered: true, failed: false, trackLabel: 'fal · ltx-video' },
      { cellUid: 'sc1_sh4', shot: 'CU', label: 'hammer strikes, sparks', isHandoff: true, rendered: true, failed: false, trackLabel: 'Higgsfield handoff' },
      { cellUid: 'sc1_sh6', shot: 'MS', label: 'steps back, mask glows', isHandoff: false, rendered: true, failed: false, trackLabel: 'fal · ltx-video' },
    ],
  },
  {
    id: 'anc-workshop', name: 'The Workshop', kind: 'location',
    description: 'Dim ironworking workshop at night, glowing forge, embers.',
    seed: 90310, locked: true, totalCells: 6,
    usedSummary: 'sc1_sh1, sc1_sh2, sc1_sh3, sc1_sh6',
    nodes: [
      { cellUid: 'sc1_sh1', shot: 'WS', label: 'forge glowing, push-in', isHandoff: false, rendered: true, failed: false, trackLabel: 'fal · ltx-video' },
      { cellUid: 'sc1_sh2', shot: 'MS', label: 'Adaora at anvil', isHandoff: false, rendered: true, failed: false, trackLabel: 'fal · ltx-video' },
      { cellUid: 'sc1_sh3', shot: 'ECU', label: 'mask half-formed', isHandoff: false, rendered: true, failed: false, trackLabel: 'fal · flux→i2v' },
      { cellUid: 'sc1_sh6', shot: 'MS', label: 'Adaora steps back', isHandoff: false, rendered: true, failed: false, trackLabel: 'fal · ltx-video' },
    ],
  },
  {
    id: 'anc-ember-noir', name: 'Ember-noir', kind: 'style',
    description: 'Warm orange key against deep shadow, cinematic, shallow DoF.',
    seed: 10577, locked: false, totalCells: 6,
    usedSummary: 'all of Scene 1',
    nodes: [
      { cellUid: 'sc1_sh1', shot: 'WS', label: 'forge glowing', isHandoff: false, rendered: true, failed: false, trackLabel: 'fal · ltx-video' },
      { cellUid: 'sc1_sh2', shot: 'MS', label: 'anvil, firelight', isHandoff: false, rendered: true, failed: false, trackLabel: 'fal · ltx-video' },
      { cellUid: 'sc1_sh3', shot: 'ECU', label: 'mask, sparks', isHandoff: false, rendered: true, failed: false, trackLabel: 'fal · flux→i2v' },
      { cellUid: 'sc1_sh4', shot: 'CU', label: 'hammer strikes', isHandoff: true, rendered: true, failed: false, trackLabel: 'Higgsfield handoff' },
      { cellUid: 'sc1_sh5', shot: 'ECU', label: 'eyes catch light', isHandoff: false, rendered: false, failed: false, trackLabel: 'not yet shot' },
      { cellUid: 'sc1_sh6', shot: 'MS', label: 'mask glowing between', isHandoff: false, rendered: true, failed: false, trackLabel: 'fal · ltx-video' },
    ],
  },
  {
    id: 'anc-iron-mask', name: 'Iron mask', kind: 'image',
    description: 'The object being forged — half-formed, then whole, then alive.',
    seed: undefined, locked: false, totalCells: 6,
    usedSummary: 'sc1_sh3, sc1_sh5',
    nodes: [
      { cellUid: 'sc1_sh3', shot: 'ECU', label: 'half-formed, slow tilt', isHandoff: false, rendered: true, failed: false, trackLabel: 'fal · flux→i2v' },
      { cellUid: 'sc1_sh5', shot: 'ECU', label: 'eyes catch firelight', isHandoff: false, rendered: false, failed: false, trackLabel: 'not yet shot' },
    ],
  },
];

// ─── thumbnail (real asset when it's a directly-renderable URI, else a
//     labeled sunken block — the srcdoc sandbox can't fetch file:// bytes) ──

function AnchorThumb({ anchor }: { anchor: DisplayAnchor }) {
  const [broken, setBroken] = useState(false);
  const showImg = !broken && !!anchor.thumbUri && /^(https?:|data:)/.test(anchor.thumbUri);
  return (
    <div
      className="relative flex h-[118px] items-end overflow-hidden rounded-lg border border-soft p-2"
      style={{
        background: showImg
          ? 'var(--bg-sunken)'
          : `radial-gradient(ellipse 140% 90% at 30% 110%, ${kindTint(anchor.kind, 45)}, transparent 65%), var(--bg-sunken)`,
      }}
    >
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={anchor.thumbUri}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      )}
      {anchor.locked && (
        <span
          className="absolute right-2 top-2 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
          style={{ color: 'hsl(42,60%,18%)', background: 'var(--achievement)' }}
        >
          Locked
        </span>
      )}
      <span
        className="relative z-10 rounded px-1.5 py-0.5 font-mono text-[9.5px]"
        style={{ color: 'hsl(265,60%,85%)', background: 'hsla(265,52%,20%,0.55)', border: '1px solid hsla(265,52%,64%,0.35)' }}
      >
        {anchor.seed != null ? `seed ${anchor.seed}` : 'unseeded'}
      </span>
    </div>
  );
}

// ─── node (one shot in the continuity thread) ────────────────────────────

function ThreadNodeView({ node }: { node: ThreadNode }) {
  const dotColor = node.failed
    ? 'var(--danger)'
    : node.rendered
      ? (node.isHandoff ? 'var(--info)' : 'var(--live)')
      : 'var(--fg-faint)';
  return (
    <div className="flex w-[112px] flex-none flex-col items-center gap-1.5 px-1">
      <div
        className="flex h-14 w-full items-center justify-center rounded-md border border-soft"
        style={{ background: `radial-gradient(ellipse 130% 100% at 30% 120%, ${kindTint('image', 0)}, transparent), var(--bg-sunken)` }}
      >
        <span className="font-mono text-sm font-semibold" style={{ color: 'color-mix(in oklab, var(--fg) 28%, transparent)' }}>
          {node.shot}
        </span>
      </div>
      <span
        className="h-[9px] w-[9px] rounded-full border-2"
        style={{ background: 'var(--bg-raised)', borderColor: dotColor, boxShadow: '0 0 0 4px var(--bg-surface)' }}
      />
      <div className="text-center font-mono text-[9.5px] leading-tight text-fg-faint">
        <b className="block font-medium text-fg-muted">{node.cellUid}</b>
        {node.label}
      </div>
      <span
        className="rounded px-1 py-px font-mono text-[8.5px] uppercase tracking-wide"
        style={{
          color: node.isHandoff ? 'var(--info)' : 'var(--agent)',
          background: node.isHandoff ? 'color-mix(in oklab, var(--info) 12%, transparent)' : 'color-mix(in oklab, var(--agent) 12%, transparent)',
        }}
        title={node.isHandoff ? 'Seed + reference plate travel in the exported prompt package — there is no API to persist it on the far side, so the returned clip is trusted on name.' : undefined}
      >
        {node.trackLabel}
      </span>
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────

export function CastWorldView() {
  const project = useProjectStore(selectOpenProject);
  const hasRealCells = useStoryboardStore(selectHasRealCells);
  const hydratedCells = useStoryboardStore(selectHydratedCells);
  const renderRecords = useStoryboardStore(selectRenderRecords);
  const setCellUid = useSharedStore((s) => s.setCellUid);

  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | Anchor['kind']>('all');

  // generate bar
  const [genPrompt, setGenPrompt] = useState('');
  const [genKind, setGenKind] = useState<GenerateKind>('character');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const refetchAnchors = useCallback(async () => {
    if (!hasRealCells) return;
    setLoadState((s) => (s === 'ready' ? s : 'loading'));
    setLoadError(null);
    try {
      const client = await getMcpClient();
      const res = await anchorApi.list(client);
      setAnchors(res.anchors ?? []);
      setLoadState('ready');
    } catch (err) {
      setLoadState('error');
      setLoadError((err as Error).message);
    }
  }, [hasRealCells]);

  // load on mount + re-read on focus (POLL-on-demand — matches the rest of
  // the app; the shell can't relay a cells/changed event into the iframe).
  useEffect(() => {
    if (hasRealCells) void refetchAnchors();
    else {
      setAnchors([]);
      setLoadState('idle');
    }
  }, [hasRealCells, refetchAnchors]);

  const displayAnchors = useMemo<DisplayAnchor[]>(() => {
    if (hasRealCells) return buildRealAnchors(anchors, hydratedCells);
    return FORGE_FIXTURE;
    // renderRecords is read inside buildRealAnchors via getState() so this
    // effect still needs to depend on it to re-derive on a fresh poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRealCells, anchors, hydratedCells, renderRecords]);

  const kindCounts = useMemo(() => {
    const counts: Partial<Record<'all' | Anchor['kind'], number>> = { all: displayAnchors.length };
    for (const a of displayAnchors) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    return counts;
  }, [displayAnchors]);

  const kindsPresent = useMemo(() => {
    const seen = new Set<Anchor['kind']>();
    for (const a of displayAnchors) seen.add(a.kind);
    return Array.from(seen);
  }, [displayAnchors]);

  const filtered = useMemo(
    () => (kindFilter === 'all' ? displayAnchors : displayAnchors.filter((a) => a.kind === kindFilter)),
    [displayAnchors, kindFilter],
  );

  const lockedCount = displayAnchors.filter((a) => a.locked).length;
  const driftCount = displayAnchors.filter((a) => !a.locked && a.nodes.length > 0 && a.seed != null).length === 0
    ? 0
    : displayAnchors.filter((a) => !a.locked && a.nodes.some((n) => !n.rendered)).length;

  // ── mutations (real mode only) ──

  const handleGenerate = useCallback(async () => {
    const prompt = genPrompt.trim();
    if (!prompt || !hasRealCells) return;
    setGenerating(true);
    setGenError(null);
    try {
      const client = await getMcpClient();
      const words = prompt.replace(/["“”]/g, '').split(/\s+/).filter(Boolean);
      const name = words.slice(0, 4).join(' ').replace(/^./, (c) => c.toUpperCase());
      await anchorApi.generate(client, {
        project_id: project?.project_id,
        kind: genKind,
        name: name || 'New anchor',
        prompt,
      });
      setGenPrompt('');
      await refetchAnchors();
    } catch (err) {
      setGenError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [genPrompt, genKind, hasRealCells, project?.project_id, refetchAnchors]);

  // Regenerate under the SAME id (see file header) so cell.anchors[]
  // references never dangle.
  const regenerate = useCallback(async (row: DisplayAnchor) => {
    if (!row.raw || !GENERATE_KINDS.includes(row.kind as GenerateKind)) return;
    setBusyId(row.id);
    setRowError(null);
    try {
      const client = await getMcpClient();
      const kind = row.kind as GenerateKind;
      const prompt = row.description || row.name;
      const fresh = await anchorApi.generate(client, {
        project_id: project?.project_id,
        kind,
        name: row.name,
        prompt,
        seed: row.seed,
      });
      await anchorApi.delete(client, row.raw.id);
      await anchorApi.delete(client, fresh.id);
      await anchorApi.create(client, {
        ...fresh,
        id: row.raw.id,
        metadata: { ...fresh.metadata, locked: row.locked },
      });
      await refetchAnchors();
    } catch (err) {
      setRowError({ id: row.id, message: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  }, [project?.project_id, refetchAnchors]);

  // Lock (mints + pins a seed for an unseeded anchor) / unlock — same
  // delete→create(same id) pattern; there is no anchor.update.
  const toggleLock = useCallback(async (row: DisplayAnchor) => {
    if (!row.raw) return;
    setBusyId(row.id);
    setRowError(null);
    try {
      const client = await getMcpClient();
      const nextLocked = !row.locked;
      const seed = row.seed ?? (nextLocked ? Math.floor(Math.random() * 90_000) + 10_000 : undefined);
      await anchorApi.delete(client, row.raw.id);
      await anchorApi.create(client, {
        ...row.raw,
        metadata: { ...row.raw.metadata, locked: nextLocked, ...(seed != null ? { seed } : {}) },
      });
      await refetchAnchors();
    } catch (err) {
      setRowError({ id: row.id, message: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  }, [refetchAnchors]);

  const openInStoryboard = useCallback((cellUid: string) => {
    setCellUid(cellUid);
  }, [setCellUid]);

  const readOnly = !hasRealCells;

  // ── explicit loading / error (real mode) ──

  if (hasRealCells && loadState === 'loading' && anchors.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-base font-mono text-[11px] uppercase tracking-wider text-fg-faint">
        loading anchors…
      </div>
    );
  }

  if (hasRealCells && loadState === 'error') {
    return (
      <EmptyState glyph="!" title="Couldn't load anchors" hint={loadError ?? undefined}>
        <button
          type="button"
          onClick={() => void refetchAnchors()}
          className="mt-2 rounded px-3 py-1 text-[11px] ring-1 ring-inset ring-[var(--border)] text-fg hover:bg-raised"
        >
          Retry
        </button>
      </EmptyState>
    );
  }

  if (hasRealCells && displayAnchors.length === 0) {
    return (
      <EmptyState glyph="◆" title="No anchors yet" hint="lock a face, a place, or a look before you shoot it six times">
        <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-faint">
          Ask your Chi in the chat dock to seed anchors from the script — try{' '}
          <span className="font-mono text-fg-muted">"lock the cast and locations"</span> — or generate one below.
        </p>
        <GenerateBar
          prompt={genPrompt} setPrompt={setGenPrompt}
          kind={genKind} setKind={setGenKind}
          onGenerate={handleGenerate} generating={generating} error={genError}
          disabled={false}
        />
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-base text-fg">
      {/* ═══ header ═══ */}
      <div className="flex items-end justify-between gap-4 border-b border-soft px-6 py-4">
        <div>
          <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-fg-faint">
            {project?.project_id ?? 'The Forge'} · Cast &amp; World
          </p>
          <h1 className="font-display text-[28px] font-medium leading-none text-fg">
            The <em className="font-normal not-italic" style={{ fontStyle: 'italic', color: 'var(--achievement)' }}>lookbook</em>, not the file list
          </h1>
        </div>
        <div
          role="tablist"
          aria-label="Filter by kind"
          className="flex gap-0.5 rounded-lg border border-soft bg-sunken p-1"
        >
          {(['all', ...kindsPresent] as Array<'all' | Anchor['kind']>).map((k) => {
            const active = kindFilter === k;
            const label = k === 'all' ? 'All' : KIND_META[k].filterLabel;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setKindFilter(k)}
                className={
                  'rounded-md px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wider ' +
                  (active ? 'bg-raised text-fg ring-1 ring-inset ring-[var(--border)]' : 'text-fg-muted hover:text-fg')
                }
              >
                {label} · {kindCounts[k] ?? 0}
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ generate bar ═══ */}
      {!readOnly && (
        <div className="mx-6 mt-4">
          <GenerateBar
            prompt={genPrompt} setPrompt={setGenPrompt}
            kind={genKind} setKind={setGenKind}
            onGenerate={handleGenerate} generating={generating} error={genError}
            disabled={false}
          />
        </div>
      )}
      {readOnly && (
        <div className="mx-6 mt-4 rounded-lg border px-4 py-2.5 font-mono text-[10.5px] text-fg-faint" style={{ borderColor: 'color-mix(in oklab, var(--agent) 30%, var(--border-soft))' }}>
          standalone preview · "The Forge" fixture · open a real project to generate, regenerate, or lock anchors
        </div>
      )}

      {/* ═══ lookbook: the threads ═══ */}
      <div className="flex-1 overflow-y-auto px-6 pb-8 pt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-fg-faint">
            Continuity threads — where each anchor reappears
          </span>
          <div className="flex items-center gap-4 font-mono text-[10px] text-fg-faint">
            <span><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--live)' }} />rendered, in cut</span>
            <span><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--info)' }} />handoff clip returned</span>
            <span><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--fg-faint)' }} />not yet shot</span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-soft py-10 text-[12px] text-fg-faint">
            No anchors of this kind yet.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filtered.map((row) => {
              const expanded = expandedId === row.id;
              const busy = busyId === row.id;
              const canLockToggle = !readOnly;
              const canRegen = !readOnly && GENERATE_KINDS.includes(row.kind as GenerateKind);
              return (
                <div key={row.id} className="overflow-hidden rounded-xl border border-soft bg-surface">
                  <div className="flex">
                    {/* ── plate card ── */}
                    <div
                      className="flex w-[210px] flex-none flex-col gap-2.5 border-r border-soft p-4"
                      style={row.locked ? { boxShadow: 'inset 3px 0 0 var(--achievement)' } : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.name} portrait`}
                        className="text-left"
                      >
                        <AnchorThumb anchor={row} />
                      </button>
                      <span
                        className="w-fit rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider"
                        style={{ color: `var(${KIND_META[row.kind].colorVar})`, border: `1px solid ${kindTint(row.kind, 40)}` }}
                      >
                        {KIND_META[row.kind].label}
                      </span>
                      <h3 className="font-display text-[19px] font-medium leading-tight text-fg">{row.name}</h3>
                      <p className="text-[11.5px] leading-snug text-fg-muted">{row.description || 'No description yet.'}</p>
                      <div className="flex items-center gap-2">
                        {row.seed != null ? (
                          <span className="rounded px-2 py-1 font-mono text-[10.5px]" style={{ color: 'hsl(265,60%,80%)', background: 'var(--bg-sunken)', border: '1px solid hsla(265,52%,64%,0.3)' }}>
                            seed · {row.seed}
                          </span>
                        ) : (
                          <span className="rounded border border-soft px-2 py-1 font-mono text-[10.5px] text-fg-faint">no seed pinned</span>
                        )}
                      </div>
                      <span className="font-mono text-[10.5px] text-fg-faint">
                        <b className="font-medium text-fg">{row.nodes.length}</b> shot{row.nodes.length === 1 ? '' : 's'} · {row.usedSummary}
                      </span>

                      <div className="mt-auto flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => void regenerate(row)}
                          disabled={!canRegen || busy}
                          title={!canRegen ? 'Regenerate is only wired for character/location/style/prop anchors in a real project' : undefined}
                          className={
                            'flex-1 rounded-md border px-2.5 py-1.5 text-center font-mono text-[10px] uppercase tracking-wider ' +
                            (canRegen ? 'border-[var(--border)] text-fg-muted hover:border-[var(--fg-faint)] hover:text-fg' : 'cursor-not-allowed border-[var(--border-soft)] text-fg-faint opacity-50')
                          }
                        >
                          {busy ? '…' : 'Regenerate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleLock(row)}
                          disabled={!canLockToggle || busy}
                          aria-label={row.locked ? `Unlock ${row.name}'s seed` : `Lock ${row.name}'s seed`}
                          title={row.locked ? 'Unlock seed' : 'Lock seed'}
                          className={
                            'rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider ' +
                            (row.locked
                              ? 'border-[var(--border)] text-fg-faint hover:text-fg'
                              : 'border-[color-mix(in_oklab,var(--achievement)_40%,var(--border))] hover:brightness-110') +
                            (!canLockToggle || busy ? ' cursor-not-allowed opacity-50' : '')
                          }
                          style={!row.locked ? { color: 'var(--achievement)' } : undefined}
                        >
                          {row.locked ? '🔒' : row.seed == null ? '🔓 Lock seed' : '🔓 Lock'}
                        </button>
                      </div>
                      {rowError?.id === row.id && (
                        <p className="font-mono text-[9.5px] leading-snug" style={{ color: 'var(--danger)' }}>
                          {rowError.message}
                        </p>
                      )}
                    </div>

                    {/* ── thread ── */}
                    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-4 py-4">
                      {row.nodes.length === 0 ? (
                        <div className="px-2 font-mono text-[11px] text-fg-faint">not used in any shot yet</div>
                      ) : (
                        row.nodes.map((n) => <ThreadNodeView key={n.cellUid} node={n} />)
                      )}
                      <button
                        type="button"
                        onClick={() => row.nodes[0] && openInStoryboard(row.nodes[0].cellUid)}
                        disabled={row.nodes.length === 0}
                        className="ml-2 flex-none font-mono text-[10.5px] text-info hover:underline disabled:cursor-not-allowed disabled:text-fg-faint disabled:no-underline"
                      >
                        Open in storyboard →
                      </button>
                    </div>
                  </div>

                  {/* expanded hero portrait */}
                  {expanded && (
                    <div className="border-t border-soft bg-sunken p-4">
                      <div className="mx-auto flex max-w-md flex-col items-center gap-2">
                        <div className="w-full">
                          <AnchorThumbLarge anchor={row} />
                        </div>
                        <p className="text-center text-[11px] text-fg-muted">{row.description}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ footer ═══ */}
      <div className="flex gap-6 border-t border-soft px-6 py-3 font-mono text-[10.5px] text-fg-faint">
        <span><b className="font-medium text-fg-muted">{displayAnchors.length}</b> anchors · <b className="font-medium text-fg-muted">{lockedCount}</b> locked</span>
        <span>drift check: <b className="font-medium text-fg-muted">{driftCount}</b> unlocked anchors reused in upcoming shots</span>
        <span>Track A generation via fal · Track B = prompt handoff, no API</span>
      </div>
    </div>
  );
}

// ─── generate bar (extracted — used in both the normal header slot and the
//     empty-state CTA) ────────────────────────────────────────────────────

function GenerateBar({
  prompt, setPrompt, kind, setKind, onGenerate, generating, error, disabled,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  kind: GenerateKind;
  setKind: (k: GenerateKind) => void;
  onGenerate: () => void;
  generating: boolean;
  error: string | null;
  disabled: boolean;
}) {
  return (
    <div>
      <div
        className="flex items-center gap-3 rounded-xl border p-3.5"
        style={{ background: 'linear-gradient(135deg, hsla(265,45%,20%,0.16), var(--bg-surface) 55%)', borderColor: 'hsla(265,52%,64%,0.28)' }}
      >
        <span className="h-2 w-2 flex-none rounded-full" style={{ background: 'var(--agent)', boxShadow: '0 0 0 3px hsla(265,52%,64%,0.18)' }} />
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) onGenerate(); }}
          disabled={disabled || generating}
          placeholder='Describe a new anchor — e.g. "a rival smith, scarred hands, arrives in shot 7"'
          className="min-w-0 flex-1 rounded-md border border-soft bg-sunken px-3 py-2 text-[13.5px] text-fg placeholder:text-fg-faint disabled:opacity-50"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as GenerateKind)}
          disabled={disabled || generating}
          aria-label="Anchor kind"
          className="rounded-md border border-soft bg-sunken px-2.5 py-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted disabled:opacity-50"
        >
          {GENERATE_KINDS.map((k) => (
            <option key={k} value={k}>{KIND_META[k].filterLabel}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={onGenerate}
          disabled={disabled || generating || !prompt.trim()}
          className="flex-none whitespace-nowrap rounded-md px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--agent)', color: 'hsl(265,52%,10%)' }}
        >
          {generating ? 'Generating…' : 'Generate anchor'}
        </button>
        <span className="flex-none font-mono text-[10px] text-fg-faint">fal · seed auto-assigned on first render</span>
      </div>
      {error && (
        <p className="mt-1.5 font-mono text-[10.5px]" style={{ color: 'var(--danger)' }}>{error}</p>
      )}
    </div>
  );
}

function AnchorThumbLarge({ anchor }: { anchor: DisplayAnchor }) {
  const [broken, setBroken] = useState(false);
  const showImg = !broken && !!anchor.thumbUri && /^(https?:|data:)/.test(anchor.thumbUri);
  return (
    <div
      className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border border-soft"
      style={{ background: `radial-gradient(ellipse 140% 90% at 30% 110%, ${kindTint(anchor.kind, 45)}, transparent 65%), var(--bg-sunken)` }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={anchor.thumbUri} alt="" className="h-full w-full object-contain" onError={() => setBroken(true)} />
      ) : (
        <span className="font-display text-lg text-fg-faint">{anchor.name}</span>
      )}
    </div>
  );
}
