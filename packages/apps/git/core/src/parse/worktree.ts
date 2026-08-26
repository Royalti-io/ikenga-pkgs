/**
 * com.ikenga.git · git-core — `git worktree list --porcelain -z` parser.
 *
 * Grammar (git-worktree(1), "Porcelain Format"): one attribute per line,
 * `worktree <path>` always first, a blank line between records. With `-z`
 * every line is NUL-TERMINATED and the record separator becomes an EMPTY
 * chunk — verified against git 2.43.0, whose output ends `…refs/heads/side\0\0`.
 *
 * Boolean attributes (`bare`, `detached`) appear only when true. `locked` and
 * `prunable` appear either bare or with a reason: `locked <reason>`.
 *
 * `prunable` is the Phase-2 hook: a stale agent worktree — the terminal that
 * created it is gone, the directory was deleted from under git — reports
 * prunable with a reason, which is precisely the "which of these worktrees is
 * dead" signal the Worktrees view exists to show.
 */

import type { WorktreeInfo } from '../rpc.js';

const NUL = '\u0000';

function emptyWorktree(path: string, isMain: boolean): WorktreeInfo {
  return {
    path,
    head: null,
    branch: null,
    detached: false,
    bare: false,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    isMain,
    // Phase 1 always null — the terminal join lands in Phase 2 (G-14). The
    // field exists now so P2 does not re-freeze G-RPC.
    ownerTerminalId: null,
  };
}

/**
 * Parse the NUL-delimited porcelain stream.
 *
 * The first record is the MAIN working tree; every later one is linked. That
 * ordering is git's, not ours, and it is the only way to tell them apart from
 * this output alone — hence `isMain` is positional.
 */
export function parseWorktreeList(raw: string): WorktreeInfo[] {
  const out: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;

  for (const chunk of raw.split(NUL)) {
    if (chunk.length === 0) {
      // Record separator. Flush; the next `worktree` line starts a new record.
      if (current) out.push(current);
      current = null;
      continue;
    }

    const sp = chunk.indexOf(' ');
    const key = sp === -1 ? chunk : chunk.slice(0, sp);
    const value = sp === -1 ? '' : chunk.slice(sp + 1);

    if (key === 'worktree') {
      // Defensive: a `worktree` line without a preceding separator would
      // otherwise fold two records into one.
      if (current) out.push(current);
      current = emptyWorktree(value, out.length === 0);
      continue;
    }
    if (!current) continue;

    switch (key) {
      case 'HEAD':
        current.head = value.length > 0 ? value : null;
        break;
      case 'branch':
        current.branch = value.length > 0 ? value : null;
        break;
      case 'bare':
        current.bare = true;
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'locked':
        current.locked = true;
        current.lockReason = value.length > 0 ? value : null;
        break;
      case 'prunable':
        current.prunable = true;
        current.prunableReason = value.length > 0 ? value : null;
        break;
      default:
        // Unknown attribute from a newer git. Ignored rather than fatal: this
        // parser must not start failing when the user upgrades git.
        break;
    }
  }

  if (current) out.push(current);
  return out;
}

/** The main working tree, or null for output that had none (bare edge cases). */
export function mainWorktree(worktrees: readonly WorktreeInfo[]): WorktreeInfo | null {
  return worktrees.find((w) => w.isMain) ?? null;
}

/**
 * Map full ref → worktree path, for `BranchInfo.worktreePath`.
 *
 * A branch checked out in a LINKED worktree cannot be checked out here — git
 * refuses. The UI must disable the row rather than let git error, so this
 * lookup is what `branch.list` joins against.
 */
export function branchOccupancy(worktrees: readonly WorktreeInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const w of worktrees) {
    if (w.branch) map.set(w.branch, w.path);
  }
  return map;
}
