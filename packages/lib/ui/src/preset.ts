import type { Extension } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, crosshairCursor, dropCursor } from '@codemirror/view';
import { foldGutter, indentOnInput, bracketMatching } from '@codemirror/language';
import { history } from '@codemirror/commands';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { highlightSelectionMatches, search } from '@codemirror/search';
import { lintGutter } from '@codemirror/lint';

import { loadLanguage } from './extensions/languages.js';
import { ikengaKeymapExtension } from './extensions/keymaps.js';
import { tokensTheme } from './theme/tokens-theme.js';
import type { Language } from './types.js';

export interface PresetOptions {
  language: Language;
  /** Adds the lint gutter extension. Wire when LSP/diagnostics are active. */
  lint?: boolean;
}

export async function createPreset(opts: PresetOptions): Promise<Extension[]> {
  const lang = await loadLanguage(opts.language);
  const base: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    foldGutter(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    autocompletion({ activateOnTyping: true }),
    search({ top: true }),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    tokensTheme(),
    lang,
    ikengaKeymapExtension(),
  ];
  if (opts.lint) base.push(lintGutter());
  return base;
}
