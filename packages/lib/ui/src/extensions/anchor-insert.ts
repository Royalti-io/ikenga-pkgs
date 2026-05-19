import { keymap, type KeyBinding, type Command } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

const ANCHOR_PATTERN = /data-anchor="a(\d+)"/g;

function nextAnchorId(doc: string): string {
  let max = 0;
  for (const match of doc.matchAll(ANCHOR_PATTERN)) {
    const n = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `a${String(max + 1).padStart(2, '0')}`;
}

export function insertAnchor(idOpt?: string): Command {
  return (view) => {
    const doc = view.state.doc.toString();
    const id = idOpt ?? nextAnchorId(doc);
    const sel = view.state.selection.main;
    const altText = sel.empty ? '' : doc.slice(sel.from, sel.to);
    const inserted = altText
      ? `<img data-anchor="${id}" src="" alt="${altText}"/>`
      : `<img data-anchor="${id}" src=""/>`;
    const srcAttrOffset = inserted.indexOf('src="') + 'src="'.length;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: inserted },
      selection: { anchor: sel.from + srcAttrOffset },
      userEvent: 'input.anchor',
    });
    view.focus();
    return true;
  };
}

export const anchorKeymap: readonly KeyBinding[] = [
  { key: 'Mod-i', run: insertAnchor() },
];

export function anchorInsertExtension(): Extension {
  return keymap.of([...anchorKeymap]);
}
