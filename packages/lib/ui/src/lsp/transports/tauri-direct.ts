/**
 * Tauri-direct LSP transport.
 *
 * Talks to the shell's `pkg_sidecar_rpc_send` Tauri command + the matching
 * `pkg://sidecar/<pkgId>/<name>/message` Tauri event. Use this transport
 * from shell-resident consumers (the artifact-studio source editor, any
 * shell-internal surface) — for iframe pkgs use the app-bridge transport.
 *
 * Dependency injection: this module deliberately doesn't import
 * `@tauri-apps/api` so `@ikenga/ui-lib` stays Tauri-agnostic and tree-shakes
 * cleanly in non-Tauri consumers. The shell passes pre-built `invoke` +
 * `listen` functions from its own `@tauri-apps/api` install.
 */

import type {
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  LspTransport,
} from '../client.js';

export type TauriInvoke = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;
export type TauriEventCallback<T> = (event: { payload: T }) => void;
export type TauriListen = <T = unknown>(
  event: string,
  handler: TauriEventCallback<T>,
) => Promise<() => void>;

export interface TauriDirectTransportOptions {
  invoke: TauriInvoke;
  listen: TauriListen;
  pkgId: string;
  sidecarName: string;
  /** Optional logger for transport-level errors. */
  onError?: (err: unknown) => void;
}

export function createTauriDirectTransport(
  opts: TauriDirectTransportOptions,
): LspTransport {
  const { invoke, listen, pkgId, sidecarName, onError } = opts;
  // Tauri events disallow `.`; match the shell's `pkg_sidecar_stream.rs`
  // substitution so the channel names line up.
  const safePkg = pkgId.replace(/\./g, '_');
  const safeName = sidecarName.replace(/\./g, '_');
  const messageEvent = `pkg://sidecar/${safePkg}/${safeName}/message`;
  const exitEvent = `pkg://sidecar/${safePkg}/${safeName}/exit`;

  const handlers = new Set<(msg: JsonRpcMessage) => void>();
  let disposed = false;

  const unsubMessage = listen<string>(messageEvent, (event) => {
    if (disposed) return;
    try {
      const parsed = JSON.parse(event.payload) as JsonRpcMessage;
      for (const h of handlers) h(parsed);
    } catch (err) {
      onError?.(err);
    }
  });

  const unsubExit = listen<unknown>(exitEvent, () => {
    // The next `send` will lazy-respawn the child. We forward an error-shaped
    // notification so any waiting LSP client can react (e.g. log + reopen).
    for (const h of handlers) {
      h({
        jsonrpc: '2.0',
        method: '$ikenga/sidecarExited',
        params: { pkgId, sidecarName },
      } as JsonRpcNotification);
    }
  });

  return {
    send(msg) {
      if (disposed) return;
      const wire = JSON.stringify(msg);
      invoke('pkg_sidecar_rpc_send', {
        pkgId,
        name: sidecarName,
        message: wire,
      }).catch((err) => onError?.(err));
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    dispose() {
      disposed = true;
      handlers.clear();
      unsubMessage.then((fn) => fn()).catch(() => {});
      unsubExit.then((fn) => fn()).catch(() => {});
      invoke('pkg_sidecar_rpc_shutdown', { pkgId, name: sidecarName }).catch(
        (err) => onError?.(err),
      );
    },
  };
}

// Re-export the message types so consumers can type their own
// invoke/listen helpers against them.
export type {
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
};
