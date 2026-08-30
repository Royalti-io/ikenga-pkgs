// com.ikenga.studio · draft srcdoc builder (an approximation, never the frame)
//
// Extracted from Cell.tsx so the node canvas's live-HTML node (Plan 25
// rendering-ladder row 3) renders through the SAME path the Cell view's draft
// preview does, instead of inventing a second, weaker one. The rules below are
// the ones Cell.tsx has always stated; they did not change in the move.
//
// Everything about a draft is deliberately weaker than the rendered mp4, and
// the UI must say so rather than letting the two blur:
//   • srcdoc gets a NULL origin, so it cannot reach the fonts this pkg inlines
//     into its own document — the cell's real typefaces are simply not there
//     and headings fall back to a system face.
//   • The pkg CSP governs the child, so nothing remote loads.
//   • A relative URL has nothing to resolve against either — the draft is the
//     BUFFER, not the cell's directory — so a <link> stylesheet or an
//     <img src="./plate.png"> that the frame draws fine is simply absent here.
//   • `sandbox=""` (the ONLY sandbox value a caller may pair with this) means
//     no scripts, so a cell that animates or measures itself renders only its
//     static first paint. Never add `allow-scripts`, and never, under any
//     circumstance, `allow-same-origin`: the html this wraps is project data an
//     agent or a collaborator wrote, and the pane is not a trust boundary we
//     want to spend.
// What survives is what the buffer carries inline — its own <style>, its
// markup, a data: URI.
//
// The input is always a cell's REAL authored source, read through
// `storyboard.read_cell_content`. It is never interpolated prose: pasting a
// `prompt` (or any other free-text field) into markup would let
// `</div><script>…` in agent-authored project data become live markup.

// All three attribute quotings, because the placeholder below only earns its
// keep if it catches every anchor: a miss paints the broken-image glyph the
// placeholder exists to prevent. insertAnchor emits double quotes, but the
// editor is a plain HTML buffer a human (or a Chi) can hand-author.
const DRAFT_ANCHOR_IMG = /<img\b[^>]*\bdata-anchor=(?:"([^"]*)"|'([^']*)'|([^\s>]*))[^>]*>/gi;

// The same reasoning one step out. A plain <img src="./plate.png"> resolves
// against nothing here, so left alone it paints the very broken-image glyph the
// anchor placeholder exists to prevent — the frame draws it, the draft cannot.
// A data: URI is carried BY the buffer, so it does load and must be left be.
const DRAFT_IMG = /<img\b[^>]*>/gi;
const DRAFT_IMG_SRC = /\bsrc=(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i;

function draftPlaceholder(label: string): string {
  return `<span class="ikenga-draft-ph">&#9251; ${escapeHtml(label)}</span>`;
}

/** Escape the ONE thing that reaches this file as text rather than as markup:
 *  the label lifted out of an <img> attribute. Left raw, a crafted
 *  `src="x&quot;><script>…"` would reopen exactly the hole the placeholder is
 *  here to close. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildDraftDoc(html: string): string {
  // An anchor <img> carries no src until the render runner resolves it, so
  // leaving it be paints a broken-image glyph that exists in no real frame. A
  // labelled placeholder names what will land there instead of miming it.
  const body = html
    .replace(
      DRAFT_ANCHOR_IMG,
      (_m, dq: string | undefined, sq: string | undefined, uq: string | undefined) =>
        draftPlaceholder(dq || sq || uq || 'anchor'),
    )
    // Anchors are already spans by now, so this only sees the rest.
    .replace(DRAFT_IMG, (m) => {
      const s = DRAFT_IMG_SRC.exec(m);
      const src = (s?.[1] ?? s?.[2] ?? s?.[3] ?? '').trim();
      return /^data:/i.test(src) ? m : draftPlaceholder(src || 'image');
    });
  // No background/colour of our own: a cell styles its own full frame, so
  // inventing one here would paint a look the render does not produce. An
  // unstyled cell reading as browser-default is the truthful answer.
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>' +
    'html,body{margin:0;height:100%;background:transparent;}' +
    'body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}' +
    '.ikenga-draft-ph{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;' +
    'color:#b08340;border:1px dashed #7a5a2c;border-radius:6px;}' +
    '</style></head><body>' +
    body +
    '</body></html>'
  );
}
