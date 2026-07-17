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
//
// Schema conformance (WP-07 commit 16, contract §6): Project / Cell / Block /
// Archetype / RenderRecord below are the real `@ikenga/studio-schema` output
// types (re-exported through ../mcp-types), not the old local draft. Two
// naming drifts the draft got wrong, fixed here:
//   - Project has no `project_id`/`name` — it's `slug`/`title`. The MCP-call
//     handle callers pass around (`project.open` etc.) is a separate opaque
//     string (`MOCK_PROJECT_ID` below), not a field read off the entity.
//   - RenderRecord's id field is `id`, not `record_id`, and it carries
//     `output: AssetRef` (not `output_uri: string`) — `record_id` stays a
//     local name only inside the render/progress|done EVENT payloads
//     (mcp-types.ts's RenderProgressEvent/RenderDoneEvent), which are
//     transport shapes the schema doesn't define at all.

import type {
  McpClient,
} from '../mcp-client';
import type {
  Project, Beat, Cell, Block, Archetype, RenderRecord,
  EngineCapability, StudioEventName, StudioEventPayloadMap,
} from '../mcp-types';

// ─── Fixture data ───────────────────────────────────────────────────────

/** Opaque MCP-call handle for the one open project. NOT a field on `Project`
 *  (the schema entity's own identity is `slug`) — this is what `project.open`
 *  / `.create` / `.info` etc. take/return as their `project_id` argument. */
const MOCK_PROJECT_ID = 'mock-1';

const NOW = '2026-07-10T00:00:00.000Z';

const MOCK_PROJECT: Project = {
  schema_version: 1,
  slug: MOCK_PROJECT_ID,
  title: 'Untitled (mock)',
  created_at: NOW,
  updated_at: NOW,
  mode: 'studio',
  archetype_id: 'musicvideo',
  aspect_ratio: '9:16',
  resolution: { w: 1080, h: 1920 },
  current_rung: 0,
  anchors: [],
  script: null,
  cells: [],
  narration: null,
  approved: false,
  metadata: {},
};

const MOCK_BEATS: Beat[] = [
  { id: 'b.hook',   label: 'Hook',   order: 1, duration_ms:  6000, status: 'pending' },
  { id: 'b.verse1', label: 'Verse 1', order: 2, duration_ms: 18000, status: 'pending' },
  { id: 'b.chorus', label: 'Chorus', order: 3, duration_ms: 12000, status: 'pending' },
  { id: 'b.bridge', label: 'Bridge', order: 4, duration_ms:  9000, status: 'pending' },
  { id: 'b.outro',  label: 'Outro',  order: 5, duration_ms:  6000, status: 'pending' },
  { id: 'b.cta',    label: 'CTA',    order: 6, duration_ms:  3000, status: 'pending' },
];

/** A fully-populated rung workflow triple, defaulted to 'pending' — nothing
 *  writes per-rung status in P1 (schema.ts's own note on BeatStatusSchema);
 *  the canvas reads `Cell.approved`, not this. */
function emptyRungs(): Cell['rungs'] {
  return {
    '0_beat_sheet': { status: 'pending' },
    '1_lofi': { status: 'pending' },
    '2_hifi': { status: 'pending' },
  };
}

/** Builds a schema-conformant Cell from the mock's presentation-era fields.
 *  `text` (the old draft's ad-hoc shot description) maps to the schema's
 *  `action` field (visual description) — the closest real slot for it. */
function mockCell(args: {
  uid: string; beat_id: string; rung: Cell['rung']; approved: boolean;
  shot_type?: Cell['shot_type']; text: string;
}): Cell {
  return {
    uid: args.uid,
    beat_id: args.beat_id,
    rung: args.rung,
    index: 0,
    label: args.beat_id,
    time: { start: 0, end: 0 },
    frames: { start: 0, end: 0 },
    narration_excerpt: null,
    shot_type: args.shot_type ?? 'unset',
    camera_move: 'unset',
    duration_ms: 0,
    prompt: '',
    anchors: [],
    action: args.text,
    renderer: 'auto',
    content_path: `cells/mock/${args.uid}/content.html`,
    notes: '',
    reference_layer: [],
    rungs: emptyRungs(),
    comments: [],
    approved: args.approved,
    last_edited: NOW,
    renders: [],
    metadata: {},
  };
}

// 6 cells, one per beat, mixed rungs per the 09 mock contract.
const MOCK_CELLS: Cell[] = [
  mockCell({ uid: 'c.hook.h',   beat_id: 'b.hook',   rung: '2_hifi',       approved: true,  shot_type: 'cu', text: 'Eye-level on talent — vinyl spinning bg, gold sparks.' }),
  mockCell({ uid: 'c.verse1.l', beat_id: 'b.verse1', rung: '1_lofi',       approved: false, shot_type: 'ws', text: 'Wide of studio loft, sun raking through window blinds.' }),
  mockCell({ uid: 'c.chorus.h', beat_id: 'b.chorus', rung: '2_hifi',       approved: false, shot_type: 'fs', text: 'Full shot — talent on rooftop, city at golden hour, crane down.' }),
  mockCell({ uid: 'c.bridge.b', beat_id: 'b.bridge', rung: '0_beat_sheet', approved: false,                  text: 'Quiet moment — close-up hands on console, dawn-blue lit.' }),
  mockCell({ uid: 'c.outro.l',  beat_id: 'b.outro',  rung: '1_lofi',       approved: false, shot_type: 'ms', text: 'Talent walks away, frame holds on empty room.' }),
  mockCell({ uid: 'c.cta.b',    beat_id: 'b.cta',    rung: '0_beat_sheet', approved: false,                  text: 'Logo + drop date + handle. Hold 2s.' }),
];

function mockBlock(args: {
  id: string; kind: Block['kind']; name: string; tags: string[];
}): Block {
  return {
    id: args.id,
    kind: args.kind,
    name: args.name,
    description: args.name,
    default_renderer: 'auto',
    template_path: `blocks/${args.id.replace(/\./g, '/')}/template.html`,
    parameters: [],
    tags: args.tags,
    metadata: {},
  };
}

const MOCK_BLOCKS: Block[] = [
  mockBlock({ id: 'blk.intro_cu',       kind: 'beat',       name: 'Intro CU',       tags: ['music-video', 'opener'] }),
  mockBlock({ id: 'blk.wide_establish', kind: 'beat',       name: 'Wide establish', tags: ['music-video'] }),
  mockBlock({ id: 'blk.chorus_drop',    kind: 'beat',       name: 'Chorus drop',    tags: ['music-video', 'energy'] }),
  mockBlock({ id: 'blk.fade_to_white',  kind: 'transition', name: 'Fade → white',   tags: ['transition'] }),
  mockBlock({ id: 'blk.cut_on_beat',    kind: 'transition', name: 'Cut on beat',    tags: ['transition', 'rhythm'] }),
  mockBlock({ id: 'blk.thumb_sketch',   kind: 'sketch',     name: 'Thumb sketch',   tags: ['sketch', 'beat-sheet'] }),
];

function mockArchetype(args: {
  id: string; name: string; description: string; blockIds: string[];
}): Archetype {
  return {
    id: args.id,
    name: args.name,
    description: args.description,
    builtin: true,
    chain: args.blockIds.map((block_id) => ({ block_id, bindings: {} })),
    metadata: {},
  };
}

// The 7 P1 archetypes (designs/launcher.html's ARCHETYPES, minus the
// non-instantiable 'custom' gallery tile — Custom archetypes are built via
// the ArchetypeBuilder view + `archetype.save_custom`, not picked from this
// list). `chain` reuses the existing MOCK_BLOCKS ids loosely — the mock
// doesn't need every id to resolve to a real Block, only to be a plausible
// `ArchetypeChainEntry[]` per the frozen schema (block_id + bindings, Round-2).
const MOCK_ARCHETYPES: Archetype[] = [
  mockArchetype({
    id: 'explainer',
    name: 'Explainer',
    description: 'AV-script + narration. Fireship-style fast cuts. Hook → problem → agitate → solution → proof → cta.',
    blockIds: ['blk.intro_cu', 'blk.wide_establish', 'blk.chorus_drop', 'blk.cut_on_beat'],
  }),
  mockArchetype({
    id: 'product',
    name: 'Product',
    description: 'Bring-your-own UI capture; benefit-led. Feature → benefit → demo → proof → cta.',
    blockIds: ['blk.wide_establish', 'blk.chorus_drop', 'blk.cut_on_beat'],
  }),
  mockArchetype({
    id: 'ai-short',
    name: 'AI short',
    description: 'Anchor-locked identity/style, 1–3 beats. AI-gen adapters land in P3.',
    blockIds: ['blk.thumb_sketch'],
  }),
  mockArchetype({
    id: 'narrative',
    name: 'Narrative',
    description: 'Reads .fountain natively; beat = scene. INT./EXT. scene headings render as scene cards.',
    blockIds: ['blk.thumb_sketch', 'blk.cut_on_beat'],
  }),
  mockArchetype({
    id: 'montage',
    name: 'Montage',
    description: 'EDL-style cuts over source clips; cells reference source clips w/ in/out timecodes.',
    blockIds: ['blk.wide_establish', 'blk.cut_on_beat'],
  }),
  mockArchetype({
    id: 'tutorial',
    name: 'Tutorial',
    description: 'Numbered steps + UI capture; voiceover per step.',
    blockIds: ['blk.intro_cu', 'blk.wide_establish'],
  }),
  mockArchetype({
    id: 'musicvideo',
    name: 'Music video',
    description: 'Beats from BPM/onset analysis (studio-beat-detect). Hook → verse → chorus → bridge → outro → cta.',
    blockIds: ['blk.intro_cu', 'blk.wide_establish', 'blk.chorus_drop', 'blk.cut_on_beat'],
  }),
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
    case 'project.open':   return { project_id: MOCK_PROJECT_ID };
    case 'project.close':  return { closed: true };
    case 'project.list':   return { projects: [MOCK_PROJECT] };
    case 'project.create': return { project_id: MOCK_PROJECT_ID };
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
        project_id: MOCK_PROJECT_ID,
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
        project_id: MOCK_PROJECT_ID,
        changed_uids: [uid],
      }));
      return { ok: true };
    }

    case 'storyboard.create_cell': {
      const cell = args.cell as Cell;
      MOCK_CELLS.push(cell);
      queueMicrotask(() => emit(hub, 'cells/changed', {
        project_id: MOCK_PROJECT_ID,
        changed_uids: [cell.uid],
      }));
      return { cell };
    }
    case 'storyboard.delete_cell': {
      const uid = args.cell_uid as string;
      const idx = MOCK_CELLS.findIndex((c) => c.uid === uid);
      if (idx !== -1) MOCK_CELLS.splice(idx, 1);
      queueMicrotask(() => emit(hub, 'cells/changed', {
        project_id: MOCK_PROJECT_ID,
        changed_uids: [uid],
      }));
      return { cellId: uid };
    }

    // ─── breakdown ─────────────────────────────────────────────────
    // breakdown.run is INERT in demo mode, and says so (plans/studio/19,
    // Round-2 defect #3).
    //
    // The verb's entire job is: read `<root>/script.fountain` from disk, and
    // write `[[tag]]`s back into it. In mock mode there is no project root and
    // no script file — the Breakdown view feeds itself `DEMO_FOUNTAIN`, a JS
    // template literal in a bundled module. It cannot be parsed from disk and
    // it cannot be written to. So there is no honest way to simulate this call.
    //
    // The previous mock pretended anyway: it reported `tagged: 6` and
    // `script_bytes: 1024` for a write that never happened (1024 was invented
    // outright), and the UI printed "6 tags written into the script" verbatim.
    // It also pushed 6 cells into MOCK_CELLS, so every other view silently grew
    // from 6 rows to 12. Both are gone.
    //
    // What's left is the truth: nothing happened, and here's why. Every count
    // is `null` — "not determined" — rather than a 0 that reads as a measurement.
    // A UI that switches on `outcome` gets `demo-inert` and has nothing numeric
    // to print, which is the intended outcome: it is impossible to render a
    // fabricated figure from this result.
    case 'breakdown.run': {
      return {
        outcome: 'demo-inert',
        // No board and no script were read, so no mode was ever chosen. Naming
        // one ('scaffold'/'retag') would be a guess about work that never ran.
        mode: null,
        dry_run: Boolean(args.dry_run),
        scenes: null,
        paragraphs: null,
        cell_count: null,
        planned: [],
        created: [],
        skipped: [],
        tagged: [],
        already_tagged: [],
        script_written: false,
        script_bytes: null,
        message:
          'Demo data — there is no project on disk, so there is no script.fountain to read '
          + 'or tag. Open a real project to run the breakdown.',
      };
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
      // Schema field is `id`, not `record_id` (contract §6 — record_id stays
      // a name local to the render/progress|done EVENT payloads above).
      const record: RenderRecord = {
        id: recordId, cell_uid: MOCK_CELLS[0].uid,
        engine: 'hf', variant: 'default', status: 'done',
        output: { uri: `mock://renders/${recordId}.mp4` },
        metadata: {},
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
      const cell = mockCell({
        uid: `c.mock-${Date.now()}`, beat_id: beat.id, rung: '0_beat_sheet',
        approved: false, text: 'Inserted from block (mock).',
      });
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
        export_id: exportId, project_id: MOCK_PROJECT_ID,
        status: 'done', output_uri: 'mock://exports/latest.mp4',
      };
    }
    case 'export.list': return { exports: [] };
    case 'export.read_bytes':
      // No real mp4 on disk in mock mode → empty bytes; the viewer falls back
      // to the poster/status preview.
      return { base64: '', mime: 'video/mp4', sizeBytes: 0, path: 'mock://exports/latest.mp4' };
    case 'export.check_bed': {
      const preset = (args.music_preset as string) ?? 'none';
      const byDesign = preset === 'none' || preset === 'silent';
      // No bundled beds in the fixture — ambient/upbeat report silent honestly.
      return { has_bed: false, will_be_silent: true, by_design: byDesign };
    }

    // ─── render bytes (no real mp4 in mock) ────────────────────────
    case 'render.read_bytes':
      return { base64: '', mime: 'video/mp4', sizeBytes: 0, path: 'mock://renders/latest.mp4' };
    case 'render.read_poster':
      // No real poster on disk in mock mode → empty bytes; the tile falls back
      // to the status-text preview.
      return { base64: '', mime: 'image/png', sizeBytes: 0, path: 'mock://renders/latest.png' };
    case 'render.list_posters': {
      // No real posters on disk in mock mode → every requested id reports
      // null, same honest fallback as the single-record read above.
      const recordIds = (args.record_ids as string[] | undefined) ?? [];
      return { posters: recordIds.map((recordId) => ({ recordId, b64: null as string | null })) };
    }

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
