/**
 * `parse/revlist.ts` + `parse/branch.ts`.
 *
 * The one thing worth a dedicated test: `rev-list --left-right --count` prints
 * BEHIND first, while `status --porcelain=v2`'s `# branch.ab` prints AHEAD
 * first. Two commands, two orders, and a swapped pair renders a branch with 12
 * unpushed commits as 12 behind.
 *
 *   cd packages/apps/git && npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRANCH_FIELD_COUNT } from '../argv.js';
import { parseBranchList, parseTrack, toBranchInfo } from './branch.js';
import { parseLeftRightCount, toAheadBehind } from './revlist.js';

const N = '\u0000';

test('left-right count is BEHIND first', () => {
  // `git rev-list --left-right --count origin/main...HEAD` → "5\t12" means
  // 5 behind, 12 ahead (02-research-external.md [21]).
  assert.deepEqual(parseLeftRightCount('5\t12\n'), { behind: 5, ahead: 12 });
  assert.deepEqual(parseLeftRightCount('0\t0\n'), { behind: 0, ahead: 0 });
  // Real capture from git 2.43.0 (`main...HEAD` on an unmoved branch).
  assert.deepEqual(parseLeftRightCount('0\t0'), { behind: 0, ahead: 0 });
});

test('unparseable output is null, never zeros', () => {
  // Reporting {0,0} for output we did not understand renders "in sync" for a
  // branch that may be far behind — the worst possible default.
  assert.equal(parseLeftRightCount(''), null);
  assert.equal(parseLeftRightCount('fatal: bad revision'), null);
  assert.equal(parseLeftRightCount('12'), null);
});

test('toAheadBehind carries a null merge-base for unrelated histories', () => {
  const ab = toAheadBehind('main', 'HEAD', { behind: 2, ahead: 3 }, null);
  assert.deepEqual(ab, { base: 'main', head: 'HEAD', ahead: 3, behind: 2, mergeBase: null });
});

// ─────────────────────────────────────────────────────────────────────────────
// Branch list
// ─────────────────────────────────────────────────────────────────────────────

/** Real `git branch --list --format=BRANCH_FORMAT` output, git 2.43.0. */
const REAL_BRANCHES = [
  ['refs/heads/main', 'main', 'a'.repeat(40), '*', '', '', '/tmp/gt.fAUP', 'first'].join(N),
  ['refs/heads/side', 'side', 'a'.repeat(40), ' ', '', '', '/tmp/wt.2444589', 'first'].join(N),
].join('\n');

test('the real capture parses, `%(HEAD)` handled as `*` vs a SPACE', () => {
  const b = parseBranchList(REAL_BRANCHES);
  assert.equal(b.length, 2);
  // `%(HEAD)` is a single space for a non-current branch, not empty — a
  // truthiness check on the raw field is always true.
  assert.equal(b[0]?.isHead, true);
  assert.equal(b[1]?.isHead, false);
  assert.equal(b[0]?.name, 'main');
  assert.equal(b[0]?.upstream, null);
  assert.equal(b[1]?.worktreePath, '/tmp/wt.2444589');
  assert.equal(b[0]?.isRemote, false);
});

test('the fixture matches the declared field count', () => {
  assert.equal((REAL_BRANCHES.split('\n')[0] as string).split(N).length, BRANCH_FIELD_COUNT);
});

test('remote refs are flagged from the ref namespace', () => {
  const raw = [
    'refs/remotes/origin/main',
    'origin/main',
    'b'.repeat(40),
    ' ',
    '',
    '',
    '',
    'subject',
  ].join(N);
  assert.equal(parseBranchList(raw)[0]?.isRemote, true);
});

test('upstream tracking: parsed where numeric, null where not', () => {
  assert.deepEqual(parseTrack('ahead 3, behind 1'), { ahead: 3, behind: 1, gone: false });
  assert.deepEqual(parseTrack('ahead 3'), { ahead: 3, behind: 0, gone: false });
  assert.deepEqual(parseTrack('behind 7'), { ahead: 0, behind: 7, gone: false });
  assert.deepEqual(parseTrack(''), { ahead: null, behind: null, gone: false });
  assert.deepEqual(parseTrack('gone'), { ahead: null, behind: null, gone: true });
  // A translated string yields nulls, NOT zeros — this atom's text is marked
  // for translation in git, and git-core does not force `LC_ALL=C` (doing so
  // would also translate every error message the user reads).
  assert.deepEqual(parseTrack('vorne 3, hinten 1'), { ahead: null, behind: null, gone: false });
});

test('toBranchInfo nulls ahead/behind when there is no upstream', () => {
  const [main] = parseBranchList(REAL_BRANCHES);
  assert.ok(main);
  const info = toBranchInfo(main);
  assert.equal(info.upstream, null);
  assert.equal(info.ahead, null);
  assert.equal(info.behind, null);
  assert.equal(info.lastCommit, null);
  assert.equal(info.worktreePath, '/tmp/gt.fAUP');
});

test('a truncated record is skipped rather than guessed at', () => {
  assert.deepEqual(parseBranchList(['refs/heads/x', 'x'].join(N)), []);
  assert.deepEqual(parseBranchList(''), []);
});
