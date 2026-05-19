import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { linter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { hoverTooltip } from '@codemirror/view';
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from '@codemirror/view';

import type { TsLspClient, Diagnostic as LspDiagnostic, Position as LspPosition } from './ts-lsp-client.js';

export interface LspExtensionOptions {
  client: TsLspClient;
  documentUri: string;
  languageId: 'typescriptreact' | 'typescript' | 'html' | 'css' | 'json' | 'markdown';
  /** Debounce ms for didChange notifications. Default 50. */
  changeDebounceMs?: number;
}

const setDiagnosticsEffect = StateEffect.define<readonly CmDiagnostic[]>();
const diagnosticsField = StateField.define<readonly CmDiagnostic[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiagnosticsEffect)) return e.value;
    }
    return value;
  },
});

function posToOffset(doc: { line: (n: number) => { from: number; text: string } }, pos: LspPosition): number {
  const line = doc.line(pos.line + 1);
  return line.from + Math.min(pos.character, line.text.length);
}

function offsetToPos(state: EditorView['state'], offset: number): LspPosition {
  const line = state.doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

function lspDiagToCm(state: EditorView['state'], d: LspDiagnostic): CmDiagnostic {
  const from = posToOffset(state.doc, d.range.start);
  const to = posToOffset(state.doc, d.range.end);
  const severity =
    d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : d.severity === 3 ? 'info' : 'hint';
  return {
    from,
    to: Math.max(from, to),
    severity: severity as CmDiagnostic['severity'],
    message: d.message,
    source: d.source,
  };
}

export function createCodeMirrorLspExtension(opts: LspExtensionOptions): Extension {
  const { client, documentUri, languageId, changeDebounceMs = 50 } = opts;

  let version = 1;
  let opened = false;
  let lastSentText = '';
  let unsubDiagnostics: (() => void) | null = null;
  let changeTimer: ReturnType<typeof setTimeout> | null = null;

  const lifecyclePlugin = ViewPlugin.fromClass(
    class implements PluginValue {
      constructor(public view: EditorView) {
        const initialText = view.state.doc.toString();
        lastSentText = initialText;
        client.didOpen(documentUri, initialText, languageId);
        opened = true;
        unsubDiagnostics = client.onDiagnostics(documentUri, (diags) => {
          const v = this.view;
          v.dispatch({
            effects: setDiagnosticsEffect.of(diags.map((d) => lspDiagToCm(v.state, d))),
          });
        });
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (changeTimer) clearTimeout(changeTimer);
        const text = update.state.doc.toString();
        changeTimer = setTimeout(() => {
          if (text === lastSentText) return;
          version += 1;
          lastSentText = text;
          client.didChange(documentUri, version, text);
        }, changeDebounceMs);
      }

      destroy() {
        if (changeTimer) clearTimeout(changeTimer);
        unsubDiagnostics?.();
        unsubDiagnostics = null;
        if (opened) {
          client.didClose(documentUri);
          opened = false;
        }
      }
    },
  );

  async function completionSource(ctx: CompletionContext): Promise<CompletionResult | null> {
    const pos = offsetToPos(ctx.state, ctx.pos);
    const result = await client.completion(documentUri, pos);
    if (!result || result.items.length === 0) return null;
    const word = ctx.matchBefore(/[\w$]+/);
    return {
      from: word?.from ?? ctx.pos,
      to: ctx.pos,
      options: result.items.map((it) => ({
        label: it.label,
        detail: it.detail,
        info:
          typeof it.documentation === 'string'
            ? it.documentation
            : it.documentation?.value,
        apply: it.insertText ?? it.label,
      })),
      validFor: /^[\w$]*$/,
    };
  }

  const hover = hoverTooltip(async (view, pos) => {
    const result = await client.hover(documentUri, offsetToPos(view.state, pos));
    if (!result) return null;
    const content = Array.isArray(result.contents)
      ? result.contents.map((c) => (typeof c === 'string' ? c : (c as { value?: string }).value ?? '')).join('\n\n')
      : typeof result.contents === 'string'
        ? result.contents
        : (result.contents as { value: string }).value;
    return {
      pos,
      end: result.range ? posToOffset(view.state.doc, result.range.end) : pos,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cm-tooltip-lsp-hover';
        dom.style.maxWidth = '480px';
        dom.style.padding = '6px 10px';
        dom.style.whiteSpace = 'pre-wrap';
        dom.textContent = content;
        return { dom };
      },
    };
  });

  const diagnosticsLinter = linter((view) => view.state.field(diagnosticsField).slice());

  return [
    diagnosticsField,
    lifecyclePlugin,
    autocompletion({ override: [completionSource] }),
    hover,
    diagnosticsLinter,
  ];
}
