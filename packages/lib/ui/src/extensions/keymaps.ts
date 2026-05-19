import { keymap, type KeyBinding } from '@codemirror/view';
import { defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { completionKeymap } from '@codemirror/autocomplete';
import { foldKeymap } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';

export const ikengaBaseKeymap: readonly KeyBinding[] = [
  ...defaultKeymap,
  ...historyKeymap,
  ...searchKeymap,
  ...completionKeymap,
  ...foldKeymap,
  ...lintKeymap,
  indentWithTab,
];

export function ikengaKeymapExtension(extra: readonly KeyBinding[] = []): Extension {
  return keymap.of([...extra, ...ikengaBaseKeymap]);
}
