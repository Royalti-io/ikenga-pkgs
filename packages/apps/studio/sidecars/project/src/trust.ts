/**
 * Per-folder trust gate caller.
 *
 * On the live path (post-WP-04), this invokes the Tauri command
 * `pkg_studio_request_project_access(path)` which the shell renders into
 * the existing trust UI. Until WP-04 lands, the env flag
 * `STUDIO_TRUST_STUB=1` short-circuits to `{ granted: true }` with a stderr
 * WARN. With no stub flag and no shell context (i.e. running outside the
 * shell), we refuse with `{ granted: false, reason: 'trust-unreachable' }`
 * rather than crashing.
 *
 * Contract is frozen by WP-04 — do not invent a different signature.
 */

export interface TrustResult {
  granted: boolean;
  reason?: 'denied' | 'trust-unreachable';
}

/** Where we'd call the host bridge if one were attached. Reserved for WP-04. */
export type HostInvoke = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

export interface TrustOptions {
  /** Optional host invoke shim. The real wiring lands in WP-04. */
  hostInvoke?: HostInvoke;
}

function warn(msg: string): void {
  process.stderr.write(`[studio-sidecar][trust][WARN] ${msg}\n`);
}

export async function requestProjectAccess(
  path: string,
  opts: TrustOptions = {},
): Promise<TrustResult> {
  // Test/dev stub — explicitly opted in via env.
  if (process.env.STUDIO_TRUST_STUB === '1') {
    warn(`STUDIO_TRUST_STUB=1 auto-granting trust for ${path}`);
    return { granted: true };
  }

  // Real path (WP-04). Until the host wires `hostInvoke`, we have no way
  // to reach the trust UI from a stdio sidecar.
  if (opts.hostInvoke) {
    try {
      const res = (await opts.hostInvoke('pkg_studio_request_project_access', {
        path,
      })) as { granted?: boolean };
      return { granted: Boolean(res?.granted), reason: res?.granted ? undefined : 'denied' };
    } catch (err) {
      warn(`hostInvoke failed for ${path}: ${(err as Error).message}`);
      return { granted: false, reason: 'trust-unreachable' };
    }
  }

  // Refuse politely rather than crashing. WP-04 will provide hostInvoke.
  return { granted: false, reason: 'trust-unreachable' };
}
