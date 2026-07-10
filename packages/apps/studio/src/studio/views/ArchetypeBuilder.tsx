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
// What's NOT real yet: `archetype.save_custom` is the mock MCP client;
// per-block bindings are read-only (P1 — archetype-builder.md §"Gaps").

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
  BASE_ARCHETYPES,
  BASE_ARCHETYPE_LABEL,
  KIND_ACCENT,
  KIND_LABEL,
  LIBRARY,
  LIBRARY_KIND_ORDER,
  chainViolatesRule,
  findLibraryBlock,
  instantiateChainBlock,
  presetChain,
  type BaseArchetypeId,
  type ChainBlock,
  type LibraryBlock,
} from '../__mocks__/archetype-builder';
import { getMcpClient, archetypeApi } from '../mcp-client';

// ─── Inline picker — the click-driven insert affordance ──────────────────

function InserterSelect({
  onPick,
  onCancel,
}: {
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
          const lib = findLibraryBlock(e.target.value);
          if (lib) onPick(lib);
        }}
        onBlur={onCancel}
      >
        <option value="" disabled>Pick a block…</option>
        {LIBRARY_KIND_ORDER.map((kind) => (
          <optgroup key={kind} label={KIND_LABEL[kind]}>
            {LIBRARY[kind].map((b) => (
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
  onPick,
}: {
  index: number;
  isAppend: boolean;
  onPick: (lib: LibraryBlock) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `gap-${index}` });
  const [open, setOpen] = useState(false);

  if (isAppend) {
    return (
      <div ref={setNodeRef} className="pt-1">
        {open ? (
          <InserterSelect
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
                : 'border-[var(--border-strong)] text-fg-faint hover:border-[var(--border)] hover:text-fg-muted')
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
  const accent = KIND_ACCENT[block.kind];
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
        + (isDragging ? 'opacity-40' : 'border-soft hover:border-[var(--border-strong)]')
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
            {KIND_LABEL[block.kind]}
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
  const accent = KIND_ACCENT[block.kind];
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

function OverlayGhost({ activeId, chain }: { activeId: string; chain: ChainBlock[] }) {
  if (activeId.startsWith('lib::')) {
    const lib = findLibraryBlock(activeId.slice(5));
    if (!lib) return null;
    const accent = KIND_ACCENT[lib.kind];
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
  const accent = KIND_ACCENT[block.kind];
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
        const accent = KIND_ACCENT[b.kind];
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

// ─── View ───────────────────────────────────────────────────────────────

export function ArchetypeBuilderView() {
  const [base, setBase] = useState<BaseArchetypeId>('explainer');
  const [chain, setChain] = useState<ChainBlock[]>(() => presetChain('explainer'));
  const [edited, setEdited] = useState(false);
  const [customName, setCustomName] = useState('product-explainer-30s');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [invalidMessage, setInvalidMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [libraryFilter, setLibraryFilter] = useState('');

  const invalidTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (invalidTimer.current) clearTimeout(invalidTimer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  function flashInvalid(reason: string) {
    setInvalidMessage(reason);
    if (invalidTimer.current) clearTimeout(invalidTimer.current);
    invalidTimer.current = setTimeout(() => setInvalidMessage(null), 3_000);
  }

  function commitChain(next: ChainBlock[]) {
    const reason = chainViolatesRule(next);
    if (reason) {
      flashInvalid(reason);
      return;
    }
    setInvalidMessage(null);
    setEdited(true);
    setChain(next);
  }

  function handleBaseChange(nextBase: BaseArchetypeId) {
    if (edited && !window.confirm(
      `Replace the current chain with the "${BASE_ARCHETYPE_LABEL[nextBase]}" preset? Unsaved changes will be lost.`,
    )) {
      return;
    }
    setBase(nextBase);
    setChain(presetChain(nextBase));
    setEdited(false);
    setInvalidMessage(null);
  }

  function insertAt(index: number, lib: LibraryBlock) {
    const next = [...chain];
    next.splice(index, 0, instantiateChainBlock(lib));
    commitChain(next);
  }

  function moveBy(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= chain.length) return;
    commitChain(arrayMove(chain, index, target));
  }

  function removeAt(index: number) {
    const next = chain.filter((_, i) => i !== index);
    commitChain(next);
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
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    if (activeIdStr.startsWith('lib::')) {
      const lib = findLibraryBlock(activeIdStr.slice(5));
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

  async function handleSave() {
    const client = await getMcpClient();
    const name = customName.trim() || 'product-explainer-30s';
    await archetypeApi.save_custom(client, {
      name,
      // The frozen schema's ArchetypeChainEntry is { block_id, bindings } —
      // mcp-client.ts's typed helper still carries the WP-02-era `chain:
      // string[]` shape (mcp-types.ts staleness, contract §6); reconciles at
      // the commit-16 schema swap alongside the rest of mcp-types.ts.
      chain: chain.map((b) => b.block_id),
      description: `Custom archetype built from ${base} — ${chain.length} blocks.`,
    });
    setSavedMessage(`Saved archetype "${name}"`);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedMessage(null), 4_000);
  }

  const total = useMemo(() => chain.reduce((s, b) => s + b.duration_ms, 0), [chain]);
  const filteredKinds = useMemo(() => {
    const q = libraryFilter.trim().toLowerCase();
    if (!q) return LIBRARY_KIND_ORDER;
    return LIBRARY_KIND_ORDER.filter((kind) =>
      LIBRARY[kind].some((b) => b.block_id.includes(q) || b.name.toLowerCase().includes(q)),
    );
  }, [libraryFilter]);

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
              onChange={(e) => handleBaseChange(e.target.value as BaseArchetypeId)}
            >
              {BASE_ARCHETYPES.map((id) => (
                <option key={id} value={id}>{BASE_ARCHETYPE_LABEL[id]}</option>
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
              onClick={handleSave}
              className="ml-2 flex items-center gap-1.5 rounded px-3 py-1 ring-1 ring-inset"
              style={{
                background: 'var(--beat-accent-amber-soft)',
                color: 'var(--beat-accent-amber)',
                borderColor: 'var(--beat-accent-amber-border)',
              }}
            >
              ✓ Save archetype
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

        {/* chain + library */}
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-auto bg-sunken/40 p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
              block chain
            </div>
            <SortableContext items={chain.map((b) => b.chainId)} strategy={verticalListSortingStrategy}>
              <div className="space-y-0">
                <GapZone index={0} isAppend={false} onPick={(lib) => insertAt(0, lib)} />
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
                      onPick={(lib) => insertAt(i + 1, lib)}
                    />
                  </div>
                ))}
                {chain.length === 0 && (
                  <div className="flex flex-col items-center gap-1 rounded border border-dashed border-[var(--border)] bg-base py-8 text-center text-xs text-fg-faint">
                    <span>Add blocks from the library to build your archetype</span>
                  </div>
                )}
              </div>
            </SortableContext>
          </div>

          {/* library sidebar */}
          <div className="w-64 shrink-0 overflow-y-auto border-l border-soft bg-surface p-3 text-sm">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
              block library
            </div>
            <input
              className="input mb-3 w-full"
              style={{ height: 26, fontSize: 'var(--text-body-sm)' }}
              placeholder="filter…"
              aria-label="Filter blocks"
              value={libraryFilter}
              onChange={(e) => setLibraryFilter(e.target.value)}
            />
            {filteredKinds.map((kind) => (
              <div key={kind} className="mb-3">
                <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] text-fg-faint">
                  <span>{KIND_LABEL[kind]}</span>
                  <span className="text-fg-faint/70">{LIBRARY[kind].length}</span>
                </div>
                <div className="space-y-1">
                  {LIBRARY[kind].map((b) => (
                    <LibraryTile key={b.block_id} block={b} />
                  ))}
                </div>
              </div>
            ))}
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
        {activeId ? <OverlayGhost activeId={activeId} chain={chain} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
