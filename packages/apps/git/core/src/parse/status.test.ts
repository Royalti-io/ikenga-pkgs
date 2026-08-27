/**
 * `parse/status.ts` — porcelain-v2 `-z`.
 *
 * The fixtures below are REAL git 2.43.0 output, captured from a scratch repo
 * and transcribed with `\0` for the NUL bytes. They are not hand-invented: the
 * rename record's two-chunk shape and the exact header spellings are the whole
 * point, and a hand-written fixture would encode this parser's assumptions
 * rather than git's behaviour.
 *
 *   cd packages/apps/git && npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countChanges, parseStatus, partitionChanges } from './status.js';

const N = '\u0000';

/**
 * Captured from a repo with: `a.txt` modified in the worktree, `bin.dat` newly
 * staged, `sub/b.txt` → `sub/c.txt` staged rename, `untracked.txt` untracked.
 * No upstream configured, so no `# branch.upstream` / `# branch.ab`.
 */
const REAL_STATUS = [
  '# branch.oid 80d03fb59d5d1c68268f65f21736cbe67891a49a',
  '# branch.head main',
  '1 .M N... 100644 100644 100644 ce013625030ba8dba906f756967f9e9ca394464a ce013625030ba8dba906f756967f9e9ca394464a a.txt',
  '1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 d5d0b8b4c4c9e936890870f6799cfbb5ba984470 bin.dat',
  '2 R. N... 100644 100644 100644 587be6b4c3f93f93c489c0111bba5596147a26cb 587be6b4c3f93f93c489c0111bba5596147a26cb R100 sub/c.txt',
  'sub/b.txt',
  '? untracked.txt',
  '',
].join(N);

test('the real capture parses field-for-field', () => {
  const s = parseStatus(REAL_STATUS);

  assert.equal(s.headSha, '80d03fb59d5d1c68268f65f21736cbe67891a49a');
  assert.equal(s.branch, 'main');
  assert.equal(s.detached, false);
  assert.equal(s.upstream, null);
  assert.equal(s.ahead, null);
  assert.equal(s.behind, null);
  assert.equal(s.stashCount, 0);

  // FOUR entries, not five: the rename's source line is part of the rename
  // record, not an entry of its own. A parser that splits naively on NUL
  // reports five, with a phantom entry named "sub/b.txt".
  assert.equal(s.entries.length, 4);

  const [aTxt, bin, rename, untracked] = s.entries;

  assert.deepEqual(
    { path: aTxt?.path, kind: aTxt?.kind, staged: aTxt?.staged, unstaged: aTxt?.unstaged },
    { path: 'a.txt', kind: 'ordinary', staged: '.', unstaged: 'M' }
  );
  assert.deepEqual(
    { path: bin?.path, kind: bin?.kind, staged: bin?.staged, unstaged: bin?.unstaged },
    { path: 'bin.dat', kind: 'ordinary', staged: 'A', unstaged: '.' }
  );
  assert.deepEqual(
    {
      path: rename?.path,
      origPath: rename?.origPath,
      kind: rename?.kind,
      score: rename?.score,
      staged: rename?.staged,
    },
    { path: 'sub/c.txt', origPath: 'sub/b.txt', kind: 'renamed', score: 100, staged: 'R' }
  );
  assert.deepEqual(
    { path: untracked?.path, kind: untracked?.kind },
    { path: 'untracked.txt', kind: 'untracked' }
  );

  // The submodule field is carried through verbatim — `N...` means "not a
  // submodule", and the `S<c><m><u>` form is what a real submodule reports.
  assert.equal(aTxt?.submodule, 'N...');
});

test('the rename source is consumed, not re-parsed as an entry', () => {
  // Guard the specific failure this parser is written to avoid: a second
  // rename in the same output must not shift every subsequent entry by one.
  const raw = [
    '2 R. N... 100644 100644 100644 aaa bbb R100 new1.txt',
    'old1.txt',
    '2 R. N... 100644 100644 100644 ccc ddd R090 new2.txt',
    'old2.txt',
    '? after.txt',
    '',
  ].join(N);
  const s = parseStatus(raw);
  assert.equal(s.entries.length, 3);
  assert.deepEqual(
    s.entries.map((e) => [e.path, e.origPath, e.score]),
    [
      ['new1.txt', 'old1.txt', 100],
      ['new2.txt', 'old2.txt', 90],
      ['after.txt', null, null],
    ]
  );
});

test('paths containing spaces survive — the remainder is never re-split', () => {
  const raw = [
    '1 .M N... 100644 100644 100644 aaa bbb my folder/a file.txt',
    '? another file.md',
    '',
  ].join(N);
  const s = parseStatus(raw);
  assert.deepEqual(
    s.entries.map((e) => e.path),
    ['my folder/a file.txt', 'another file.md']
  );
});

test('`# branch.ab` is ahead-first (the opposite of rev-list)', () => {
  const raw = [
    '# branch.oid ' + 'a'.repeat(40),
    '# branch.head feat/x',
    '# branch.upstream origin/feat/x',
    '# branch.ab +12 -5',
    '# stash 3',
    '',
  ].join(N);
  const s = parseStatus(raw);
  assert.equal(s.upstream, 'origin/feat/x');
  assert.equal(s.ahead, 12);
  assert.equal(s.behind, 5);
  assert.equal(s.stashCount, 3);
});

test('unborn branch and detached HEAD', () => {
  const initial = parseStatus(['# branch.oid (initial)', '# branch.head main', ''].join(N));
  assert.equal(initial.headSha, null);
  assert.equal(initial.branch, 'main');
  assert.equal(initial.detached, false);

  const detached = parseStatus(
    ['# branch.oid ' + 'b'.repeat(40), '# branch.head (detached)', ''].join(N)
  );
  assert.equal(detached.detached, true);
  assert.equal(detached.branch, null);
});

test('unmerged `u` lines are conflicts, with both codes preserved', () => {
  const raw = ['u UU N... 100644 100644 100644 100644 aaa bbb ccc conflicted.txt', ''].join(N);
  const s = parseStatus(raw);
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0]?.kind, 'unmerged');
  assert.equal(s.entries[0]?.staged, 'U');
  assert.equal(s.entries[0]?.unstaged, 'U');
  assert.equal(s.entries[0]?.path, 'conflicted.txt');
});

test('ignored entries are parsed but excluded from the partition', () => {
  const raw = ['! node_modules/', '? real.txt', ''].join(N);
  const s = parseStatus(raw);
  assert.equal(s.entries.length, 2);
  assert.equal(s.entries[0]?.kind, 'ignored');

  const p = partitionChanges(s.entries);
  assert.deepEqual(p.untracked.map((e) => e.path), ['real.txt']);
  assert.equal(p.staged.length + p.unstaged.length + p.conflicted.length, 0);
});

test('a file staged AND further modified appears on both sides', () => {
  // `MM` is the normal mid-work state. Showing it once would hide either the
  // staged content or the unstaged content from the user.
  const raw = ['1 MM N... 100644 100644 100644 aaa bbb both.txt', ''].join(N);
  const p = partitionChanges(parseStatus(raw).entries);
  assert.deepEqual(p.staged.map((e) => e.path), ['both.txt']);
  assert.deepEqual(p.unstaged.map((e) => e.path), ['both.txt']);
});

test('counts mirror the partition', () => {
  const s = parseStatus(REAL_STATUS);
  assert.deepEqual(countChanges(s.entries), {
    staged: 2, // bin.dat (A.) + the rename (R.)
    unstaged: 1, // a.txt (.M)
    untracked: 1,
    conflicted: 0,
  });
});

test('empty output is a clean repo, not a parse failure', () => {
  const s = parseStatus('');
  assert.deepEqual(s.entries, []);
  assert.equal(s.branch, null);
});
