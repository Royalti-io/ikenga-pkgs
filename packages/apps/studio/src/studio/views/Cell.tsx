// com.ikenga.studio · Cell view
//
// Split editor/preview surface for one Cell — left pane is a CodeMirror 6
// editor from @ikenga/ui-lib loaded with the cell's HF HTML, right pane is a
// stub HyperFrames preview with a static narration scrubber. Reads `cellUid`
// from the shared store; when nothing is selected we render an empty state
// directing the user to pick a cell from the canvas.
//
// Visual contract: designs/cell-editor.html (Round 8). The toolbar (folder
// path, beat / rung / block chips, Anchors, Narration, Render button with
// lifecycle states), the optional render-progress bar, the anchor drawer,
// and the narration scrubber under the preview all match the design.
//
// What's NOT real yet (in scope for commit 12 — cross-link + real MCP):
// - The Render button simulates the queued→running→done lifecycle locally;
//   commit 12 swaps that to `composition.render` over the MCP mock then real
//   MCP at Wave 2.
// - The narration scrubber's `activeWordIdx` is static per cell; commit 12
//   subscribes to `playheadMs` and drives the highlight via word timing.
// - The preview pane renders a hand-coded mock of the HF output, not an
//   actual @hyperframes/player iframe. P2 work.
// - The Anchors drawer is for show — clicking an anchor doesn't insert
//   `<img data-anchor="…">` into the editor yet. Commit 12 wires the
//   anchor-insert extension from @ikenga/ui-lib/extensions.

import { useEffect, useMemo, useRef, useState } from 'react';

import { CodeEditor, type CodeEditorHandle } from '@ikenga/ui-lib';

import {
  getCellByUid,
  getCellHtml,
  getNarrationExcerpt,
  MOCK_ANCHORS,
  type CellColor,
  type MockCell,
} from '../__mocks__/cells';
import { selectCellUid, useSharedStore } from '../shared-state';
import { useProjectStore, selectOpenProject } from '../project-store';
import type { Rung, AspectRatio } from '../mcp-types';
import { EmptyState } from '../components/EmptyState';
import { SafeZoneBands } from '../media-controls';

// ─── Tag palette (mirrors the design's per-color rings) ─────────────────

const PILL_RING: Record<CellColor, string> = {
  amber:   'text-[var(--achievement)] ring-[color-mix(in_oklab,var(--achievement)_40%,transparent)] bg-[color-mix(in_oklab,var(--achievement)_15%,transparent)]',
  rose:    'text-[var(--danger)] ring-[color-mix(in_oklab,var(--danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--danger)_15%,transparent)]',
  emerald: 'text-[var(--success,#3dab7f)] ring-[color-mix(in_oklab,var(--success,#3dab7f)_40%,transparent)] bg-[color-mix(in_oklab,var(--success,#3dab7f)_15%,transparent)]',
  sky:     'text-[var(--info,#5bb3e0)] ring-[color-mix(in_oklab,var(--info,#5bb3e0)_40%,transparent)] bg-[color-mix(in_oklab,var(--info,#5bb3e0)_15%,transparent)]',
  violet:  'text-[var(--agent)] ring-[color-mix(in_oklab,var(--agent)_40%,transparent)] bg-[color-mix(in_oklab,var(--agent)_15%,transparent)]',
  neutral: 'text-fg-muted ring-[var(--border)] bg-raised',
};

const ANCHOR_DOT: Record<CellColor, string> = {
  amber:   'bg-[var(--achievement)]',
  rose:    'bg-[var(--danger)]',
  emerald: 'bg-[var(--success,#3dab7f)]',
  sky:     'bg-[var(--info,#5bb3e0)]',
  violet:  'bg-[var(--agent)]',
  neutral: 'bg-fg-muted',
};

const RUNG_LABEL: Record<Rung, string> = {
  '2_hifi':       'hifi',
  '1_lofi':       'lofi',
  '0_beat_sheet': 'beat sheet',
};

const RUNG_DIR: Record<Rung, string> = {
  '2_hifi':       'hifi',
  '1_lofi':       'lofi',
  '0_beat_sheet': 'beatsheet',
};

function cellPath(cell: MockCell): string {
  return `cells/${RUNG_DIR[cell.rung]}/${cell.uid}/content.html`;
}

// Project.aspect_ratio → the preview frame's source resolution + box style
// (contract §8 commit-14). Portrait / square derive width from height via
// aspect-ratio so a 9:16 project's preview is a real vertical frame.
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

// ─── Render lifecycle (local simulation) ────────────────────────────────
//
// Wired to the toolbar's Render button until commit 12 swaps to
// `composition.render` over the MCP. Cancels cleanly on unmount + on
// cellUid change (so switching cells mid-render doesn't leak the timer).

type RenderState = 'idle' | 'queued' | 'running' | 'done' | 'failed';

function useRenderLifecycle(cellUid: string | null) {
  const [state, setState] = useState<RenderState>('idle');
  const [progress, setProgress] = useState(0);
  const timersRef = useRef<{ kick?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval> }>({});

  function cancel() {
    if (timersRef.current.kick) clearTimeout(timersRef.current.kick);
    if (timersRef.current.tick) clearInterval(timersRef.current.tick);
    timersRef.current = {};
  }

  function trigger() {
    if (state === 'queued' || state === 'running') return;
    cancel();
    setState('queued');
    setProgress(0);
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
  }

  // Reset whenever the selected cell changes.
  useEffect(() => {
    cancel();
    setState('idle');
    setProgress(0);
    return cancel;
  }, [cellUid]);

  return { state, progress, trigger };
}

// ─── View ───────────────────────────────────────────────────────────────

export function CellView() {
  const cellUid = useSharedStore(selectCellUid);
  const project = useProjectStore(selectOpenProject);
  const cell = useMemo(() => getCellByUid(cellUid), [cellUid]);

  const initialHtml = useMemo(() => getCellHtml(cellUid), [cellUid]);
  const [value, setValue] = useState(initialHtml);
  useEffect(() => setValue(initialHtml), [initialHtml]);

  const [anchorDrawerOpen, setAnchorDrawerOpen] = useState(false);
  const editorRef = useRef<CodeEditorHandle>(null);
  const { state: renderState, progress: renderProgress, trigger: triggerRender } =
    useRenderLifecycle(cellUid);

  if (!cell) {
    return (
      <EmptyState
        glyph="▤"
        title="No cell selected"
        hint="pick a cell on the Canvas pane to edit it here"
      />
    );
  }

  const narration = getNarrationExcerpt(cellUid);
  const path = cellPath(cell);
  const aspect: AspectRatio = project?.aspect_ratio ?? '16:9';
  const isPortrait = aspect === '9:16';

  return (
    <div className="flex h-full min-h-0 flex-col bg-base text-fg">
      {/* toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-soft bg-sunken px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-2 text-fg-muted">
          <span className="font-mono">{path}</span>
          <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset ${PILL_RING[cell.color]}`}>
            {cell.beat}
          </span>
          <span className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted ring-1 ring-inset ring-[var(--border)] bg-raised">
            {RUNG_LABEL[cell.rung]}
          </span>
          {cell.block_id && (
            <>
              <span className="text-fg-faint">·</span>
              <span className="text-fg-faint">block</span>
              <span className="font-mono text-fg">{cell.block_id}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAnchorDrawerOpen((o) => !o)}
            className={
              'flex items-center gap-1.5 rounded px-2 py-1 ' +
              (anchorDrawerOpen
                ? 'bg-raised text-fg'
                : 'text-fg-muted hover:bg-raised hover:text-fg')
            }
          >
            <span>✦ Anchors</span>
            <span className="font-mono text-[10px] text-fg-faint">{MOCK_ANCHORS.length}</span>
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded px-2 py-1 text-fg-muted hover:bg-raised hover:text-fg"
            title="Narration (stub — wired in commit 12)"
          >
            <span>▸ Narration</span>
          </button>
          <button
            type="button"
            onClick={triggerRender}
            disabled={renderState === 'queued' || renderState === 'running'}
            className={
              'flex items-center gap-1.5 rounded px-2 py-1 ring-1 ring-inset ' +
              (renderState === 'idle'
                ? 'bg-[color-mix(in_oklab,var(--achievement)_18%,transparent)] text-[var(--achievement)] ring-[color-mix(in_oklab,var(--achievement)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--achievement)_28%,transparent)]'
                : renderState === 'queued'
                ? 'cursor-wait bg-raised text-fg-muted ring-[var(--border)]'
                : renderState === 'running'
                ? 'cursor-wait bg-[color-mix(in_oklab,var(--info,#5bb3e0)_18%,transparent)] text-[var(--info,#5bb3e0)] ring-[color-mix(in_oklab,var(--info,#5bb3e0)_40%,transparent)]'
                : renderState === 'done'
                ? 'bg-[color-mix(in_oklab,var(--success,#3dab7f)_18%,transparent)] text-[var(--success,#3dab7f)] ring-[color-mix(in_oklab,var(--success,#3dab7f)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--success,#3dab7f)_28%,transparent)]'
                : 'bg-[color-mix(in_oklab,var(--danger)_18%,transparent)] text-[var(--danger)] ring-[color-mix(in_oklab,var(--danger)_40%,transparent)]')
            }
          >
            {renderState === 'idle' && <span>▶ Render</span>}
            {renderState === 'queued' && <span>● Queued…</span>}
            {renderState === 'running' && <span>● Rendering {Math.round(renderProgress * 100)}%</span>}
            {renderState === 'done' && <span>✓ Done · re-render</span>}
            {renderState === 'failed' && <span>! Failed</span>}
          </button>
        </div>
      </div>

      {/* render-progress bar */}
      {(renderState === 'running' || renderState === 'queued') && (
        <div className="h-0.5 bg-sunken">
          <div
            className="h-full bg-[var(--info,#5bb3e0)] transition-all duration-200"
            style={{ width: `${renderState === 'queued' ? 2 : renderProgress * 100}%` }}
          />
        </div>
      )}

      {/* anchor drawer */}
      {anchorDrawerOpen && (
        <div className="border-b border-soft bg-surface px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
              project anchors · drag into editor or click to insert
            </div>
            <button
              type="button"
              onClick={() => setAnchorDrawerOpen(false)}
              className="text-[11px] text-fg-faint hover:text-fg"
            >
              close
            </button>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {MOCK_ANCHORS.map((a) => (
              <button
                type="button"
                key={a.id}
                className="rounded border border-[var(--border)] bg-base p-2 text-left hover:border-[var(--border-soft)] hover:bg-raised"
                title="Insert wiring lands in commit 12"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${ANCHOR_DOT[a.color]}`} />
                  <span className="font-mono text-[10px] text-fg">{a.id}</span>
                </div>
                <div className="truncate text-[10px] text-fg">{a.name}</div>
                <div className="font-mono text-[9px] text-fg-faint">{a.kind}</div>
              </button>
            ))}
            <div className="flex items-center justify-center rounded border border-dashed border-[var(--border)] bg-base p-2 text-[11px] text-fg-faint">
              + new
            </div>
          </div>
          <div className="mt-2 text-[10px] text-fg-faint">
            Inserts <span className="font-mono text-fg-muted">{'<img data-anchor="a01" src="…"/>'}</span> at cursor.
            Adapter resolves at render — HF uses URI, Remotion uses staticFile(), AI adapters pass as reference upload.
          </div>
        </div>
      )}

      {/* editor + preview split */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col border-r border-soft bg-sunken">
          <CodeEditor
            ref={editorRef}
            value={value}
            onChange={setValue}
            language="html"
            ariaLabel={`Cell ${cell.uid} HTML editor`}
            className="h-full min-h-0 flex-1"
          />
        </div>
        <div className="flex w-[42%] min-h-0 flex-col bg-surface">
          <div className="flex items-center justify-between border-b border-soft px-3 py-1.5 text-[11px] text-fg-muted">
            <span className="font-mono">preview · {ASPECT_RES[aspect]} → {aspect}</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-fg-faint">1.2s</span>
              <div className="h-1 w-24 overflow-hidden rounded-full bg-raised">
                <div className="h-full bg-[var(--achievement)]" style={{ width: '37%' }} />
              </div>
              <span className="font-mono text-fg-faint">3.2s</span>
            </div>
          </div>
          {/* preview stage — outer is neutral chrome; the aspect-framed inner
              box is the engine "video surface" (tokenized bg, was #1a1a2e §5)
              and carries the 9:16 safe-zone bands (contract §8 commit-14). */}
          <div className="grid flex-1 place-items-center bg-base p-3">
            <div
              className="relative flex items-center justify-center overflow-hidden rounded-sm bg-sunken"
              style={previewFrameStyle(aspect)}
            >
              {isPortrait && <SafeZoneBands />}
              {/* Hand-coded mock of the HF output. Real @hyperframes/player iframe is P2. */}
              <h1 className="px-4 text-center text-4xl font-extrabold tracking-tight text-white">
                <span className="opacity-30">most</span>{' '}
                <span className="opacity-30">labels</span>{' '}
                <span className="opacity-30">still</span>{' '}
                <span className="text-[var(--achievement)]">treat</span>{' '}
                <span className="opacity-30">retention</span>
              </h1>
            </div>
          </div>
          {narration && (
            <div className="border-t border-soft bg-surface px-3 py-2 text-[11px] text-fg-muted">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[var(--achievement)]">▸</span>
                <span className="font-mono text-fg-faint">narration_excerpt</span>
              </div>
              <div className="leading-relaxed">
                {narration.text.split(/(\s+)/).map((tok, i) => {
                  if (/^\s+$/.test(tok)) return tok;
                  const wordIdx = narration.text
                    .slice(0, narration.text.indexOf(tok) + tok.length)
                    .split(/\s+/).length - 1;
                  const active = wordIdx === narration.activeWordIdx;
                  return (
                    <span
                      key={`${i}-${tok}`}
                      className={active ? 'font-medium text-[var(--achievement)]' : 'opacity-60'}
                    >
                      {tok}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
