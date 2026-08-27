/**
 * com.ikenga.git · MCP — assemble a `FileDiff` (the `git_diff` tool).
 *
 * Two git invocations per call, both already on the containment allowlist:
 *   · `diff -U<n> -- <path>` (or `log -1 --patch -- <path>` for a commit) —
 *     the unified patch text, unparsed (D9: every candidate renderer ingests
 *     unified text, so pre-parsing would be work thrown away).
 *   · numstat for the SAME change — `diff --numstat` for staged/unstaged,
 *     `log -1 --numstat` for a commit (no path-scoped commit-numstat builder
 *     exists in git-core, so this pulls the whole commit and picks the
 *     matching entry) — for `added`/`deleted`/`binary`, which a raw patch
 *     does not carry as clean integers.
 *
 * `isNew`/`isDeleted` come from the patch's own extended headers
 * (`new file mode` / `deleted file mode`), which git always emits for those
 * cases regardless of `-U<n>` — no third invocation needed.
 */

import * as argv from '../../core/src/argv.js';
import { run } from '../../core/src/exec.js';
import { parseNumstat } from '../../core/src/parse/index.js';
import { unsafeArgument } from '../../core/src/errors.js';
import {
  DEFAULT_DIFF_MAX_BYTES,
  type DiffSide,
  type FileDiff,
  type GitError,
} from '../../core/src/rpc.js';

function truncateAtLineBoundary(patch: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(patch, 'utf8') <= maxBytes) return { text: patch, truncated: false };
  // Binary-safe enough for this purpose: slice by UTF-16 code units, which is
  // never longer than the byte length, then trim to the last newline.
  const slice = patch.slice(0, maxBytes);
  const cut = slice.lastIndexOf('\n');
  return { text: cut > 0 ? slice.slice(0, cut) : slice, truncated: true };
}

export async function buildFileDiff(opts: {
  repo: string;
  path: string;
  side: DiffSide;
  sha?: string;
  contextLines?: number;
  maxBytes?: number;
}): Promise<{ ok: true; diff: FileDiff } | GitError> {
  const { repo, path, side } = opts;
  const maxBytes = opts.maxBytes ?? DEFAULT_DIFF_MAX_BYTES;

  if (side === 'commit' && !opts.sha) {
    return unsafeArgument('sha', '`sha` is required when side is "commit"');
  }

  const patchBuilt =
    side === 'commit'
      ? argv.commitPatch({ sha: opts.sha as string, path, contextLines: opts.contextLines })
      : argv.diffPatch({ side, path, contextLines: opts.contextLines });
  const patchRes = await run('git', patchBuilt, { cwd: repo });
  if (patchRes.ok !== true) return patchRes;
  const rawPatch = patchRes.outcome.stdout;

  const numstatBuilt =
    side === 'commit'
      ? argv.logCommitNumstat({ sha: opts.sha as string })
      : argv.diffNumstat({ cached: side === 'staged', paths: [path] });
  const numstatRes = await run('git', numstatBuilt, { cwd: repo });
  if (numstatRes.ok !== true) return numstatRes;
  const entries = parseNumstat(numstatRes.outcome.stdout);
  const entry = entries.find((e) => e.path === path || e.origPath === path) ?? null;

  const binary = entry?.binary ?? /^Binary files /m.test(rawPatch);
  const isNew = /^new file mode/m.test(rawPatch);
  const isDeleted = /^deleted file mode/m.test(rawPatch);
  const { text, truncated } = truncateAtLineBoundary(rawPatch, maxBytes);

  const diff: FileDiff = {
    repo,
    path,
    origPath: entry?.origPath ?? null,
    side,
    patch: text,
    binary,
    isNew,
    isDeleted,
    added: entry?.added ?? null,
    deleted: entry?.deleted ?? null,
    truncated,
  };
  return { ok: true, diff };
}
