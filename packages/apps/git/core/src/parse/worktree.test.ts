/**
 * `parse/worktree.ts` — `git worktree list --porcelain -z`.
 *
 * Fixture captured from git 2.43.0 on a repo with one main tree and one linked
 * worktree. The shape that matters: attribute lines are NUL-TERMINATED and the
 * record separator is an EMPTY chunk, so the stream ends `…refs/heads/side\0\0`.
 *
 *   cd packages/apps/git && npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchOccupancy, mainWorktree, parseWorktreeList } from './worktree.js';

const N = '\u0000';

const REAL = [
  'worktree /tmp/gt.fAUP',
  'HEAD 80d03fb59d5d1c68268f65f21736cbe67891a49a',
  'branch refs/heads/main',
  '',
  'worktree /tmp/wt.2444589',
  'HEAD 80d03fb59d5d1c68268f65f21736cbe67891a49a',
  'branch refs/heads/side',
  '',
  '',
].join(N);

test('the real capture yields two records, first flagged main', () => {
  const w = parseWorktreeList(REAL);
  assert.equal(w.length, 2);

  assert.deepEqual(
    { path: w[0]?.path, branch: w[0]?.branch, isMain: w[0]?.isMain },
    { path: '/tmp/gt.fAUP', branch: 'refs/heads/main', isMain: true }
  );
  assert.deepEqual(
    { path: w[1]?.path, branch: w[1]?.branch, isMain: w[1]?.isMain },
    { path: '/tmp/wt.2444589', branch: 'refs/heads/side', isMain: false }
  );
  assert.equal(w[0]?.head, '80d03fb59d5d1c68268f65f21736cbe67891a49a');
  assert.equal(mainWorktree(w)?.path, '/tmp/gt.fAUP');
});

test('Phase-1 `ownerTerminalId` is always null', () => {
  // The field exists so Phase 2's terminal join does not have to re-freeze
  // G-RPC. If this ever starts returning a value in Phase 1, something is
  // inventing ownership data.
  for (const w of parseWorktreeList(REAL)) assert.equal(w.ownerTerminalId, null);
});

test('boolean attributes appear only when true', () => {
  const raw = [
    'worktree /repo',
    'bare',
    '',
    'worktree /repo/wt-detached',
    'HEAD ' + 'c'.repeat(40),
    'detached',
    '',
    '',
  ].join(N);
  const w = parseWorktreeList(raw);
  assert.equal(w[0]?.bare, true);
  assert.equal(w[0]?.detached, false);
  assert.equal(w[1]?.detached, true);
  assert.equal(w[1]?.bare, false);
  assert.equal(w[1]?.branch, null);
});

test('locked / prunable, bare and with a reason', () => {
  const raw = [
    'worktree /a',
    'locked',
    '',
    'worktree /b',
    'locked on an external drive',
    '',
    'worktree /c',
    'prunable gitdir file points to non-existent location',
    '',
    '',
  ].join(N);
  const w = parseWorktreeList(raw);

  assert.deepEqual([w[0]?.locked, w[0]?.lockReason], [true, null]);
  assert.deepEqual([w[1]?.locked, w[1]?.lockReason], [true, 'on an external drive']);
  // `prunable` is the stale-agent-worktree signal Phase 2 keys off.
  assert.deepEqual(
    [w[2]?.prunable, w[2]?.prunableReason],
    [true, 'gitdir file points to non-existent location']
  );
});

test('an unknown attribute from a newer git is ignored, not fatal', () => {
  const raw = ['worktree /a', 'HEAD ' + 'd'.repeat(40), 'somethingnew value', '', ''].join(N);
  const w = parseWorktreeList(raw);
  assert.equal(w.length, 1);
  assert.equal(w[0]?.head, 'd'.repeat(40));
});

test('a missing final separator still flushes the last record', () => {
  const raw = ['worktree /a', 'HEAD ' + 'e'.repeat(40), 'branch refs/heads/x'].join(N);
  const w = parseWorktreeList(raw);
  assert.equal(w.length, 1);
  assert.equal(w[0]?.branch, 'refs/heads/x');
});

test('branchOccupancy maps full refs to worktree paths', () => {
  // This is what stops the UI offering a checkout git will refuse: a branch
  // checked out in a linked worktree cannot be checked out again here.
  const map = branchOccupancy(parseWorktreeList(REAL));
  assert.equal(map.get('refs/heads/side'), '/tmp/wt.2444589');
  assert.equal(map.get('refs/heads/main'), '/tmp/gt.fAUP');
  assert.equal(map.get('refs/heads/absent'), undefined);
});

test('empty output is no worktrees, not a parse failure', () => {
  assert.deepEqual(parseWorktreeList(''), []);
});
