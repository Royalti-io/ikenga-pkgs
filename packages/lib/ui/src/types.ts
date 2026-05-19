import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { TsLspClient } from './lsp/ts-lsp-client.js';

export type Language = 'html' | 'tsx' | 'css' | 'json' | 'markdown';

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  language: Language;
  readOnly?: boolean;
  theme?: Extension;
  extensions?: Extension[];
  keymapExtensions?: Extension[];
  lspClient?: TsLspClient;
  documentUri?: string;
  onBlur?: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}

export interface CodeEditorHandle {
  focus(): void;
  insertAtCursor(text: string): void;
  getSelection(): { from: number; to: number; text: string };
  view(): EditorView | null;
}
