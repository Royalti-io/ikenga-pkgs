// com.ikenga.studio · useAsyncAction — the busy/error/run shape shared by the views
//
// Nearly every view action follows the same skeleton: flip a busy flag, clear
// the last error, `await getMcpClient()`, do the work, park a message on throw,
// clear busy in a `finally`. That shape was hand-rolled ~41 times across Cell /
// Canvas / Composition, each free to swallow the error a little differently.
// This packages it once so a call site reads as one `run(fn)` and can't
// reintroduce the inconsistent error handling.
//
// `run` hands the resolved client to `fn` (the one thing every copy fetched
// first) and returns whatever `fn` resolves to, or `undefined` on throw so the
// caller can branch without a second try/catch. `onError` shapes the parked
// message (the views prefix it — "Couldn't create the cell — …"); the default
// is the thrown error's message.

import { useCallback, useState } from 'react';

import { getMcpClient, type McpClient } from '../mcp-client';

export interface AsyncActionHandle {
  busy: boolean;
  error: string | null;
  /** Run an async unit of work with the resolved MCP client. Resolves to the
   *  work's result, or `undefined` if it threw (the message is parked in
   *  `error`). */
  run<T>(
    fn: (client: McpClient) => Promise<T>,
    opts?: { onError?: (err: unknown) => string },
  ): Promise<T | undefined>;
  clearError(): void;
  /** Escape hatch for a call site that must park a message without running work
   *  (e.g. a validation guard that fails before any RPC). */
  setError(message: string | null): void;
}

export function useAsyncAction(): AsyncActionHandle {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async <T>(
      fn: (client: McpClient) => Promise<T>,
      opts?: { onError?: (err: unknown) => string },
    ): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const client = await getMcpClient();
        return await fn(client);
      } catch (err) {
        setError(opts?.onError ? opts.onError(err) : (err as Error).message);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { busy, error, run, clearError, setError };
}
