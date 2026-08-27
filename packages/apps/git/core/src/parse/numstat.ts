/**
 * com.ikenga.git · git-core — `git diff --numstat -z` parser.
 *
 * Normal mode is `<added>TAB<deleted>TAB<path>` per line. `-z` changes the
 * shape in a way the docs state but every naive parser gets wrong — verified
 * against git 2.43.0:
 *
 *   ordinary:  "1\t0\ta.txt"        NUL
 *   binary:    "-\t-\tbin.dat"      NUL
 *   rename:    "0\t0\t"             NUL "sub/b.txt" NUL "sub/c.txt" NUL
 *              └ counts, empty path      └ ORIG          └ NEW
 *
 * So a rename spans THREE chunks and the paths arrive orig-first — the reverse
 * of `status --porcelain=v2`'s `2` line, which puts the new path first. Both
 * orders are correct for their own command; assuming one order for both is the
 * bug this comment exists to prevent.
 *
 * `-` in both count columns means BINARY, and it is not the same as `0/0`:
 * `0/0` is a real text file whose content did not change (a mode-only change),
 * `-/-` is a file git will not diff (02-research-external.md [20]). The UI
 * renders a placeholder for one and an empty diff for the other.
 */

import type { FileChange } from '../rpc.js';

const NUL = '\u0000';

export interface NumstatEntry {
  path: string;
  /** Null when binary. */
  added: number | null;
  /** Null when binary. */
  deleted: number | null;
  binary: boolean;
  /** Rename/copy source, else null. */
  origPath: string | null;
}

/** Parse `git diff --numstat -z` output. */
export function parseNumstat(raw: string): NumstatEntry[] {
  const chunks = raw.split(NUL);
  const out: NumstatEntry[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (chunk === undefined || chunk.length === 0) continue;

    const first = chunk.indexOf('\t');
    if (first === -1) continue; // not a counts chunk; a stray path we already consumed
    const second = chunk.indexOf('\t', first + 1);
    if (second === -1) continue;

    const addedRaw = chunk.slice(0, first);
    const deletedRaw = chunk.slice(first + 1, second);
    const pathInline = chunk.slice(second + 1);

    const binary = addedRaw === '-' || deletedRaw === '-';
    const added = binary ? null : toCount(addedRaw);
    const deleted = binary ? null : toCount(deletedRaw);

    if (pathInline.length > 0) {
      out.push({ path: pathInline, added, deleted, binary, origPath: null });
      continue;
    }

    // Empty inline path ⇒ rename/copy: the next TWO chunks are orig then new.
    const origPath = chunks[i + 1] ?? '';
    const path = chunks[i + 2] ?? '';
    i += 2;
    out.push({ path, added, deleted, binary, origPath });
  }

  return out;
}

function toCount(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Merge numstat columns into `FileChange` entries from `parse/status.ts`.
 *
 * Matched on `path`, falling back to `origPath` so a rename picks up its
 * counts whichever of the two names the status parse recorded. Entries with no
 * numstat row keep `added`/`deleted` null — an untracked file has no numstat
 * row at all (it is not in the index), and inventing 0/0 for it would show
 * "+0 −0" next to a brand-new 400-line file.
 */
export function mergeNumstat(
  entries: readonly FileChange[],
  numstat: readonly NumstatEntry[]
): FileChange[] {
  const byPath = new Map<string, NumstatEntry>();
  for (const n of numstat) {
    byPath.set(n.path, n);
    if (n.origPath) byPath.set(n.origPath, n);
  }
  return entries.map((e) => {
    const n = byPath.get(e.path) ?? (e.origPath ? byPath.get(e.origPath) : undefined);
    if (!n) return e;
    return { ...e, added: n.added, deleted: n.deleted, binary: n.binary };
  });
}
