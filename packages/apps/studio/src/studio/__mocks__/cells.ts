// com.ikenga.studio · cells mock
//
// Stand-in for the storyboard slice the iframe will receive from the MCP
// server in commit 12. Lives under __mocks__/ so it gets deleted (or
// dramatically reduced) when the real MCP plumb-through lands. Every
// presentation-only field (color, progress, html) belongs here, not on the
// Cell entity in mcp-types.ts — those fields are the design's, not the
// schema's.
//
// Canvas.tsx imports MOCK_CELLS to lay out the beat × rung grid; Cell.tsx
// imports getCellByUid + SAMPLE_HTML to populate the editor + preview when a
// canvas selection drives the cell view.

import type { Rung } from '../mcp-types';

export type CellColor = 'amber' | 'rose' | 'emerald' | 'sky' | 'violet' | 'neutral';

export interface MockCell {
  uid: string;
  beat: string;
  rung: Rung;
  approved: boolean;
  color: CellColor;
  block_id?: string;
  /** present iff a render is in flight; bottom-edge progress bar + corner % */
  progress?: number;
}

export const MOCK_CELLS: MockCell[] = [
  { uid: 'c01', beat: 'hook',     rung: '2_hifi',       approved: true,  color: 'amber',   block_id: 'hook.stat'         },
  { uid: 'c02', beat: 'problem',  rung: '2_hifi',       approved: true,  color: 'rose',    block_id: 'beat.problem'      },
  { uid: 'c03', beat: 'agitate',  rung: '2_hifi',       approved: false, color: 'rose',    block_id: 'beat.agitate'      },
  { uid: 'c04', beat: 'solution', rung: '2_hifi',       approved: false, color: 'emerald', block_id: 'beat.solution', progress: 0.62 },
  { uid: 'c05', beat: 'proof',    rung: '2_hifi',       approved: false, color: 'sky',     block_id: 'beat.proof',    progress: 0.18 },
  { uid: 'c06', beat: 'cta',      rung: '2_hifi',       approved: false, color: 'violet',  block_id: 'cta.link'          },
  { uid: 'c07', beat: 'hook',     rung: '1_lofi',       approved: true,  color: 'neutral' },
  { uid: 'c08', beat: 'problem',  rung: '1_lofi',       approved: true,  color: 'neutral' },
  { uid: 'c09', beat: 'agitate',  rung: '1_lofi',       approved: true,  color: 'neutral' },
  { uid: 'c10', beat: 'hook',     rung: '0_beat_sheet', approved: true,  color: 'neutral' },
];

export function getCellByUid(uid: string | null): MockCell | null {
  if (!uid) return null;
  return MOCK_CELLS.find((c) => c.uid === uid) ?? null;
}

// ─── Sample HF HTML for the cell editor ─────────────────────────────────
//
// A handful of cells get full sample content (lifted from designs/cell-
// editor.html); the rest fall back to a small `// TODO` stub so the editor
// always loads with valid HTML. Commit 12 reads cells off disk via the MCP
// mock; this map is the bridge until then.

const FALLBACK_HTML = `<!doctype html>
<html>
<head>
  <style>
    body { margin: 0; background: var(--bg-base, #0a0a0b); color: var(--fg, #eee);
           font-family: 'Inter', sans-serif; }
    .stage { width: 100vw; height: 100vh; display: grid; place-items: center; }
  </style>
</head>
<body>
  <div class="stage" data-composition-id="$BEAT" data-duration="3000">
    <!-- TODO: author this cell. Wire blocks from the archetype-builder. -->
  </div>
</body>
</html>
`;

const SAMPLE_HTML_BY_UID: Record<string, string> = {
  c03: `<!doctype html>
<html>
<head>
  <style>
    body { margin: 0; background: #1a1a2e; font-family: 'Inter', sans-serif; color: #eee; }
    .stage { width: 100vw; height: 100vh; display: grid; place-items: center; }
    h1 { font-size: 84px; font-weight: 800; letter-spacing: -2px; }
    [data-word] { opacity: 0.3; transition: opacity 300ms; }
    [data-word][data-active] { opacity: 1; color: #fbbf24; }
  </style>
</head>
<body>
  <div class="stage" data-composition-id="agitate" data-duration="3200">
    <h1>
      <span data-word="most">most</span>
      <span data-word="labels">labels</span>
      <span data-word="still">still</span>
      <span data-word="treat">treat</span>
      <span data-word="retention">retention</span>
    </h1>
  </div>
</body>
</html>
`,
};

export function getCellHtml(uid: string | null): string {
  if (!uid) return FALLBACK_HTML;
  return SAMPLE_HTML_BY_UID[uid] ?? FALLBACK_HTML.replace('$BEAT', uid);
}

// ─── Narration excerpts (mock) ──────────────────────────────────────────
//
// Composition-level Narration words[] gets wired in commit 8 (Composition
// view). For the cell editor's static excerpt scrubber we just need the
// per-cell sentence + the word that's "active" at the current playhead.

export interface NarrationExcerpt {
  text: string;
  /** index into text.split(/\s+/) of the word the playhead is currently on */
  activeWordIdx: number;
}

const EXCERPTS: Record<string, NarrationExcerpt> = {
  c03: {
    text: 'And here\'s the problem [BEAT] — most labels still treat retention as an afterthought.',
    activeWordIdx: 6,
  },
};

export function getNarrationExcerpt(uid: string | null): NarrationExcerpt | null {
  if (!uid) return null;
  return EXCERPTS[uid] ?? null;
}

// ─── Anchors (mock) — pulled by the cell editor's anchor drawer ─────────

export interface MockAnchor {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio' | 'style';
  color: CellColor;
}

export const MOCK_ANCHORS: MockAnchor[] = [
  { id: 'a01', name: 'host-portrait', kind: 'image', color: 'amber'   },
  { id: 'a02', name: 'royalti-logo',  kind: 'image', color: 'sky'     },
  { id: 'a03', name: 'brand-pack',    kind: 'style', color: 'emerald' },
  { id: 'a04', name: 'theme-music',   kind: 'audio', color: 'violet'  },
  { id: 'a05', name: 'office-bg',     kind: 'video', color: 'rose'    },
];
