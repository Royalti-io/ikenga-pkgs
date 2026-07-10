// com.ikenga.studio · mock MCP client
//
// Canned responses for every tool namespace the iframe touches in P1. The
// data lines up with what WP-11's smoke fixture will eventually ship; until
// that fixture lands this file is the single source of truth for visual /
// interaction smoke during WP-07.
//
// The freeze line from 09 §"Mock contract" — adding or shape-shifting a
// response here is a mock-contract change. WP-06 (real MCP) must conform to
// the same shapes or formally bump this file alongside.
//
// Events: composition.render emits 3 setTimeout-driven render/progress
// (0.3 → 0.7 → 1.0) and one render/done. Subscribers registered before the
// call get all of them; subscribers registered mid-stream miss earlier
// frames — same semantics as the real WP-06 pkg-event bus, no replay.

import type {
  McpClient,
} from '../mcp-client';
import type {
  Project, Beat, Cell, Block, Archetype, RenderRecord,
  EngineCapability, StudioEventName, StudioEventPayloadMap,
} from '../mcp-types';

// ─── Fixture data ───────────────────────────────────────────────────────

const MOCK_PROJECT: Project = {
  project_id: 'mock-1',
  schema_version: 1,
  archetype_id: 'musicvideo',
  name: 'Untitled (mock)',
  aspect_ratio: '9:16',
  resolution: { w: 1080, h: 1920 },
  approved: false,
};

const MOCK_BEATS: Beat[] = [
  { id: 'b.hook',   label: 'Hook',   order: 1, duration_ms:  6000, status: 'pending' },
  { id: 'b.verse1', label: 'Verse 1', order: 2, duration_ms: 18000, status: 'pending' },
  { id: 'b.chorus', label: 'Chorus', order: 3, duration_ms: 12000, status: 'pending' },
  { id: 'b.bridge', label: 'Bridge', order: 4, duration_ms:  9000, status: 'pending' },
  { id: 'b.outro',  label: 'Outro',  order: 5, duration_ms:  6000, status: 'pending' },
  { id: 'b.cta',    label: 'CTA',    order: 6, duration_ms:  3000, status: 'pending' },
];

// 6 cells, one per beat, mixed rungs per the 09 mock contract.
const MOCK_CELLS: Cell[] = [
  { uid: 'c.hook.h',    beat_id: 'b.hook',   rung: '2_hifi',       approved: true,  shot_type: 'cu',  text: 'Eye-level on talent — vinyl spinning bg, gold sparks.' },
  { uid: 'c.verse1.l',  beat_id: 'b.verse1', rung: '1_lofi',       approved: false, shot_type: 'ws',  text: 'Wide of studio loft, sun raking through window blinds.' },
  { uid: 'c.chorus.h',  beat_id: 'b.chorus', rung: '2_hifi',       approved: false, shot_type: 'fs',  text: 'Full shot — talent on rooftop, city at golden hour, crane down.' },
  { uid: 'c.bridge.b',  beat_id: 'b.bridge', rung: '0_beat_sheet', approved: false,                  text: 'Quiet moment — close-up hands on console, dawn-blue lit.' },
  { uid: 'c.outro.l',   beat_id: 'b.outro',  rung: '1_lofi',       approved: false, shot_type: 'ms',  text: 'Talent walks away, frame holds on empty room.' },
  { uid: 'c.cta.b',     beat_id: 'b.cta',    rung: '0_beat_sheet', approved: false,                  text: 'Logo + drop date + handle. Hold 2s.' },
];

const MOCK_BLOCKS: Block[] = [
  { id: 'blk.intro_cu',       kind: 'beat',       name: 'Intro CU',        tags: ['music-video', 'opener'] },
  { id: 'blk.wide_establish', kind: 'beat',       name: 'Wide establish',  tags: ['music-video'] },
  { id: 'blk.chorus_drop',    kind: 'beat',       name: 'Chorus drop',     tags: ['music-video', 'energy'] },
  { id: 'blk.fade_to_white',  kind: 'transition', name: 'Fade → white',    tags: ['transition'] },
  { id: 'blk.cut_on_beat',    kind: 'transition', name: 'Cut on beat',     tags: ['transition', 'rhythm'] },
  { id: 'blk.thumb_sketch',   kind: 'sketch',     name: 'Thumb sketch',    tags: ['sketch', 'beat-sheet'] },
];

// The 7 P1 archetypes (designs/launcher.html's ARCHETYPES, minus the
// non-instantiable 'custom' gallery tile — Custom archetypes are built via
// the ArchetypeBuilder view + `archetype.save_custom`, not picked from this
// list). `chain` reuses the existing MOCK_BLOCKS ids loosely — the mock
// doesn't need every id to resolve to a real Block, only to be a plausible
// string[] per the frozen ArchetypeChainEntry shape.
const MOCK_ARCHETYPES: Archetype[] = [
  {
    id: 'explainer',
    name: 'Explainer',
    description: 'AV-script + narration. Fireship-style fast cuts. Hook → problem → agitate → solution → proof → cta.',
    chain: ['blk.intro_cu', 'blk.wide_establish', 'blk.chorus_drop', 'blk.cut_on_beat'],
  },
  {
    id: 'product',
    name: 'Product',
    description: 'Bring-your-own UI capture; benefit-led. Feature → benefit → demo → proof → cta.',
    chain: ['blk.wide_establish', 'blk.chorus_drop', 'blk.cut_on_beat'],
  },
  {
    id: 'ai-short',
    name: 'AI short',
    description: 'Anchor-locked identity/style, 1–3 beats. AI-gen adapters land in P3.',
    chain: ['blk.thumb_sketch'],
  },
  {
    id: 'narrative',
    name: 'Narrative',
    description: 'Reads .fountain natively; beat = scene. INT./EXT. scene headings render as scene cards.',
    chain: ['blk.thumb_sketch', 'blk.cut_on_beat'],
  },
  {
    id: 'montage',
    name: 'Montage',
    description: 'EDL-style cuts over source clips; cells reference source clips w/ in/out timecodes.',
    chain: ['blk.wide_establish', 'blk.cut_on_beat'],
  },
  {
    id: 'tutorial',
    name: 'Tutorial',
    description: 'Numbered steps + UI capture; voiceover per step.',
    chain: ['blk.intro_cu', 'blk.wide_establish'],
  },
  {
    id: 'musicvideo',
    name: 'Music video',
    description: 'Beats from BPM/onset analysis (studio-beat-detect). Hook → verse → chorus → bridge → outro → cta.',
    chain: ['blk.intro_cu', 'blk.wide_establish', 'blk.chorus_drop', 'blk.cut_on_beat'],
  },
];

const MOCK_ENGINES: EngineCapability[] = [
  {
    id: 'hf',
    aspect_ratios: ['16:9', '9:16', '1:1'],
    max_duration_ms: 60_000,
    supported_codecs: ['h264', 'h265'],
    requires_network: false,
  },
  {
    id: 'excalidraw',
    aspect_ratios: ['16:9', '9:16', '1:1'],
    max_duration_ms: 20_000,
    supported_codecs: ['h264'],
    requires_network: false,
  },
];

// ─── Event hub ──────────────────────────────────────────────────────────

type Handler = (payload: unknown) => void;
type EventHub = Map<StudioEventName, Set<Handler>>;

function makeHub(): EventHub {
  return new Map();
}

function subscribe<E extends StudioEventName>(
  hub: EventHub,
  event: E,
  handler: (payload: StudioEventPayloadMap[E]) => void,
): () => void {
  let set = hub.get(event);
  if (!set) {
    set = new Set();
    hub.set(event, set);
  }
  set.add(handler as Handler);
  return () => set?.delete(handler as Handler);
}

function emit<E extends StudioEventName>(
  hub: EventHub,
  event: E,
  payload: StudioEventPayloadMap[E],
): void {
  const set = hub.get(event);
  if (!set) return;
  // Snapshot before iterating — handlers may unsubscribe themselves.
  for (const h of Array.from(set)) {
    try { h(payload); } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[studio:mock] event handler threw', { event, err });
    }
  }
}

// ─── Tool dispatch ──────────────────────────────────────────────────────

let _recordCounter = 0;
const nextRecordId = () => `rec-${++_recordCounter}-${Date.now().toString(36)}`;

function callMockTool(
  hub: EventHub,
  name: string,
  args: Record<string, unknown>,
): unknown {
  switch (name) {
    // ─── project ───────────────────────────────────────────────────
    case 'project.open':   return { project_id: MOCK_PROJECT.project_id };
    case 'project.close':  return { closed: true };
    case 'project.list':   return { projects: [MOCK_PROJECT] };
    case 'project.create': return { project_id: MOCK_PROJECT.project_id };
    case 'project.info':   return MOCK_PROJECT;

    // ─── storyboard ────────────────────────────────────────────────
    case 'storyboard.read':
      return { project: MOCK_PROJECT, beats: MOCK_BEATS, cells: MOCK_CELLS };
    case 'storyboard.read_cell': {
      const uid = args.cell_uid as string;
      const cell = MOCK_CELLS.find((c) => c.uid === uid);
      if (!cell) throw new Error(`mock: cell ${uid} not found`);
      return cell;
    }
    case 'storyboard.write_cell': {
      const uid = args.cell_uid as string;
      const patch = (args.patch ?? {}) as Partial<Cell>;
      const idx = MOCK_CELLS.findIndex((c) => c.uid === uid);
      if (idx === -1) throw new Error(`mock: cell ${uid} not found`);
      MOCK_CELLS[idx] = { ...MOCK_CELLS[idx], ...patch } as Cell;
      // Mirror what WP-03's sidecar will publish on every write.
      queueMicrotask(() => emit(hub, 'cells/changed', {
        project_id: MOCK_PROJECT.project_id,
        changed_uids: [uid],
      }));
      return MOCK_CELLS[idx];
    }
    case 'storyboard.list_cells': {
      const beatId = args.beat_id as string | undefined;
      const rung   = args.rung as Cell['rung'] | undefined;
      const filtered = MOCK_CELLS.filter((c) =>
        (!beatId || c.beat_id === beatId)
        && (!rung   || c.rung   === rung),
      );
      return { cells: filtered };
    }
    case 'storyboard.set_approved': {
      const uid = args.cell_uid as string;
      const approved = !!args.approved;
      const idx = MOCK_CELLS.findIndex((c) => c.uid === uid);
      if (idx === -1) throw new Error(`mock: cell ${uid} not found`);
      MOCK_CELLS[idx] = { ...MOCK_CELLS[idx], approved };
      queueMicrotask(() => emit(hub, 'cells/changed', {
        project_id: MOCK_PROJECT.project_id,
        changed_uids: [uid],
      }));
      return { ok: true };
    }

    // ─── composition ───────────────────────────────────────────────
    case 'composition.render': {
      const cellUid = (args.cell_uid as string) ?? MOCK_CELLS[0].uid;
      const recordId = nextRecordId();
      // Emit 3 progress events + one done, on staggered timers, per the 09
      // mock contract (0.3 → 0.7 → 1.0).
      const ts = (frame: number, delay: number) => setTimeout(() => emit(hub, 'render/progress', {
        record_id: recordId, cell_uid: cellUid, frame,
      }), delay);
      ts(0.3,  400);
      ts(0.7,  900);
      ts(1.0, 1300);
      setTimeout(() => emit(hub, 'render/done', {
        record_id: recordId,
        cell_uid: cellUid,
        output_uri: `mock://renders/${recordId}.mp4`,
      }), 1400);
      return { record_id: recordId };
    }
    case 'composition.preview':  return { preview_uri: 'mock://preview/latest.png' };
    case 'composition.validate': return { valid: true, diagnostics: [] };

    // ─── render ────────────────────────────────────────────────────
    case 'render.list_engines': return { engines: MOCK_ENGINES };
    case 'render.status': {
      const recordId = args.record_id as string;
      const record: RenderRecord = {
        record_id: recordId, cell_uid: MOCK_CELLS[0].uid, rung: '2_hifi',
        engine: 'hf', status: 'done', frame: 1.0,
        output_uri: `mock://renders/${recordId}.mp4`,
      };
      return record;
    }
    case 'render.cancel': return { cancelled: true };
    case 'render.list':   return { records: [] };

    // ─── block ─────────────────────────────────────────────────────
    case 'block.list': {
      const kind = args.kind as Block['kind'] | undefined;
      const tags = (args.tags as string[] | undefined) ?? [];
      const filtered = MOCK_BLOCKS.filter((b) =>
        (!kind || b.kind === kind)
        && (tags.length === 0 || tags.some((t) => b.tags.includes(t))),
      );
      return { blocks: filtered };
    }
    case 'block.get': {
      const id = args.id as string;
      const blk = MOCK_BLOCKS.find((b) => b.id === id);
      if (!blk) throw new Error(`mock: block ${id} not found`);
      return blk;
    }
    case 'block.instantiate': {
      // Echo a synthetic beat + one cell so the archetype builder can render.
      const beat: Beat = { id: `b.mock-${Date.now()}`, label: 'New beat', order: 99, duration_ms: 6000 };
      const cell: Cell = {
        uid: `c.mock-${Date.now()}`, beat_id: beat.id, rung: '0_beat_sheet',
        approved: false, text: 'Inserted from block (mock).',
      };
      return { beat, cells: [cell] };
    }

    // ─── archetype ─────────────────────────────────────────────────
    case 'archetype.list': return { archetypes: MOCK_ARCHETYPES };
    case 'archetype.get': {
      const id = args.id as string;
      const arch = MOCK_ARCHETYPES.find((a) => a.id === id);
      if (!arch) throw new Error(`mock: archetype ${id} not found`);
      return arch;
    }
    case 'archetype.instantiate_into_project':
      return { beats: MOCK_BEATS, cells: MOCK_CELLS };
    case 'archetype.save_custom':
      return { archetype_id: `arch.custom-${Date.now()}` };

    // ─── export ────────────────────────────────────────────────────
    case 'export.compose':
      return {
        export_id: `exp-${Date.now()}`,
        export_path: 'mock://exports/latest.mp4',
      };
    case 'export.status': {
      const exportId = args.export_id as string;
      return {
        export_id: exportId, project_id: MOCK_PROJECT.project_id,
        status: 'done', output_uri: 'mock://exports/latest.mp4',
      };
    }
    case 'export.list': return { exports: [] };

    default:
      throw new Error(`[studio:mock] unimplemented MCP method: ${name}`);
  }
}

// ─── Public factory ─────────────────────────────────────────────────────

export function createMockMcpClient(): McpClient {
  const hub = makeHub();
  return {
    mode: 'mock',
    async callTool(name, args = {}) {
      // Resolve on a microtask so callers can't accidentally rely on
      // synchronous behaviour the real client doesn't offer.
      await Promise.resolve();
      return callMockTool(hub, name, args) as never;
    },
    subscribe(event, handler) {
      return subscribe(hub, event, handler);
    },
  };
}
