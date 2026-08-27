/**
 * The git-core-backed handlers behind each G-MCP tool, against a REAL `git`
 * in a temp repo — mirrors `core/src/integration.test.ts`'s approach one
 * layer up. Skips wholesale when `git` is not on PATH.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { buildRepoSnapshot } from './repo-snapshot.js';
import { buildFileDiff } from './diff.js';
import { branchList, historyLog, repoAheadBehind, worktreeList } from './reads.js';
import { commitCreate } from './commit.js';
import { isGitError } from '../../core/src/rpc.js';

const HAS_GIT = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

let tmp = '';
let repo = '';

function raw(args: string[], cwd: string): void {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

before(async () => {
  if (!HAS_GIT) return;
  tmp = await mkdtemp(join(tmpdir(), 'ikenga-git-mcp-handlers-'));
  repo = join(tmp, 'repo');
  await mkdir(repo, { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], repo);
  await writeFile(join(repo, 'a.txt'), 'hello\n');
  raw(['add', 'a.txt'], repo);
  raw(['commit', '-q', '-m', 'first'], repo);
  raw(['branch', 'side'], repo);
});

after(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

test('buildRepoSnapshot: reads a clean repo correctly', { skip: !HAS_GIT }, async () => {
  const res = await buildRepoSnapshot(repo, '.');
  assert.equal(res.ok, true);
  if (res.ok !== true) return;
  assert.equal(res.snapshot.branch, 'main');
  assert.equal(res.snapshot.detached, false);
  assert.equal(res.snapshot.operation, 'none');
  assert.equal(res.snapshot.staged, 0);
  assert.equal(res.snapshot.unstaged, 0);
  assert.equal(res.snapshot.lastCommit?.subject, 'first');
  assert.equal(res.snapshot.isBare, false);
  assert.ok(res.snapshot.gitDir.endsWith('.git'));
});

test('buildRepoSnapshot: an unstaged edit shows up in counts and the file list', { skip: !HAS_GIT }, async () => {
  await writeFile(join(repo, 'a.txt'), 'hello\nmore\n');
  const res = await buildRepoSnapshot(repo, '.');
  assert.equal(res.ok, true);
  if (res.ok !== true) return;
  assert.equal(res.snapshot.unstaged, 1);
  raw(['checkout', '--', 'a.txt'], repo); // restore for later tests — NOT via our own discard-less contract
});

test('buildFileDiff: unstaged side returns a real unified patch with numstat', { skip: !HAS_GIT }, async () => {
  await writeFile(join(repo, 'a.txt'), 'hello\nmore\n');
  const res = await buildFileDiff({ repo, path: 'a.txt', side: 'unstaged' });
  assert.equal(res.ok, true);
  if (res.ok !== true) return;
  assert.match(res.diff.patch, /\+more/);
  assert.equal(res.diff.added, 1);
  assert.equal(res.diff.deleted, 0);
  assert.equal(res.diff.binary, false);
  raw(['checkout', '--', 'a.txt'], repo);
});

test('historyLog: returns the commit with a co-author trailer preserved', { skip: !HAS_GIT }, async () => {
  raw(
    ['commit', '--allow-empty', '-q', '-m', 'second\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>'],
    repo
  );
  const res = await historyLog({ repo, limit: 10 });
  assert.equal(res.ok, true);
  if (res.ok !== true) return;
  assert.ok(res.commits.length >= 2);
  const second = res.commits.find((c) => c.subject === 'second');
  assert.ok(second);
  assert.deepEqual(second?.coAuthors, [{ name: 'Claude Fable 5', email: 'noreply@anthropic.com' }]);
});

test('branchList: lists main and side with a resolved lastCommit', { skip: !HAS_GIT }, async () => {
  const res = await branchList({ repo });
  assert.equal(res.ok, true);
  if (res.ok !== true) return;
  const names = res.branches.map((b) => b.name).sort();
  assert.deepEqual(names, ['main', 'side']);
  const main = res.branches.find((b) => b.name === 'main');
  assert.ok(main?.lastCommit);
});

test('worktreeList: the main tree only, isMain=true', { skip: !HAS_GIT }, async () => {
  const res = await worktreeList({ repo });
  assert.equal(res.ok, true);
  if (res.ok !== true) return;
  assert.equal(res.worktrees.length, 1);
  assert.equal(res.worktrees[0]?.isMain, true);
});

test('repoAheadBehind: main vs a branch cut from current HEAD, both zero, related histories', { skip: !HAS_GIT }, async () => {
  // `side` was branched in `before()`, but earlier tests in this file (log,
  // commit) advance `main` — so a fresh branch AT CURRENT HEAD is the only
  // fixture that is guaranteed zero/zero regardless of test order.
  raw(['branch', '-f', 'side-fresh', 'HEAD'], repo);
  const res = await repoAheadBehind({ repo, base: 'main', head: 'side-fresh' });
  assert.equal(res.ok, true);
  if (res.ok !== true) return;
  assert.equal(res.counts.ahead, 0);
  assert.equal(res.counts.behind, 0);
  assert.ok(res.counts.mergeBase);
});

test('commitCreate: stages nothing implicitly, commits exactly the given paths, and re-reads a fresh snapshot', { skip: !HAS_GIT }, async () => {
  await writeFile(join(repo, 'a.txt'), 'hello\ncommitted\n');
  await writeFile(join(repo, 'untouched.txt'), 'should not be committed\n');

  const res = await commitCreate({
    repo,
    relPath: '.',
    paths: ['a.txt'],
    message: 'third: only a.txt',
  });
  assert.equal(res.ok, true);
  if (res.ok !== true) return;
  assert.match(res.result.sha, /^[0-9a-f]{40}$/);
  assert.equal(res.result.snapshot.untracked, 1, 'untouched.txt must remain untracked — --only');
  assert.equal(res.result.snapshot.unstaged, 0);
  assert.equal(res.result.snapshot.staged, 0);

  const log = spawnSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf8' });
  assert.equal(log.stdout.trim(), 'third: only a.txt');
});

test('commitCreate: an empty path list is refused (MCP never commits "whatever is staged")', { skip: !HAS_GIT }, async () => {
  const res = await commitCreate({ repo, relPath: '.', paths: [], message: 'x' });
  assert.ok(isGitError(res));
  if (isGitError(res)) assert.equal(res.reason, 'unsafe-argument');
});
