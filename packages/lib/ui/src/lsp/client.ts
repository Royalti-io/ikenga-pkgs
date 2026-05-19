export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export interface LspTransport {
  send(msg: JsonRpcMessage): void;
  onMessage(handler: (msg: JsonRpcMessage) => void): () => void;
  dispose(): void;
}

export interface LspClient {
  initialize(rootUri: string | null, capabilities?: unknown): Promise<unknown>;
  notify(method: string, params: unknown): void;
  request<T = unknown>(method: string, params: unknown): Promise<T>;
  on<T = unknown>(method: string, handler: (params: T) => void): () => void;
  dispose(): void;
}

export function createLspClient(transport: LspTransport): LspClient {
  let nextId = 1;
  const pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  const notifyHandlers = new Map<string, Set<(params: unknown) => void>>();

  const off = transport.onMessage((msg) => {
    if ('id' in msg && msg.id != null && !('method' in msg)) {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if ('error' in msg && msg.error) entry.reject(msg.error);
      else entry.resolve((msg as JsonRpcResponse).result);
      return;
    }
    if ('method' in msg) {
      const handlers = notifyHandlers.get(msg.method);
      if (!handlers) return;
      for (const h of handlers) h(msg.params);
    }
  });

  return {
    async initialize(rootUri, capabilities) {
      return this.request('initialize', {
        processId: null,
        rootUri,
        capabilities: capabilities ?? {},
      });
    },
    notify(method, params) {
      transport.send({ jsonrpc: '2.0', method, params } as JsonRpcNotification);
    },
    request<T = unknown>(method: string, params: unknown): Promise<T> {
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, {
          resolve: (v) => resolve(v as T),
          reject,
        });
        transport.send({ jsonrpc: '2.0', id, method, params } as JsonRpcRequest);
      });
    },
    on<T = unknown>(method: string, handler: (params: T) => void): () => void {
      let set = notifyHandlers.get(method);
      if (!set) {
        set = new Set();
        notifyHandlers.set(method, set);
      }
      const wrapped = (p: unknown) => handler(p as T);
      set.add(wrapped);
      return () => {
        set?.delete(wrapped);
      };
    },
    dispose() {
      off();
      transport.dispose();
      for (const { reject } of pending.values()) reject(new Error('LspClient disposed'));
      pending.clear();
      notifyHandlers.clear();
    },
  };
}
