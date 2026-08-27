/**
 * `parse/numstat.ts` — `git diff --numstat -z`.
 *
 * The fixture is real git 2.43.0 output for a working tree with one modified
 * text file, one added binary file, and one staged rename. It encodes the two
 * facts that catch every naive parser:
 *   · a rename spans THREE chunks, paths ORIG-first;
 *   · `-` in both columns means binary, which is not `0/0`.
 *
 *   cd packages/apps/git && npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FileChange } from '../rpc.js';
import { mergeNumstat, parseNumstat } from './numstat.js';

const N = '\u0000';

/** `git diff --numstat -z HEAD` — captured verbatim. */
const REAL = ['1\t0\ta.txt', '-\t-\tbin.dat', '0\t0\t', 'sub/b.txt', 'sub/c.txt', ''].join(N);

test('the real capture parses, rename included', () => {
  const rows = parseNumstat(REAL);
  assert.equal(rows.length, 3);

  assert.deepEqual(rows[0], {
    path: 'a.txt',
    added: 1,
    deleted: 0,
    binary: false,
    origPath: null,
  });

  // Binary: null counts, NOT zeros. `0/0` would render "+0 −0" next to a file
  // git refuses to diff at all.
  assert.deepEqual(rows[1], {
    path: 'bin.dat',
    added: null,
    deleted: null,
    binary: true,
    origPath: null,
  });

  // Rename: the counts chunk has an EMPTY inline path, then orig, then new.
  // Note the order is the reverse of `status --porcelain=v2`'s `2` line.
  assert.deepEqual(rows[2], {
    path: 'sub/c.txt',
    added: 0,
    deleted: 0,
    binary: false,
    origPath: 'sub/b.txt',
  });
});

test('a rename does not shift the entries after it', () => {
  const raw = ['0\t0\t', 'old.txt', 'new.txt', '5\t2\tafter.txt', ''].join(N);
  const rows = parseNumstat(raw);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.path, 'after.txt');
  assert.equal(rows[1]?.added, 5);
});

test('paths with spaces survive', () => {
  const rows = parseNumstat(['3\t1\tmy folder/a file.txt', ''].join(N));
  assert.equal(rows[0]?.path, 'my folder/a file.txt');
});

test('a binary RENAME reports null counts and both paths', () => {
  const rows = parseNumstat(['-\t-\t', 'old.png', 'new.png', ''].join(N));
  assert.deepEqual(rows[0], {
    path: 'new.png',
    added: null,
    deleted: null,
    binary: true,
    origPath: 'old.png',
  });
});

test('empty output is no rows', () => {
  assert.deepEqual(parseNumstat(''), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Merge
// ─────────────────────────────────────────────────────────────────────────────

function change(path: string, origPath: string | null = null): FileChange {
  return {
    path,
    origPath,
    kind: origPath ? 'renamed' : 'ordinary',
    staged: 'M',
    unstaged: '.',
    score: null,
    submodule: null,
    added: null,
    deleted: null,
    binary: false,
  };
}

test('merge fills counts, matching a rename on either name', () => {
  const merged = mergeNumstat(
    [change('a.txt'), change('bin.dat'), change('sub/c.txt', 'sub/b.txt')],
    parseNumstat(REAL)
  );
  assert.deepEqual(
    merged.map((m) => [m.path, m.added, m.deleted, m.binary]),
    [
      ['a.txt', 1, 0, false],
      ['bin.dat', null, null, true],
      ['sub/c.txt', 0, 0, false],
    ]
  );
});

test('an entry with no numstat row keeps null counts', () => {
  // An untracked file has no numstat row at all — it is not in the index.
  // Inventing 0/0 would show "+0 −0" beside a brand-new 400-line file.
  const merged = mergeNumstat([change('brand-new.txt')], []);
  assert.equal(merged[0]?.added, null);
  assert.equal(merged[0]?.deleted, null);
  assert.equal(merged[0]?.binary, false);
});
