// com.ikenga.studio · ArchetypeBuilder view
//
// The block-chain editor (Screen S6 — plans/studio-design-system/parts/
// screens/archetype-builder.md). Visual bar: designs/archetype-builder.html
// (toolbar + two-column chain/library layout + mini timeline preview) +
// designs/archetype-builder-dnd.html (drag states — handle / lifted ghost /
// drop caret / reorder / invalid-drop / insert-between). Built on dnd-kit
// (`@dnd-kit/core` + `@dnd-kit/sortable`) per the WP-07 resume contract §8
// row 10.
//
// DATA TRUTH (Wave-3 real-hydration): the base-archetype dropdown and the
// block library are the REAL catalog. On mount we call:
//   • archetypeApi.list()  → base-archetype options (+ a synthetic "start
//                            blank"); picking one loads its chain via
//                            archetypeApi.get() (real archetype.json chain).
//   • blockApi.list()      → the library, grouped by the block's real `kind`.
//   • blockApi.get()       → per-block `default_duration_ms`, fetched lazily
//                            for the blocks in the current chain (bounded to
//                            chain length + cached) so the timeline preview /
//                            total clock reflect real durations. block.list
//                            carries no duration, so library tiles honestly
//                            show only the block id (the tile never displayed
//                            a duration).
// In standalone dev the client is the mock (__mocks__/mcp.ts) — a real seam,
// just canned. Only when BOTH list calls throw (or return empty) do we degrade
// to the offline presentation fixture (__mocks__/archetype-builder.ts), with a
// visible provenance note. The kind → accent/label maps, the chainId minting
// helper, and the transition-adjacency rule still come from that module — but
// the rule now validates REAL block kinds coming off the live catalog.
//
// Interaction model:
//  - The chain is a sortable list (drag handle + dnd-kit's keyboard sensor);
//    every row also exposes move-up/move-down buttons as the non-drag
//    reorder alternative (SC 2.5.7 — archetype-builder.md §"Accessibility").
//  - Library tiles are separately-draggable (`lib::<block_id>` ids) and drop
//    onto either a chain row (insert before it) or a "gap" zone between rows
//    (`gap-<index>`) — the same gap doubles as the click-driven "+ insert
//    block" / "+ add block" affordance (a `<select>` of the library, opened
//    on click) so the feature works without a pointer-drag at all.
//  - The transition-adjacency rule (archetype-builder.md §3: a transition
//    can't lead the chain or sit beside another transition) is validated
//    against the *candidate* full chain after every insert/reorder
//    (chainViolatesRule) — invalid mutations are rejected with an inline
//    rose message instead of a drag-time snap-back animation.
//
// Save closes archetype-builder-save-unhandled-rejection (try/catch +
// saving/saved/error states, buffer preserved on failure). "Save & apply to
// project…" closes archetype-builder-no-instantiate-into-project-affordance —
// it saves, then (behind a focus-trapped confirm, because the scaffold appends
// cells to disk) calls archetype.instantiate_into_project. Per-block bindings
// are still read-only (P1 — archetype-builder.md §"Gaps").

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { fmtClock } from '../lib/time';
import {
  KIND_ACCENT,
  KIND_LABEL,
  LIBRARY as FALLBACK_LIBRARY,
  chainViolatesRule,
  instantiateChainBlock,
  presetChain as fallbackPresetChain,
  BASE_ARCHETYPES as FALLBACK_BASES,
  BASE_ARCHETYPE_LABEL as FALLBACK_BASE_LABEL,
  type BlockKind,
  type ChainBlock,
  type LibraryBlock,
} from '../__mocks__/archetype-builder';
import { getMcpClient, blockApi, archetypeApi, type McpClient } from '../mcp-client';
import { EmptyState } from '../components/EmptyState';

// ─── Catalog model (real, mock, or offline-fixture) ──────────────────────

const BLANK_BASE = '__blank__';

/** Canonical kind order (all 9 block kinds, INCLUDING `sketch` — the fixture's
 *  LIBRARY_KIND_ORDER omitted it, which is exactly what made sketch blocks
 *  unreachable; driving the order off this list keeps every kind the catalog
 *  actually returns visible). Kinds present but not listed here are appended. */
const KIND_CANONICAL_ORDER: BlockKind[] = [
  'hook', 'beat', 'transition', 'narration_pattern', 'anchor_pack', 'sfx', 'music_preset', 'cta', 'sketch',
];

type CatalogSource = 'real' | 'mock' | 'fallback';

interface Catalog {
  library: Record<string, LibraryBlock[]>;
  kindOrder: string[];
  byId: Map<string, LibraryBlock>;
  bases: { id: string; label: string }[];
}

/** Beat-accent for a kind — falls back to sky for any kind the palette map
 *  doesn't know (a custom block could carry an unmapped kind). */
function accentFor(kind: string): string {
  return (KIND_ACCENT as Record<string, string>)[kind] ?? 'sky';
}
function labelFor(kind: string): string {
  return (KIND_LABEL as Record<string, string>)[kind] ?? kind.replace(/_/g, ' ');
}

/** name → archetype_id slug. */
function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'custom-archetype';
}

/** Normalize a `block.list` row (real: {block_id,kind,name,tags,source};
 *  mock schema Block: {id,kind,name,…}) into a LibraryBlock. Duration is not
 *  carried by list — enriched later via block.get. */
function toLibraryBlock(rb: Record<string, unknown>): LibraryBlock | null {
  const block_id = (rb.block_id ?? rb.id) as string | undefined;
  if (!block_id) return null;
  const dur = Number(rb.default_duration_ms ?? rb.duration_ms);
  return {
    block_id,
    kind: ((rb.kind as string) ?? 'beat') as BlockKind,
    name: ((rb.name as string) ?? block_id),
    duration_ms: Number.isFinite(dur) ? dur : 0,
  };
}

function buildCatalog(
  rawBlocks: Array<Record<string, unknown>>,
  rawArchetypes: Array<Record<string, unknown>>,
): Catalog {
  const library: Record<string, LibraryBlock[]> = {};
  const byId = new Map<string, LibraryBlock>();
  for (const rb of rawBlocks) {
    const lib = toLibraryBlock(rb);
    if (!lib) continue;
    (library[lib.kind] ??= []).push(lib);
    byId.set(lib.block_id, lib);
  }
  const present = Object.keys(library);
  const kindOrder = [
    ...KIND_CANONICAL_ORDER.filter((k) => library[k]?.length),
    ...present.filter((k) => !KIND_CANONICAL_ORDER.includes(k as BlockKind)).sort(),
  ];
  const bases = [
    ...rawArchetypes
      .map((a) => {
        const id = (a.id ?? a.archetype_id) as string | undefined;
        const name = (a.name ?? id) as string;
        const custom = a.builtin === false || a.source === 'custom';
        return id ? { id, label: `${name}${custom ? ' (custom)' : ''}` } : null;
      })
      .filter((b): b is { id: string; label: string } => b !== null),
    { id: BLANK_BASE, label: 'start blank' },
  ];
  return { library, kindOrder, byId, bases };
}

/** Offline presentation fixture → Catalog. Used only when the live list calls
 *  fail/return empty. Includes `sketch` in the kind order (canonical). */
function fallbackCatalog(): Catalog {
  const library: Record<string, LibraryBlock[]> = {};
  const byId = new Map<string, LibraryBlock>();
  for (const kind of Object.keys(FALLBACK_LIBRARY) as BlockKind[]) {
    library[kind] = FALLBACK_LIBRARY[kind];
    for (const b of FALLBACK_LIBRARY[kind]) byId.set(b.block_id, b);
  }
  const kindOrder = KIND_CANONICAL_ORDER.filter((k) => library[k]?.length);
  const bases = [
    ...FALLBACK_BASES.filter((id) => id !== 'blank').map((id) => ({ id, label: FALLBACK_BASE_LABEL[id] })),
    { id: BLANK_BASE, label: 'start blank' },
  ];
  return { library, kindOrder, byId, bases };
}

// ─── Inline picker — the click-driven insert affordance ──────────────────

function InserterSelect({
  library,
  kindOrder,
  onPick,
  onCancel,
}: {
  library: Record<string, LibraryBlock[]>;
  kindOrder: string[];
  onPick: (lib: LibraryBlock) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-soft bg-surface px-1.5 py-1 shadow-lg">
      <select
        autoFocus
        className="input"
        style={{ height: 22, fontSize: 'var(--text-micro)', padding: '0 4px' }}
        aria-label="Pick a block to insert"
        defaultValue=""
        onChange={(e) => {
          for (const kind of kindOrder) {
            const hit = (library[kind] ?? []).find((b) => b.block_id === e.target.value);
            if (hit) { onPick(hit); return; }
          }
        }}
        onBlur={onCancel}
      >
        <option value="" disabled>Pick a block…</option>
        {kindOrder.map((kind) => (
          <optgroup key={kind} label={labelFor(kind)}>
            {(library[kind] ?? []).map((b) => (
              <option key={b.block_id} value={b.block_id}>{b.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCancel}
        className="text-[10px] text-fg-faint hover:text-fg"
        aria-label="Cancel insert"
      >
        ✕
      </button>
    </div>
  );
}

// ─── Gap zone — drop target + click-to-insert, between rows / at the end ──

function GapZone({
  index,
  isAppend,
  library,
  kindOrder,
  onPick,
}: {
  index: number;
  isAppend: boolean;
  library: Record<string, LibraryBlock[]>;
  kindOrder: string[];
  onPick: (lib: LibraryBlock) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `gap-${index}` });
  const [open, setOpen] = useState(false);

  if (isAppend) {
    return (
      <div ref={setNodeRef} className="pt-1">
        {open ? (
          <InserterSelect
            library={library}
            kindOrder={kindOrder}
            onPick={(lib) => { onPick(lib); setOpen(false); }}
            onCancel={() => setOpen(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={
              'w-full rounded border border-dashed py-2 text-xs transition-colors '
              + (isOver
                ? 'border-[var(--beat-accent-sky)] bg-[var(--beat-accent-sky-soft)] text-[var(--beat-accent-sky)]'
                : 'border-soft text-fg-faint hover:border-[var(--border)] hover:text-fg-muted')
            }
          >
            + add block
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={setNodeRef} className="group/gap relative flex h-2 items-center justify-center">
      {open ? (
        <div className="absolute inset-x-0 z-10 flex justify-center">
          <InserterSelect
            library={library}
            kindOrder={kindOrder}
            onPick={(lib) => { onPick(lib); setOpen(false); }}
            onCancel={() => setOpen(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Insert a block at position ${index + 1}`}
          className={
            'flex items-center gap-1 text-[10px] opacity-0 transition-opacity '
            + 'group-hover/gap:opacity-100 focus-visible:opacity-100 '
            + (isOver ? 'text-[var(--beat-accent-sky)] opacity-100' : 'text-fg-faint hover:text-[var(--beat-accent-amber)]')
          }
        >
          + insert block
        </button>
      )}
    </div>
  );
}

// ─── Chain row (sortable) ──────────────────────────────────────────────────

function ChainRow({
  block,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  block: ChainBlock;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.chainId,
  });
  const accent = accentFor(block.kind);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        'group flex items-stretch rounded-md border bg-raised transition-shadow '
        + (isDragging ? 'opacity-40' : 'border-soft hover:border-[var(--border)]')
      }
    >
      <div
        className="w-1 shrink-0 rounded-l-md"
        style={{ background: `var(--beat-accent-${accent})` }}
        aria-hidden="true"
      />
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${block.block_id}`}
        className="flex cursor-grab items-center px-1.5 text-fg-faint hover:bg-sunken hover:text-fg-muted active:cursor-grabbing"
      >
        ⋮⋮
      </button>
      <div className="min-w-0 flex-1 py-2 pr-2">
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
          <span className="truncate font-mono text-xs font-medium text-fg">{block.block_id}</span>
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset"
            style={{
              color: `var(--beat-accent-${accent})`,
              background: `var(--beat-accent-${accent}-soft)`,
              borderColor: `var(--beat-accent-${accent}-border)`,
            }}
          >
            {labelFor(block.kind)}
          </span>
          {block.duration_ms > 0 && (
            <span className="font-mono text-[10px] text-fg-faint">{fmtClock(block.duration_ms)}</span>
          )}
        </div>
        {block.bindingsLabel && (
          <div className="truncate font-mono text-[10px] text-fg-faint">
            bindings: {block.bindingsLabel}
          </div>
        )}
      </div>
      <div className="flex items-center gap-0.5 pr-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          aria-label={`Move ${block.block_id} up`}
          className="rounded p-1 text-[11px] text-fg-faint hover:bg-sunken hover:text-fg disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          aria-label={`Move ${block.block_id} down`}
          className="rounded p-1 text-[11px] text-fg-faint hover:bg-sunken hover:text-fg disabled:opacity-30"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Remove ${block.block_id}`}
          className="rounded p-1 text-[11px] text-fg-faint hover:bg-sunken hover:text-[var(--danger)]"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── Library tile (draggable source) ───────────────────────────────────────

function LibraryTile({ block }: { block: LibraryBlock }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lib::${block.block_id}`,
  });
  const accent = accentFor(block.kind);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`Drag ${block.name} into the chain`}
      className={
        'flex cursor-grab items-center justify-between gap-1 rounded border px-2 py-1.5 text-[11px] active:cursor-grabbing '
        + (isDragging ? 'opacity-40' : 'hover:brightness-110')
      }
      style={{
        borderColor: `var(--beat-accent-${accent}-border)`,
        background: `var(--beat-accent-${accent}-soft)`,
        color: `var(--beat-accent-${accent})`,
      }}
    >
      <span className="truncate font-mono">{block.block_id}</span>
    </div>
  );
}

// ─── Drag overlay ghost ─────────────────────────────────────────────────────

function OverlayGhost({
  activeId,
  chain,
  resolveLib,
}: {
  activeId: string;
  chain: ChainBlock[];
  resolveLib: (id: string) => LibraryBlock | null;
}) {
  if (activeId.startsWith('lib::')) {
    const lib = resolveLib(activeId.slice(5));
    if (!lib) return null;
    const accent = accentFor(lib.kind);
    return (
      <div
        className="rounded-md border px-3 py-2 text-[11px] shadow-xl"
        style={{
          borderColor: `var(--beat-accent-${accent}-border)`,
          background: `var(--beat-accent-${accent}-soft)`,
          color: `var(--beat-accent-${accent})`,
        }}
      >
        {lib.name}
      </div>
    );
  }
  const block = chain.find((b) => b.chainId === activeId);
  if (!block) return null;
  const accent = accentFor(block.kind);
  return (
    <div
      className="flex items-center gap-2 rounded-md border bg-raised px-3 py-2 text-xs shadow-xl"
      style={{ borderColor: `var(--beat-accent-${accent}-border)` }}
    >
      <span className="font-mono font-medium text-fg">{block.block_id}</span>
    </div>
  );
}

// ─── Mini timeline preview (reuses .clip-segment / .timeline-rail) ─────────

function TimelinePreview({ chain }: { chain: ChainBlock[] }) {
  const total = chain.reduce((s, b) => s + b.duration_ms, 0);
  return (
    <div
      className="timeline-rail"
      style={{ height: '2rem', ['--total-ms' as string]: String(total || 1) }}
      role="img"
      aria-label={`Archetype duration preview: ${chain.map((b) => `${b.block_id} ${fmtClock(b.duration_ms)}`).join(', ')}`}
    >
      {chain.map((b) => {
        const accent = accentFor(b.kind);
        const flexBasis = b.duration_ms > 0 && total > 0
          ? `${(b.duration_ms / total) * 100}%`
          : '6px';
        return (
          <div
            key={b.chainId}
            className="clip-segment"
            data-accent={accent}
            style={{ flexBasis, minWidth: b.duration_ms > 0 ? undefined : '6px' }}
            aria-hidden="true"
          >
            {b.duration_ms > 0 && (
              <span className="clip-segment__label">{b.block_id.split('.')[1] ?? b.block_id}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Save-&-apply confirm dialog (focus-trapped, token scrim) ─────────────

const FOCUSABLE = 'button, [href], select, input, [tabindex]:not([tabindex="-1"])';

function ApplyConfirmDialog({
  open,
  blockCount,
  archetypeName,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  blockCount: number;
  archetypeName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const t = window.setTimeout(() => confirmRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
      if (e.key === 'Tab') {
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      restoreRef.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="comp-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div
        ref={dialogRef}
        className="comp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ab-apply-title"
        aria-describedby="ab-apply-sub"
      >
        <div className="comp-dialog__head">
          <h3 id="ab-apply-title" className="comp-dialog__title">Save &amp; apply to project</h3>
          <p id="ab-apply-sub" className="comp-dialog__sub">This writes to the open project’s storyboard.</p>
        </div>
        <div className="comp-dialog__body">
          <div
            role="status"
            className="flex gap-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed"
            style={{
              color: 'var(--beat-accent-amber)',
              background: 'var(--beat-accent-amber-soft)',
              borderColor: 'var(--beat-accent-amber-border)',
            }}
          >
            <span aria-hidden="true">⚠</span>
            <span>
              Saves <b>{archetypeName}</b> to the catalog, then scaffolds its{' '}
              <b>{blockCount} block{blockCount === 1 ? '' : 's'}</b> into the currently open project as
              new cells. Existing cells are kept — new cells are <b>appended</b>. This writes files to disk.
            </span>
          </div>
        </div>
        <div className="comp-dialog__foot">
          <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn-sm comp-btn-primary"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Applying…' : 'Save & scaffold'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── View ───────────────────────────────────────────────────────────────

export function ArchetypeBuilderView() {
  const clientRef = useRef<McpClient | null>(null);
  const durationCache = useRef<Map<string, number>>(new Map());

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogSource, setCatalogSource] = useState<CatalogSource>('mock');
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [base, setBase] = useState<string>('');
  const [chain, setChain] = useState<ChainBlock[]>([]);
  const [edited, setEdited] = useState(false);
  const [customName, setCustomName] = useState('product-explainer-30s');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [invalidMessage, setInvalidMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [libraryFilter, setLibraryFilter] = useState('');

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const invalidTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (invalidTimer.current) clearTimeout(invalidTimer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  // ── Duration enrichment (bounded to the chain, cached) ──────────────────
  async function enrichDurations(client: McpClient, blocks: ChainBlock[]): Promise<void> {
    const ids = [...new Set(blocks.map((b) => b.block_id))].filter((id) => !durationCache.current.has(id));
    if (ids.length === 0) return;
    const pairs = await Promise.all(ids.map(async (id) => {
      try {
        const body = (await blockApi.get(client, id)) as unknown as Record<string, unknown>;
        const ms = Number(body?.default_duration_ms ?? body?.duration_ms);
        return [id, Number.isFinite(ms) ? ms : 0] as const;
      } catch {
        return [id, 0] as const;
      }
    }));
    let changed = false;
    for (const [id, ms] of pairs) { durationCache.current.set(id, ms); if (ms > 0) changed = true; }
    if (!changed) return;
    setChain((prev) => prev.map((b) => {
      const ms = durationCache.current.get(b.block_id);
      return ms && ms !== b.duration_ms ? { ...b, duration_ms: ms } : b;
    }));
  }

  // ── Resolve a base archetype's chain (real archetype.get → fixture) ─────
  async function buildChainForBase(cat: Catalog, client: McpClient | null, baseId: string): Promise<ChainBlock[]> {
    if (baseId === BLANK_BASE) return [];
    let ids: string[] = [];
    if (client) {
      try {
        const arch = await archetypeApi.get(client, baseId);
        ids = (arch.chain ?? []).map((e) => e.block_id).filter(Boolean);
      } catch {
        ids = [];
      }
    }
    if (ids.length === 0) {
      // Offline / unknown id → the presentation fixture's preset (resolves only
      // for the fixture's own base ids; anything else yields an empty chain).
      ids = fallbackPresetChain(baseId as never).map((b) => b.block_id);
    }
    return ids.map((block_id) => {
      const known = cat.byId.get(block_id);
      const dur = durationCache.current.get(block_id) ?? known?.duration_ms ?? 0;
      const lib: LibraryBlock = known
        ? { ...known, duration_ms: dur }
        : { block_id, kind: 'beat', name: block_id, duration_ms: dur };
      return instantiateChainBlock(lib);
    });
  }

  async function applyBase(cat: Catalog, client: McpClient | null, baseId: string): Promise<void> {
    const next = await buildChainForBase(cat, client, baseId);
    setChain(next);
    setBase(baseId);
    setEdited(false);
    setInvalidMessage(null);
    if (client) void enrichDurations(client, next);
  }

  // ── Mount: hydrate the real catalog + load the first base's chain ───────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await getMcpClient();
        if (cancelled) return;
        clientRef.current = client;
        const [blkRes, archRes] = await Promise.all([
          blockApi.list(client),
          archetypeApi.list(client),
        ]);
        if (cancelled) return;
        const cat = buildCatalog(
          (blkRes.blocks ?? []) as unknown as Array<Record<string, unknown>>,
          (archRes.archetypes ?? []) as unknown as Array<Record<string, unknown>>,
        );
        if (cat.byId.size === 0) {
          // Live catalog came back empty — degrade to the offline fixture.
          const fb = fallbackCatalog();
          setCatalog(fb);
          setCatalogSource('fallback');
          setCatalogError('block.list returned no blocks');
          await applyBase(fb, null, fb.bases[0]?.id ?? BLANK_BASE);
          return;
        }
        setCatalog(cat);
        setCatalogSource(client.mode === 'real' ? 'real' : 'mock');
        const first = cat.bases.find((b) => b.id !== BLANK_BASE) ?? cat.bases[0];
        await applyBase(cat, client, first?.id ?? BLANK_BASE);
      } catch (e) {
        if (cancelled) return;
        const fb = fallbackCatalog();
        setCatalog(fb);
        setCatalogSource('fallback');
        setCatalogError((e as Error).message ?? 'catalog unavailable');
        await applyBase(fb, null, fb.bases[0]?.id ?? BLANK_BASE);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flashInvalid(reason: string) {
    setInvalidMessage(reason);
    if (invalidTimer.current) clearTimeout(invalidTimer.current);
    invalidTimer.current = setTimeout(() => setInvalidMessage(null), 3_000);
  }

  /** Commit a candidate chain if it passes the adjacency rule. Returns whether
   *  it committed (so callers can enrich only on success). */
  function commitChain(next: ChainBlock[]): boolean {
    const reason = chainViolatesRule(next);
    if (reason) {
      flashInvalid(reason);
      return false;
    }
    setInvalidMessage(null);
    setEdited(true);
    setChain(next);
    return true;
  }

  function baseLabelOf(id: string): string {
    return catalog?.bases.find((b) => b.id === id)?.label ?? id;
  }

  async function handleBaseChange(nextBase: string) {
    if (!catalog) return;
    if (edited && !window.confirm(
      `Replace the current chain with the "${baseLabelOf(nextBase)}" preset? Unsaved changes will be lost.`,
    )) {
      return;
    }
    await applyBase(catalog, clientRef.current, nextBase);
  }

  function insertAt(index: number, lib: LibraryBlock) {
    const withDur: LibraryBlock = { ...lib, duration_ms: durationCache.current.get(lib.block_id) ?? lib.duration_ms };
    const next = [...chain];
    next.splice(index, 0, instantiateChainBlock(withDur));
    if (commitChain(next) && clientRef.current) void enrichDurations(clientRef.current, next);
  }

  function moveBy(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= chain.length) return;
    commitChain(arrayMove(chain, index, target));
  }

  function removeAt(index: number) {
    commitChain(chain.filter((_, i) => i !== index));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || !catalog) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    if (activeIdStr.startsWith('lib::')) {
      const lib = catalog.byId.get(activeIdStr.slice(5));
      if (!lib) return;
      const insertIndex = overIdStr.startsWith('gap-')
        ? Number(overIdStr.slice(4))
        : Math.max(0, chain.findIndex((b) => b.chainId === overIdStr));
      insertAt(insertIndex, lib);
      return;
    }

    const fromIndex = chain.findIndex((b) => b.chainId === activeIdStr);
    if (fromIndex === -1) return;
    let toIndex = overIdStr.startsWith('gap-')
      ? Number(overIdStr.slice(4))
      : chain.findIndex((b) => b.chainId === overIdStr);
    if (toIndex === -1) return;
    // Gap indices are pre-removal positions; a drop past the dragged item's
    // own origin shifts left by one once it's spliced out.
    if (toIndex > fromIndex) toIndex -= 1;
    commitChain(arrayMove(chain, fromIndex, Math.max(0, Math.min(toIndex, chain.length - 1))));
  }

  function pushSaved(message: string) {
    setSavedMessage(message);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => { setSavedMessage(null); setSaveState('idle'); }, 4_000);
  }

  /** Persist the current chain as a custom archetype. Returns the archetype_id
   *  on success, null on failure (buffer is never touched, so the chain
   *  survives a failed save). Closes archetype-builder-save-unhandled-rejection. */
  async function handleSave(): Promise<string | null> {
    const name = customName.trim() || 'product-explainer-30s';
    const archetype_id = slugify(name);
    setSaveState('saving');
    setSaveError(null);
    try {
      const client = clientRef.current ?? (await getMcpClient());
      const res = await archetypeApi.save_custom(client, {
        archetype_id,
        name,
        chain: chain.map((b) => ({ block_id: b.block_id, bindings: {} })),
        description: `Custom archetype built from ${baseLabelOf(base)} — ${chain.length} blocks.`,
      });
      setSaveState('saved');
      pushSaved(`Saved archetype "${name}"`);
      return res.archetype_id ?? archetype_id;
    } catch (e) {
      setSaveState('error');
      setSaveError((e as Error).message ?? 'Save failed');
      return null;
    }
  }

  function requestApply() {
    if (chain.length === 0) { flashInvalid('Add at least one block before applying to the project.'); return; }
    setSaveError(null);
    setConfirmOpen(true);
  }

  /** Save, then scaffold into the open project. Closes
   *  archetype-builder-no-instantiate-into-project-affordance. */
  async function confirmApply() {
    setApplying(true);
    try {
      const id = await handleSave();
      if (!id) { setConfirmOpen(false); return; }  // save error already surfaced
      const client = clientRef.current ?? (await getMcpClient());
      const res = await archetypeApi.instantiate_into_project(client, { archetype_id: id, bindings: {} });
      const n = res.cells?.length ?? 0;
      setConfirmOpen(false);
      pushSaved(`Applied "${customName.trim() || id}" — ${n} cell${n === 1 ? '' : 's'} scaffolded into the project`);
    } catch (e) {
      setConfirmOpen(false);
      setSaveState('error');
      setSaveError(`Apply failed: ${(e as Error).message ?? 'instantiate error'}`);
    } finally {
      setApplying(false);
    }
  }

  const total = useMemo(() => chain.reduce((s, b) => s + b.duration_ms, 0), [chain]);

  const q = libraryFilter.trim().toLowerCase();
  const filteredKinds = useMemo(() => {
    if (!catalog) return [];
    if (!q) return catalog.kindOrder;
    return catalog.kindOrder.filter((kind) =>
      (catalog.library[kind] ?? []).some((b) => b.block_id.toLowerCase().includes(q) || b.name.toLowerCase().includes(q)),
    );
  }, [q, catalog]);

  const totalBlocks = catalog ? catalog.byId.size : 0;
  const sourceLabel =
    catalogSource === 'real' ? 'live catalog'
      : catalogSource === 'mock' ? 'mock catalog'
        : 'offline fixture';
  const busy = saveState === 'saving' || applying;

  const resolveLib = (id: string): LibraryBlock | null => catalog?.byId.get(id) ?? null;

  if (!catalog) {
    return (
      <div className="flex h-full items-center justify-center bg-base text-fg">
        <EmptyState glyph="⛓" title="Loading block catalog…" hint="reading block.list / archetype.list" />
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-base text-fg">
        {/* toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-soft bg-sunken px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-fg-faint">Base archetype</span>
            <select
              className="input"
              style={{ height: 24, fontSize: 'var(--text-body-sm)', padding: '0 6px' }}
              value={base}
              onChange={(e) => handleBaseChange(e.target.value)}
            >
              {catalog.bases.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
            <span className="text-fg-faint">·</span>
            <input
              className="input"
              style={{ height: 24, width: 200, fontSize: 'var(--text-body-sm)', padding: '0 6px' }}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="custom archetype name…"
              aria-label="Custom archetype name"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-fg-faint">total</span>
            <span className="font-mono text-[var(--beat-accent-amber)]" aria-live="polite">
              {fmtClock(total)}
            </span>
            <button
              type="button"
              onClick={requestApply}
              disabled={busy}
              className="ml-2 rounded px-2.5 py-1 text-fg-muted ring-1 ring-inset ring-[var(--border-soft)] hover:text-fg disabled:opacity-50"
            >
              Save &amp; apply to project…
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              aria-busy={saveState === 'saving'}
              className="flex items-center gap-1.5 rounded px-3 py-1 ring-1 ring-inset disabled:opacity-60"
              style={{
                background: 'var(--beat-accent-amber-soft)',
                color: 'var(--beat-accent-amber)',
                borderColor: 'var(--beat-accent-amber-border)',
              }}
            >
              {saveState === 'saving' ? '… Saving' : '✓ Save archetype'}
            </button>
          </div>
        </div>

        {invalidMessage && (
          <div
            role="alert"
            className="border-b px-3 py-1.5 text-[11px]"
            style={{
              color: 'var(--danger)',
              background: 'var(--beat-accent-rose-soft)',
              borderColor: 'var(--beat-accent-rose-border)',
            }}
          >
            ⚠ {invalidMessage}
          </div>
        )}

        {saveError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-[11px]"
            style={{
              color: 'var(--danger)',
              background: 'var(--beat-accent-rose-soft)',
              borderColor: 'var(--beat-accent-rose-border)',
            }}
          >
            <span>⚠ {saveError}</span>
            <button
              type="button"
              onClick={() => { setSaveError(null); setSaveState('idle'); }}
              className="text-fg-faint hover:text-fg"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {catalogSource === 'fallback' && (
          <div
            role="status"
            className="border-b px-3 py-1.5 text-[11px]"
            style={{
              color: 'var(--beat-accent-amber)',
              background: 'var(--beat-accent-amber-soft)',
              borderColor: 'var(--beat-accent-amber-border)',
            }}
          >
            ⚠ Showing the offline fixture catalog — the live block.list / archetype.list seams were unavailable
            {catalogError ? ` (${catalogError})` : ''}.
          </div>
        )}

        {/* chain + library */}
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-auto bg-sunken/40 p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
              block chain
            </div>
            <SortableContext items={chain.map((b) => b.chainId)} strategy={verticalListSortingStrategy}>
              <div className="space-y-0">
                <GapZone index={0} isAppend={false} library={catalog.library} kindOrder={catalog.kindOrder} onPick={(lib) => insertAt(0, lib)} />
                {chain.map((block, i) => (
                  <div key={block.chainId}>
                    <ChainRow
                      block={block}
                      isFirst={i === 0}
                      isLast={i === chain.length - 1}
                      onMoveUp={() => moveBy(i, -1)}
                      onMoveDown={() => moveBy(i, 1)}
                      onDelete={() => removeAt(i)}
                    />
                    <GapZone
                      index={i + 1}
                      isAppend={i === chain.length - 1}
                      library={catalog.library}
                      kindOrder={catalog.kindOrder}
                      onPick={(lib) => insertAt(i + 1, lib)}
                    />
                  </div>
                ))}
                {chain.length === 0 && (
                  <EmptyState
                    glyph="⛓"
                    title="No blocks yet"
                    hint="drag blocks from the library to build your archetype"
                    className="flex flex-col items-center gap-2 rounded border border-dashed border-[var(--border)] bg-base py-8 text-center"
                  />
                )}
              </div>
            </SortableContext>
          </div>

          {/* library sidebar */}
          <div className="w-64 shrink-0 overflow-y-auto border-l border-soft bg-surface p-3 text-sm">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-fg-faint">
              <span>block library</span>
              <span className="normal-case tracking-normal text-fg-faint/70" title="catalog provenance">
                {totalBlocks} · {sourceLabel}
              </span>
            </div>
            <div className="mb-2 text-[10px] leading-tight text-fg-faint/70">
              Adjacency rules validated client-side against real block kinds.
            </div>
            <input
              className="input mb-3 w-full"
              style={{ height: 26, fontSize: 'var(--text-body-sm)' }}
              placeholder="filter…"
              aria-label="Filter blocks"
              value={libraryFilter}
              onChange={(e) => setLibraryFilter(e.target.value)}
            />
            {filteredKinds.map((kind) => {
              const tiles = (catalog.library[kind] ?? []).filter(
                (b) => !q || b.block_id.toLowerCase().includes(q) || b.name.toLowerCase().includes(q),
              );
              if (tiles.length === 0) return null;
              return (
                <div key={kind} className="mb-3">
                  <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] text-fg-faint">
                    <span>{labelFor(kind)}</span>
                    <span className="text-fg-faint/70">{tiles.length}</span>
                  </div>
                  <div className="space-y-1">
                    {tiles.map((b) => (
                      <LibraryTile key={b.block_id} block={b} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* mini timeline preview */}
        <div className="border-t border-soft bg-sunken px-3 py-2">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
            timeline preview
          </div>
          <TimelinePreview chain={chain} />
        </div>

        {savedMessage && (
          <div
            className="fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border px-4 py-2.5 text-xs shadow-2xl"
            style={{
              borderColor: 'var(--beat-accent-emerald-border)',
              background: 'var(--bg-raised)',
              color: 'var(--beat-accent-emerald)',
            }}
            role="status"
          >
            ✓ {savedMessage}
          </div>
        )}
      </div>

      <DragOverlay>
        {activeId ? <OverlayGhost activeId={activeId} chain={chain} resolveLib={resolveLib} /> : null}
      </DragOverlay>

      <ApplyConfirmDialog
        open={confirmOpen}
        blockCount={chain.length}
        archetypeName={customName.trim() || 'product-explainer-30s'}
        busy={applying}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmApply}
      />
    </DndContext>
  );
}
