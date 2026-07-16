// com.ikenga.studio · Breakdown view
//
// Concept: designs/redesign-ai/breakdown-b-reframed.html (Dusk Wood, LOCKED).
// Script → board + assets in one pass: the project's Fountain screenplay on
// one side, the extracted shots (cell = shot) + extracted anchors on the
// other, with a bezier connector rail linking a script action line to the
// shot it produced. A bold "Run breakdown" action anchors the header.
//
// REAL seams (no fabricated data in real mode):
//   • Script         — storyboard.read_fountain (Wave-5 seam, same as
//     Script.tsx's Fountain mode). `exists:false` is an honest "no
//     script.fountain on disk" state, not an error.
//   • Shots           — the hydrated Cell[] (storyboard-store), one shot per
//     cell. `label`/`shot_type`/`action`/`anchors`/`renderer` come straight off
//     the schema — nothing here is invented per-cell copy.
//   • Anchors         — anchor.list (real project anchors); "used in N shots"
//     is counted from the real `cell.anchors` arrays, not a canned number.
//   • Track A/B pill  — a HEURISTIC, not a stored field: the schema has no
//     per-cell "generator track". We ask render.list_engines once and treat a
//     cell as Track A (fal, in-app) when a `fal*` engine capability advertises
//     `video: true` and the cell's duration fits `max_duration_ms`; anything
//     else is Track B (handoff to an external tool). Labelled as an estimate
//     in the UI, never asserted as ground truth.
//   • Cost estimate   — a flat placeholder rate, NOT a live price (neither
//     `render.list_engines`'s EngineCapability nor anything else on the wire
//     carries a $/generation figure yet). Surfaced with an explicit "estimate"
//     qualifier so it reads as a guess, not a quote.
//   • Run breakdown   — TODO: there is no `breakdown.*` MCP verb yet (grepped
//     mcp-client.ts / real-mcp.ts — absent). The header CTA is DISABLED +
//     labelled "soon" so it doesn't fake a load while the seam is unbuilt.
//     Swap `runBreakdown` for a real `breakdownApi.run(client, …)` call (and
//     drop the disabled chrome) the moment that verb exists.
//
// Line→shot linking: the schema does not carry a per-line shot tag on
// `.fountain` text, so the rail links the Nth non-dialogue action paragraph to
// the Nth shot (both already in the same authored order) — a POSITIONAL
// heuristic, not a verified mapping. If the paragraph and shot counts differ,
// the rail is suppressed rather than drawing a link that could be wrong.
//
// Dialogue: this archetype's screenplay format has no dialogue — any
// character-cue/dialogue block a parsed `.fountain` happens to contain is
// filtered out before rendering (CHARACTER_RE/dialogue kind from
// lib/fountain), so only scene headings + action lines ever show here.
//
// Mock/standalone: __mocks__ has no Breakdown-shaped fixture (no dedicated
// screen predates this view), so a small local "The Forge" demo — matching
// the design concept 1:1 — stands in only when `hasRealCells` is false. It is
// clearly labelled "Demo data" and never conflated with a real project.

import { useEffect, useMemo, useRef, useState } from 'react';

import { useProjectStore, selectOpenProject } from '../project-store';
import {
  useStoryboardStore,
  selectHasRealCells,
  selectHydratedCells,
  selectHydratedProject,
} from '../storyboard-store';
import { getMcpClient, storyboardApi, anchorApi, renderApi } from '../mcp-client';
import { parseFountain, type FountainScene } from '../lib/fountain';
import type { Anchor, Cell, EngineCapability } from '../mcp-types';
import { EmptyState } from '../components/EmptyState';

// ─── local "The Forge" demo fixture (standalone/mock only) ───────────────

interface DemoShot {
  uid: string;
  shotId: string;
  shotType: string;
  action: string;
  anchorIds: string[];
  renderer: string;
  track: 'A' | 'B';
}

const DEMO_ANCHORS: Anchor[] = [
  {
    id: 'a-adaora', name: 'Adaora', kind: 'character',
    asset: { uri: 'demo://adaora.png' },
    tags: [], metadata: { seed: 44821, description: 'Young West African blacksmith, soot-marked, leather apron, firelit' },
  },
  {
    id: 'a-workshop', name: 'The Workshop', kind: 'location',
    asset: { uri: 'demo://workshop.png' },
    tags: [], metadata: { seed: 90310, description: 'Dim ironworking workshop at night, glowing forge, embers' },
  },
  {
    id: 'a-mask', name: 'Iron mask', kind: 'image',
    asset: { uri: '' },
    tags: [], metadata: { description: 'The object being forged — half-formed, then alive' },
  },
  {
    id: 'a-style', name: 'Ember-noir', kind: 'style',
    asset: { uri: 'demo://ember-noir.png' },
    tags: [], metadata: { seed: 10577, description: 'Warm orange key against deep shadow, cinematic, shallow DoF' },
  },
];

const DEMO_SHOTS: DemoShot[] = [
  { uid: 'sc1_sh1', shotId: 'sc1_sh1', shotType: 'ws',  action: 'Forge glowing, slow push-in, embers',              anchorIds: ['a-workshop'],             renderer: 'auto', track: 'A' },
  { uid: 'sc1_sh2', shotId: 'sc1_sh2', shotType: 'ms',  action: 'Adaora at anvil, hammer raised, firelight',        anchorIds: ['a-adaora', 'a-workshop'], renderer: 'auto', track: 'A' },
  { uid: 'sc1_sh3', shotId: 'sc1_sh3', shotType: 'ecu', action: 'Iron mask half-formed, slow tilt, sparks',         anchorIds: ['a-workshop', 'a-mask'],   renderer: 'auto', track: 'A' },
  { uid: 'sc1_sh4', shotId: 'sc1_sh4', shotType: 'cu',  action: 'Hammer strikes, sparks burst toward camera',       anchorIds: ['a-adaora'],               renderer: 'auto', track: 'B' },
  { uid: 'sc1_sh5', shotId: 'sc1_sh5', shotType: 'ecu', action: "Mask's eyes catch firelight, a flicker",           anchorIds: ['a-workshop', 'a-mask'],   renderer: 'auto', track: 'A' },
  { uid: 'sc1_sh6', shotId: 'sc1_sh6', shotType: 'ms',  action: 'Adaora steps back, mask glowing between',          anchorIds: ['a-adaora', 'a-workshop'], renderer: 'auto', track: 'A' },
];

const DEMO_FOUNTAIN = `INT. THE WORKSHOP - NIGHT

The forge glows low and orange in the dark. Embers drift upward like slow stars.

Adaora stands at the anvil, soot on her hands, hammer raised, firelight carving her face out of shadow.

Close on the anvil: an iron mask, half-formed, catches sparks as it turns beneath the hammer's shadow.

The hammer falls. Sparks burst toward camera — a shower of white fire against black.

The mask's eyes catch the firelight. A flicker. Almost alive.

Adaora steps back. Between her hands the mask glows, held like something newborn.
`;

const DEMO_TITLE = 'The Forge';

// ─── shared shot shape (post-projection from Cell OR the demo fixture) ───

interface ShotRow {
  uid: string;
  shotId: string;
  shotType: string;
  action: string;
  anchorIds: string[];
  renderer: string;
  track: 'A' | 'B';
}

function cellToShot(cell: Cell, track: 'A' | 'B'): ShotRow {
  return {
    uid: cell.uid,
    shotId: cell.label || cell.beat_id || cell.uid,
    shotType: cell.shot_type ?? 'unset',
    action: cell.action || cell.intent || cell.prompt || '(no action note yet)',
    anchorIds: cell.anchors ?? [],
    renderer: cell.renderer ?? 'auto',
    track,
  };
}

/** Track A/B heuristic — see file-header note. Cheap, best-effort, never
 *  presented as authoritative. */
function trackForCell(cell: Cell, engines: EngineCapability[]): 'A' | 'B' {
  const fal = engines.find((e) => e.id.toLowerCase().includes('fal'));
  if (!fal || fal.video !== true) return 'B';
  if (fal.max_duration_ms && cell.duration_ms && cell.duration_ms > fal.max_duration_ms) return 'B';
  return 'A';
}

// Rough, clearly-labelled placeholder rates — no live pricing seam exists yet.
const EST_COST_PER_TRACK_A_SHOT = 0.35;
const EST_COST_PER_ANCHOR = 0.08;

function anchorMeta(a: Anchor): { seed?: number; description?: string } {
  const md = a.metadata ?? {};
  return {
    seed: typeof md.seed === 'number' ? md.seed : undefined,
    description: typeof md.description === 'string' ? md.description : undefined,
  };
}

// ─── rail (bezier connector) ──────────────────────────────────────────────

function BreakdownRail({
  activeId,
  paraRefs,
  shotRefs,
  railRef,
  ids,
}: {
  activeId: string | null;
  paraRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  shotRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  railRef: React.RefObject<HTMLDivElement | null>;
  ids: string[];
}) {
  const [paths, setPaths] = useState<Array<{ id: string; d: string; x1: number; y1: number; x2: number; y2: number }>>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const recompute = () => {
      const rail = railRef.current;
      if (!rail) return;
      const railRect = rail.getBoundingClientRect();
      setBox({ w: railRect.width, h: railRect.height });
      const next: typeof paths = [];
      for (const id of ids) {
        const p = paraRefs.current.get(id);
        const s = shotRefs.current.get(id);
        if (!p || !s) continue;
        const pRect = p.getBoundingClientRect();
        const sRect = s.getBoundingClientRect();
        const y1 = pRect.top + pRect.height / 2 - railRect.top;
        const y2 = sRect.top + sRect.height / 2 - railRect.top;
        const x1 = 0;
        const x2 = railRect.width;
        const midX = railRect.width / 2;
        next.push({
          id,
          d: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
          x1, y1, x2, y2,
        });
      }
      setPaths(next);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    if (railRef.current) ro.observe(railRef.current);
    window.addEventListener('resize', recompute);
    const t = setTimeout(recompute, 50);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
      clearTimeout(t);
    };
    // Re-measure whenever the set of linkable ids changes (data load) too.
  }, [ids, paraRefs, shotRefs, railRef]);

  return (
    <div ref={railRef} className="relative min-h-0 w-11 shrink-0" aria-hidden="true">
      <svg viewBox={`0 0 ${box.w} ${box.h}`} className="h-full w-full overflow-visible">
        {paths.map((p) => {
          const active = p.id === activeId;
          return (
            <g key={p.id}>
              <path
                d={p.d}
                fill="none"
                stroke={active ? 'var(--agent)' : 'var(--border)'}
                strokeWidth={active ? 1.75 : 1.25}
              />
              <circle cx={p.x1} cy={p.y1} r={2.5} fill="var(--bg-base)" stroke={active ? 'var(--agent)' : 'var(--border)'} strokeWidth={1.25} />
              <circle cx={p.x2} cy={p.y2} r={2.5} fill={active ? 'var(--agent)' : 'var(--bg-base)'} stroke={active ? 'var(--agent)' : 'var(--border)'} strokeWidth={1.25} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────

export function BreakdownView() {
  const project = useProjectStore(selectOpenProject);
  const hasRealCells = useStoryboardStore(selectHasRealCells);
  const hydratedCells = useStoryboardStore(selectHydratedCells);
  const projectDoc = useStoryboardStore(selectHydratedProject);
  const refetchStoryboard = useStoryboardStore((s) => s.refetch);

  useEffect(() => { void refetchStoryboard(); }, [refetchStoryboard]);

  // archetype (projectDoc.script.archetype / archetype_id) drives the scene +
  // dialogue parsing below; non-narrative formats have no dialogue by design.
  const title = hasRealCells ? (projectDoc?.script?.title ?? projectDoc?.title ?? 'script') : DEMO_TITLE;
  // real projects always persist the screenplay to <root>/script.fountain (see mcp-client.ts:199-201)
  const scriptFilename = hasRealCells ? 'script.fountain' : 'the-forge.fountain';

  // ── anchors (real: anchor.list; mock: DEMO_ANCHORS) ──
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [anchorsError, setAnchorsError] = useState<string | null>(null);
  useEffect(() => {
    if (!hasRealCells) { setAnchors(DEMO_ANCHORS); setAnchorsError(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const client = await getMcpClient();
        const res = await anchorApi.list(client);
        if (!cancelled) { setAnchors(res.anchors ?? []); setAnchorsError(null); }
      } catch (e) {
        if (!cancelled) { setAnchors([]); setAnchorsError((e as Error).message); }
      }
    })();
    return () => { cancelled = true; };
  }, [hasRealCells, project?.project_id]);

  // ── engines (real only — powers the Track A/B heuristic) ──
  const [engines, setEngines] = useState<EngineCapability[]>([]);
  useEffect(() => {
    if (!hasRealCells) return;
    let cancelled = false;
    void (async () => {
      try {
        const client = await getMcpClient();
        const res = await renderApi.list_engines(client);
        if (!cancelled) setEngines(res.engines ?? []);
      } catch {
        if (!cancelled) setEngines([]);
      }
    })();
    return () => { cancelled = true; };
  }, [hasRealCells, project?.project_id]);

  // ── fountain script (real: storyboard.read_fountain; mock: DEMO_FOUNTAIN) ──
  const [fountain, setFountain] = useState<{
    loading: boolean; loaded: boolean; exists: boolean; text: string; error: string | null;
  }>({ loading: false, loaded: false, exists: false, text: '', error: null });

  useEffect(() => {
    if (!hasRealCells) return;
    let cancelled = false;
    setFountain((f) => ({ ...f, loading: true, error: null }));
    void (async () => {
      try {
        const client = await getMcpClient();
        const res = await storyboardApi.read_fountain(client);
        if (!cancelled) setFountain({ loading: false, loaded: true, exists: res.exists, text: res.text, error: null });
      } catch (e) {
        if (!cancelled) setFountain({ loading: false, loaded: true, exists: false, text: '', error: (e as Error).message });
      }
    })();
    return () => { cancelled = true; };
  }, [hasRealCells, project?.project_id]);

  const scriptText = hasRealCells ? fountain.text : DEMO_FOUNTAIN;
  const scriptExists = hasRealCells ? fountain.exists : true;

  // Parse + strip dialogue (this archetype's screenplay has none by design —
  // any character-cue/dialogue block that shows up anyway is not rendered).
  const scenes: FountainScene[] = useMemo(() => {
    if (!scriptText) return [];
    return parseFountain(scriptText)
      .map((scene) => ({ ...scene, blocks: scene.blocks.filter((b) => b.kind !== 'dialogue') }))
      .filter((scene) => scene.blocks.length > 0);
  }, [scriptText]);

  const actionParagraphs = useMemo(
    () => scenes.flatMap((scene) => scene.blocks.filter((b) => b.kind === 'action').map((b) => b.text)),
    [scenes],
  );

  // ── shots (real: hydrated Cell[] mapped 1:1; mock: DEMO_SHOTS) ──
  const shots: ShotRow[] = useMemo(() => {
    if (!hasRealCells) return DEMO_SHOTS.map((s) => ({ ...s }));
    return [...hydratedCells]
      .sort((a, b) => a.index - b.index)
      .map((c) => cellToShot(c, trackForCell(c, engines)));
  }, [hasRealCells, hydratedCells, engines]);

  // Positional line↔shot linking — only when counts line up (see file header).
  const linkableIds = actionParagraphs.length === shots.length
    ? shots.map((s) => s.uid)
    : [];

  const anchorUsage = useMemo(() => {
    const counts = new Map<string, number>();
    if (hasRealCells) {
      for (const c of hydratedCells) for (const id of c.anchors ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    } else {
      for (const s of DEMO_SHOTS) for (const id of s.anchorIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [hasRealCells, hydratedCells]);

  const trackACount = shots.filter((s) => s.track === 'A').length;
  const trackBCount = shots.length - trackACount;
  const pendingAnchors = anchors.filter((a) => !a.asset?.uri).length;
  const estCost = trackACount * EST_COST_PER_TRACK_A_SHOT + pendingAnchors * EST_COST_PER_ANCHOR;

  // ── hover/focus linking state ──
  const [activeId, setActiveId] = useState<string | null>(null);
  const paraRefs = useRef<Map<string, HTMLElement>>(new Map());
  const shotRefs = useRef<Map<string, HTMLElement>>(new Map());
  const railRef = useRef<HTMLDivElement>(null);

  // ── "Run breakdown" — there is no `breakdown.*` MCP verb yet (see header).
  // The header CTA is disabled + labelled "soon" so it doesn't fake a network
  // load while the server-side seam is unbuilt. Drop the disabled chrome and
  // swap runBreakdown for a real `breakdownApi.run(client, { project_id })`
  // call when that verb lands.
  const runBreakdown = async () => {
    /* TODO(studio-mcp): breakdownApi.run(client, { project_id }) */
  };

  // ── gates ── (standalone/mock has no `project` object at all — those gates
  // only apply once we know we're in a real, hydrated session)
  if (hasRealCells && !project) {
    return (
      <EmptyState glyph="✂" title="No project open" hint="open a project to run its breakdown">
        <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-faint">
          Breakdown reads a project's script.fountain and its extracted shots — open one from the Launcher first.
        </p>
      </EmptyState>
    );
  }

  if (hasRealCells && fountain.loaded && !fountain.exists) {
    return (
      <EmptyState glyph="✂" title="Breakdown needs a script" hint="no script.fountain in this project">
        <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-faint">
          Breakdown links a `.fountain` screenplay to shots. Ask your Chi to draft a screenplay for this project (or drop a <span className="font-mono text-fg-muted">script.fountain</span> into the project folder), then the shot-by-shot breakdown appears here.
        </p>
      </EmptyState>
    );
  }

  if (hasRealCells && (fountain.loading || !fountain.loaded)) {
    return (
      <div className="flex h-full items-center justify-center bg-base">
        <p className="font-mono text-[11px] text-fg-faint">Loading screenplay…</p>
      </div>
    );
  }

  if (hasRealCells && fountain.error) {
    return (
      <EmptyState glyph="⚠" title="Couldn't read the screenplay" hint={fountain.error} />
    );
  }

  if (hasRealCells && !scriptExists) {
    return (
      <EmptyState glyph="✍" title="No script.fountain yet" hint="ask your Chi to draft one">
        <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-fg-faint">
          Once a screenplay exists on disk, Breakdown will parse it into scenes on the left and line it up against the shots on the right.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-base text-fg">
      {/* ── header ── */}
      <div className="flex flex-none items-center justify-between gap-4 border-b border-soft bg-surface px-6 py-3">
        <div className="flex items-baseline gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-fg-faint">Breakdown</div>
            <h1 className="font-display text-lg font-medium">{title}</h1>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px] text-fg-muted">
            {!hasRealCells && (
              <span className="rounded border border-soft bg-raised px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-fg-faint">
                Demo data
              </span>
            )}
            <span className="text-fg-faint">·</span>
            <span>{scriptFilename}</span>
            <span className="text-fg-faint">·</span>
            <span><span className="tabular-nums text-fg">{shots.length}</span> shots detected</span>
            <span className="text-fg-faint">·</span>
            <span><span className="tabular-nums text-fg">{anchors.length}</span> anchors extracted</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void runBreakdown()}
          disabled
          title="Coming soon — no breakdown backend (breakdown.* MCP verb) is wired yet"
          className="flex cursor-not-allowed items-center gap-3 rounded border px-4 py-2.5 text-left opacity-70"
          style={{
            borderColor: 'color-mix(in oklab, var(--agent) 55%, var(--border))',
            background: 'linear-gradient(180deg, color-mix(in oklab, var(--agent) 28%, var(--bg-raised)), color-mix(in oklab, var(--agent) 18%, var(--bg-sunken)))',
            color: 'color-mix(in oklab, var(--agent) 70%, var(--fg))',
          }}
        >
          <span className="flex h-[18px] w-[18px] items-center justify-center text-sm" style={{ color: 'var(--agent)' }}>◆</span>
          <span className="flex flex-col items-start gap-0.5">
            <span className="text-[12.5px] font-semibold">Run breakdown · soon</span>
            <span className="font-mono text-[10px]" style={{ color: 'color-mix(in oklab, var(--agent) 55%, var(--fg-muted))' }}>
              awaiting breakdown MCP verb
            </span>
          </span>
        </button>
      </div>

      {/* ── pre-run cost estimate ── */}
      <div className="flex-none border-b border-soft bg-sunken px-6 py-2 font-mono text-[10.5px] text-fg-muted">
        On run, breakdown will propose <span className="tabular-nums text-fg">{shots.length}</span> cells
        {' + '}<span className="tabular-nums text-fg">{anchors.length}</span> anchors ·{' '}
        est <span className="tabular-nums" style={{ color: 'var(--achievement)' }}>${estCost.toFixed(2)}</span>, Track A only
        <span className="text-fg-faint"> (estimate — no live pricing seam yet; breakdown backend pending)</span>
      </div>

      {/* ── 4-zone body ── */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1.6fr)_minmax(0,1fr)] gap-0 overflow-hidden px-6 py-4">

        {/* SCRIPT */}
        <div className="flex min-h-0 flex-col pr-5">
          <div className="mb-3 flex items-center justify-between border-b border-soft pb-2.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-faint">Script</span>
            <span className="font-mono text-[11px] text-fg-muted">{scriptFilename}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1.5">
            {scenes.map((scene) => {
              return (
                <div key={scene.id}>
                  <div className="mb-4 border-b border-dashed border-soft pb-3.5 pt-2.5 font-mono text-[11.5px] uppercase tracking-wider text-fg-muted">
                    {scene.heading}
                  </div>
                  {scene.blocks
                    .filter((b) => b.kind === 'action')
                    .map((blk, i) => {
                      const globalIdx = scenes
                        .slice(0, scenes.indexOf(scene))
                        .reduce((acc, s) => acc + s.blocks.filter((b) => b.kind === 'action').length, 0) + i;
                      const linkId = linkableIds[globalIdx];
                      const isActive = !!linkId && linkId === activeId;
                      return (
                        <p
                          key={i}
                          ref={(el) => {
                            if (!linkId) return;
                            if (el) paraRefs.current.set(linkId, el);
                            else paraRefs.current.delete(linkId);
                          }}
                          className="relative mb-1 rounded-sm border-l-2 px-3 py-2 font-mono text-[12.5px] leading-relaxed transition-colors"
                          style={{
                            borderLeftColor: isActive ? 'var(--agent)' : 'transparent',
                            background: isActive ? 'var(--bg-raised)' : undefined,
                            color: isActive ? 'var(--fg)' : 'var(--fg-muted)',
                          }}
                          onMouseEnter={() => linkId && setActiveId(linkId)}
                          onMouseLeave={() => setActiveId((cur) => (cur === linkId ? null : cur))}
                        >
                          {blk.text}
                          {linkId && (
                            <span className="ml-1.5 font-mono text-[9.5px]" style={{ color: isActive ? 'var(--agent)' : 'var(--fg-faint)' }}>
                              {linkId}
                            </span>
                          )}
                        </p>
                      );
                    })}
                </div>
              );
            })}
            {scenes.length === 0 && (
              <p className="p-2 font-mono text-[11px] text-fg-faint">No action lines parsed from this screenplay.</p>
            )}
          </div>
        </div>

        {/* RAIL */}
        {linkableIds.length > 0 ? (
          <BreakdownRail activeId={activeId} paraRefs={paraRefs} shotRefs={shotRefs} railRef={railRef} ids={linkableIds} />
        ) : (
          <div className="w-11 shrink-0" />
        )}

        {/* SHOTS / BOARD */}
        <div className="flex min-h-0 flex-col border-x border-soft px-5">
          <div className="mb-3 flex items-center justify-between border-b border-soft pb-2.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-faint">Board — {shots.length} shots</span>
            <span className="font-mono text-[10.5px] text-fg-muted">
              {shots[0]?.shotId ?? '—'} → {shots[shots.length - 1]?.shotId ?? '—'}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {shots.map((shot, i) => {
              const linkId = linkableIds[i];
              const isActive = !!linkId && linkId === activeId;
              return (
                <div
                  key={shot.uid}
                  ref={(el) => {
                    if (!linkId) return;
                    if (el) shotRefs.current.set(linkId, el);
                    else shotRefs.current.delete(linkId);
                  }}
                  className="grid grid-cols-[70px_1fr] gap-3.5 rounded border p-2.5 transition-colors"
                  style={{
                    borderColor: isActive ? 'var(--agent)' : 'var(--border-soft)',
                    background: isActive ? 'var(--bg-raised)' : 'var(--bg-surface)',
                  }}
                  onMouseEnter={() => linkId && setActiveId(linkId)}
                  onMouseLeave={() => setActiveId((cur) => (cur === linkId ? null : cur))}
                >
                  <div className="flex h-14 items-end justify-start rounded-sm border border-soft bg-sunken p-1">
                    <span className="font-mono text-[9px] tracking-wider text-fg-faint">{shot.shotType.toUpperCase()}</span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-fg-muted">
                      <span className="font-medium text-fg">{shot.shotId}</span>
                      <span className="text-fg-faint">·</span>
                      <span className="rounded border border-soft px-1.5 py-0.5 text-[9.5px] text-fg-muted">{shot.shotType.toUpperCase()}</span>
                      <span
                        className="ml-auto flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
                        style={{
                          color: shot.track === 'A' ? 'var(--agent)' : 'var(--fg-faint)',
                          background: shot.track === 'A' ? 'var(--agent-soft)' : 'var(--bg-sunken)',
                        }}
                      >
                        Track {shot.track}
                      </span>
                    </div>
                    <div className="truncate text-[12.5px] text-fg">{shot.action}</div>
                    <div className="flex flex-wrap gap-1">
                      {shot.anchorIds.length === 0 && (
                        <span className="font-mono text-[9.5px] text-fg-faint">no anchors</span>
                      )}
                      {shot.anchorIds.map((id) => (
                        <span key={id} className="rounded-sm border border-soft bg-sunken px-1.5 py-0.5 font-mono text-[9.5px] text-fg-muted">
                          {anchors.find((a) => a.id === id)?.name ?? id}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {shots.length === 0 && (
              <EmptyState glyph="🎬" title="No shots yet" hint="run breakdown to extract them from the script" className="flex flex-1 flex-col items-center justify-center gap-2 text-center" />
            )}
          </div>
        </div>

        {/* ANCHORS */}
        <div className="flex min-h-0 flex-col pl-5">
          <div className="mb-3 flex items-center justify-between border-b border-soft pb-2.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fg-faint">Extracted anchors</span>
            <span className="font-mono text-[10.5px] text-fg-muted">{anchors.length - pendingAnchors} ready</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {anchorsError && (
              <p className="font-mono text-[10.5px] text-fg-faint">Couldn't load anchors: {anchorsError}</p>
            )}
            {anchors.map((a) => {
              const meta = anchorMeta(a);
              const ready = !!a.asset?.uri;
              const isStyle = a.kind === 'style';
              return (
                <div
                  key={a.id}
                  className="flex gap-2.5 rounded border p-2.5"
                  style={{
                    borderColor: 'var(--border-soft)',
                    background: isStyle ? 'var(--bg-sunken)' : 'var(--bg-surface)',
                  }}
                >
                  {!isStyle && (
                    <div
                      className="mt-px flex h-4 w-4 flex-none items-center justify-center rounded-[3px] border text-[10px]"
                      style={{
                        borderColor: ready ? 'var(--live)' : 'var(--border)',
                        background: ready ? 'var(--live-soft)' : 'transparent',
                        color: ready ? 'var(--live)' : 'var(--fg-faint)',
                      }}
                    >
                      {ready ? '✓' : ''}
                    </div>
                  )}
                  {isStyle && <span className="mt-px text-[12px]" style={{ color: 'var(--achievement)' }}>◆</span>}
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-[13.5px] font-medium" style={{ color: isStyle ? 'var(--achievement)' : undefined }}>
                        {a.name}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-faint">
                        {isStyle ? 'Style · locked' : a.kind}
                      </span>
                    </div>
                    {meta.description && (
                      <p className="text-[11px] leading-snug text-fg-muted">{meta.description}</p>
                    )}
                    <div className="mt-0.5 flex gap-2.5 font-mono text-[9.5px] text-fg-faint">
                      <span>{meta.seed != null ? <>seed <span className="tabular-nums text-fg-muted">{meta.seed}</span></> : 'no seed yet'}</span>
                      {!isStyle && <span>used in <span className="tabular-nums text-fg-muted">{anchorUsage.get(a.id) ?? 0}</span> shots</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            {anchors.length === 0 && !anchorsError && (
              <EmptyState glyph="◆" title="No anchors yet" hint="run breakdown to extract them" className="flex flex-1 flex-col items-center justify-center gap-2 text-center" />
            )}
          </div>

          <div className="flex-none space-y-1.5 border-t border-soft pt-3.5">
            <div className="flex justify-between font-mono text-[10.5px] text-fg-muted">
              <span>Anchors ready</span>
              <span className="tabular-nums text-fg">{anchors.length - pendingAnchors} / {anchors.length}</span>
            </div>
            <div className="flex justify-between font-mono text-[10.5px] text-fg-muted">
              <span>Track A (fal, this app)</span>
              <span className="tabular-nums text-fg">{trackACount} shots</span>
            </div>
            <div className="flex justify-between font-mono text-[10.5px] text-fg-muted">
              <span>Track B (handoff)</span>
              <span className="tabular-nums text-fg">{trackBCount} shots</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
