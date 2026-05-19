import type { LspClient } from './client.js';

export interface Position {
  line: number;
  character: number;
}
export interface Range {
  start: Position;
  end: Position;
}
export interface Diagnostic {
  range: Range;
  severity?: 1 | 2 | 3 | 4;
  code?: string | number;
  source?: string;
  message: string;
}
export interface TextDocumentContentChange {
  range?: Range;
  text: string;
}
export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: 'markdown' | 'plaintext'; value: string };
  insertText?: string;
  sortText?: string;
}
export interface CompletionList {
  isIncomplete: boolean;
  items: CompletionItem[];
}
export interface Hover {
  contents:
    | string
    | { kind: 'markdown' | 'plaintext'; value: string }
    | { language: string; value: string }
    | Array<unknown>;
  range?: Range;
}
export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: Diagnostic[];
}

export interface TsLspClient {
  initialize(rootUri: string | null): Promise<void>;
  didOpen(uri: string, text: string, languageId: 'typescriptreact' | 'typescript' | 'html' | 'css' | 'json' | 'markdown'): void;
  didChange(uri: string, version: number, text: string): void;
  didClose(uri: string): void;
  completion(uri: string, pos: Position): Promise<CompletionList | null>;
  hover(uri: string, pos: Position): Promise<Hover | null>;
  onDiagnostics(uri: string, cb: (diags: Diagnostic[]) => void): () => void;
  dispose(): void;
}

export function createTsLspClient(client: LspClient): TsLspClient {
  const diagnosticHandlers = new Map<string, Set<(diags: Diagnostic[]) => void>>();
  const initialized = (async () => {
    await client.initialize(null, {
      textDocument: {
        synchronization: { didSave: false, willSave: false, dynamicRegistration: false },
        completion: { completionItem: { snippetSupport: false } },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        publishDiagnostics: { relatedInformation: false },
      },
    });
    client.notify('initialized', {});
    client.on<PublishDiagnosticsParams>('textDocument/publishDiagnostics', (params) => {
      const handlers = diagnosticHandlers.get(params.uri);
      if (!handlers) return;
      for (const h of handlers) h(params.diagnostics);
    });
  })();

  return {
    async initialize() {
      await initialized;
    },
    didOpen(uri, text, languageId) {
      void initialized.then(() => {
        client.notify('textDocument/didOpen', {
          textDocument: { uri, languageId, version: 1, text },
        });
      });
    },
    didChange(uri, version, text) {
      void initialized.then(() => {
        client.notify('textDocument/didChange', {
          textDocument: { uri, version },
          contentChanges: [{ text }],
        });
      });
    },
    didClose(uri) {
      void initialized.then(() => {
        client.notify('textDocument/didClose', { textDocument: { uri } });
      });
    },
    async completion(uri, pos) {
      await initialized;
      const result = await client.request<CompletionList | CompletionItem[] | null>(
        'textDocument/completion',
        { textDocument: { uri }, position: pos },
      );
      if (!result) return null;
      if (Array.isArray(result)) return { isIncomplete: false, items: result };
      return result;
    },
    async hover(uri, pos) {
      await initialized;
      return client.request<Hover | null>('textDocument/hover', {
        textDocument: { uri },
        position: pos,
      });
    },
    onDiagnostics(uri, cb) {
      let set = diagnosticHandlers.get(uri);
      if (!set) {
        set = new Set();
        diagnosticHandlers.set(uri, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
      };
    },
    dispose() {
      diagnosticHandlers.clear();
      client.dispose();
    },
  };
}
