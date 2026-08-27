/**
 * com.ikenga.git · MCP — control.json discovery.
 *
 * Byte-for-byte the same contract `@ikenga/mcp-iyke` uses
 * (`packages/mcp/iyke/src/control.ts`): same path, same identifier, same
 * stale threshold. Copied rather than depended-on because this MCP's own
 * `package.json` declares no deps (`mcp/build.sh` externalizes only
 * `@modelcontextprotocol/sdk` + `zod` + `@parcel/watcher`; adding
 * `@ikenga/mcp-iyke` as a fourth external for one 90-line file is not worth
 * it — "net-zero-forks" (01-plan.md) is about not forking UPSTREAM code, and
 * this is a sibling pkg's internal, not an upstream library).
 *
 * §MCP threat model (01-plan.md): this MCP is launched by the user's `claude`
 * CLI in ANY cwd, outside the shell's kernel gate. The Ikenga desktop app is
 * the only source of "which project roots exist" — `repo` on every tool call
 * is resolved against them (`repo-resolve.ts`) and refused outside them. If
 * the app is not running, every tool fails closed with a structured
 * `repo-not-known` `GitError` rather than hanging or guessing.
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export const APP_IDENTIFIER = 'app.ikenga';
export const STALE_THRESHOLD_SECS = 5 * 60;

export interface ControlFile {
  schema_version: number;
  port: number;
  token: string;
  pid: number;
  started_at_unix_ms: number;
  identifier: string;
}

export type LoadOutcome =
  | { kind: 'ok'; control: ControlFile }
  | { kind: 'missing' }
  | { kind: 'stale-removed' }
  | { kind: 'stale-young'; ageSecs: number };

/**
 * Compute the same `app_local_data_dir().join("control.json")` Tauri does.
 * macOS: ~/Library/Application Support/<id>/control.json
 * Linux: $XDG_DATA_HOME/<id>/control.json (defaulting to ~/.local/share).
 */
export function controlPath(): string {
  const home = homedir();
  const plat = platform();
  let base: string;
  if (plat === 'darwin') {
    base = join(home, 'Library', 'Application Support');
  } else if (plat === 'linux') {
    base = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
  } else {
    base = process.env.APPDATA || join(home, 'AppData', 'Roaming');
  }
  return join(base, APP_IDENTIFIER, 'control.json');
}

export function load(): LoadOutcome {
  const path = controlPath();
  if (!existsSync(path)) return { kind: 'missing' };

  let cf: ControlFile;
  try {
    const raw = readFileSync(path, 'utf8');
    cf = JSON.parse(raw) as ControlFile;
  } catch (err) {
    throw new Error(`failed to parse ${path}: ${(err as Error).message}`);
  }
  if (cf.schema_version !== 1) {
    throw new Error(
      `unsupported control.json schema_version: ${cf.schema_version} (MCP built for v1)`
    );
  }

  if (isPidAlive(cf.pid)) {
    return { kind: 'ok', control: cf };
  }

  const ageMs = Date.now() - cf.started_at_unix_ms;
  const ageSecs = Math.floor(ageMs / 1000);
  if (ageSecs >= STALE_THRESHOLD_SECS) {
    try {
      unlinkSync(path);
    } catch {
      // Best effort — next launch overwrites it anyway.
    }
    return { kind: 'stale-removed' };
  }
  return { kind: 'stale-young', ageSecs };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}
