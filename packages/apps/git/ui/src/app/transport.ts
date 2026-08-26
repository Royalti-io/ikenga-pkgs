// com.ikenga.git · RPC transport (WP-06)
//
// Picks the real sidecar transport (`host.pkgSidecarCall`, rpc.ts §0(a)) when
// running inside the shell, or the in-memory mock when standalone / when
// `?mock=1` forces it — so the same view code drives both. WP-06's DoD is
// "renders all views with a mocked sidecar"; the real transport is exercised
// once WP-04 ships the sidecar's RPC dispatch, with zero UI changes needed.

import { isStandalone, pkgSidecarCall } from './bridge';
import { mockRpcClient } from '../mock/mock-sidecar';
import { type ArgsOf, type ResultOf, type RpcClient, type RpcMethod, RPC_ERROR } from './rpc';

let _idCounter = 0;

const realRpcClient: RpcClient = (async <M extends RpcMethod>(
  method: M,
  args: ArgsOf<M>
): Promise<ResultOf<M>> => {
  const id = ++_idCounter;
  const res = await pkgSidecarCall({ jsonrpc: '2.0', id, method, params: args });
  if (res.error) {
    // JSON-RPC transport-level failure (rpc.ts §5): the call never reached a
    // handler. Distinct from an in-band `{ok:false, reason}` operational
    // failure, which arrives as `res.result` and is returned as-is below.
    const known = (Object.values(RPC_ERROR) as number[]).includes(res.error.code);
    throw new Error(
      `[git] sidecar RPC ${method} failed (${known ? 'JSON-RPC' : 'unknown'} ${res.error.code}): ${res.error.message}`
    );
  }
  return res.result as ResultOf<M>;
}) as RpcClient;

function urlWantsMock(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('mock') === '1';
  } catch {
    return false;
  }
}

/** The active RPC client. Mock in standalone dev or when `?mock=1` forces it
 *  (useful for QA'ing a specific G-05 state from inside a real shell mount);
 *  the real one-shot sidecar transport otherwise. */
export const rpc: RpcClient = isStandalone() || urlWantsMock() ? mockRpcClient : realRpcClient;

export const usingMock: boolean = isStandalone() || urlWantsMock();
