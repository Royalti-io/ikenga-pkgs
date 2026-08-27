/**
 * The explicit-path commit assertion (staged.ts) — G-04, rpc.ts DELTA 7.
 *
 * Two halves: the pure set comparison (no git needed) and the real read
 * against a real repo. The end-to-end proof that an `MM` file commits its
 * INDEX content lives in integration.test.ts (git-core) and in
 * sidecar.test.ts / handlers.test.ts (through the real processes).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import * as argv from './argv.js';
import { run } from './exec.js';
import { assertStagedSetMatches, compareStagedSet, normalizeRelPath, readStagedPaths } from './staged.js';

const HAS_GIT = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

// ═════════════════════════════════════════════════════════════════════════════
// Pure — no git
// ═════════════════════════════════════════════════════════════════════════════

test('normalizeRelPath folds only cosmetic differences', () => {
  assert.equal(normalizeRelPath('src/a.ts'), 'src/a.ts');
  assert.equal(normalizeRelPath('./src/a.ts'), 'src/a.ts');
  assert.equal(normalizeRelPath('src//a.ts'), 'src/a.ts');
  assert.equal(normalizeRelPath('src/'), 'src');
  // NOT folded: case and unicode form are real filesystem distinctions, and
  // this function's job is to be strict about which index entry is meant.
  assert.notEqual(normalizeRelPath('src/A.ts'), normalizeRelPath('src/a.ts'));
});

test('compareStagedSet names both sides of a mismatch', () => {
  assert.deepEqual(compareStagedSet(['a', 'b'], ['a', 'b']), { extra: [], missing: [] });
  assert.deepEqual(compareStagedSet(['a', 'b'], ['a']), { extra: ['b'], missing: [] });
  assert.deepEqual(compareStagedSet(['a'], ['a', 'b']), { extra: [], missing: ['b'] });
  assert.deepEqual(compareStagedSet(['a', 'c'], ['a', 'b']), { extra: ['c'], missing: ['b'] });
  // Order and duplicates in the request are not a mismatch.
  assert.deepEqual(compareStagedSet(['a', 'b'], ['b', 'a', 'a', './b']), {
    extra: [],
    missing: [],
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Against a real repo
// ═════════════════════════════════════════════════════════════════════════════

let tmp = '';
let repo = '';

function raw(args: string[], cwd: string): void {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Ikenga Test',
      GIT_AUTHOR_EMAIL: 'test@ikenga.dev',
      GIT_COMMITTER_NAME: 'Ikenga Test',
      GIT_COMMITTER_EMAIL: 'test@ikenga.dev',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
}

before(async () => {
  if (!HAS_GIT) return;
  tmp = await mkdtemp(join(tmpdir(), 'ikenga-git-staged-'));
  repo = join(tmp, 'repo');
  raw(['init', '-q', '-b', 'main', 'repo'], tmp);
  await writeFile(join(repo, 'seed.txt'), 'seed\n');
  raw(['add', 'seed.txt'], repo);
  raw(['commit', '-q', '-m', 'seed'], repo);
});

after(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const opts = { get cwd() { return repo; } };

test('readStagedPaths: nothing staged is an empty list, not a failure', { skip: !HAS_GIT }, async () => {
  const res = await readStagedPaths(repo);
  assert.ok(res.ok === true);
  assert.deepEqual(res.paths, []);
});

test('readStagedPaths reads the staged set, not the worktree', { skip: !HAS_GIT }, async () => {
  await writeFile(join(repo, 'one.txt'), '1\n');
  await writeFile(join(repo, 'two.txt'), '2\n');
  // Only `one.txt` is staged; `two.txt` is untracked and must NOT appear.
  await run('git', argv.add(['one.txt']), opts);
  const res = await readStagedPaths(repo);
  assert.ok(res.ok === true);
  assert.deepEqual(res.paths, ['one.txt']);
});

test('assertStagedSetMatches: exact match returns null', { skip: !HAS_GIT }, async () => {
  assert.equal(await assertStagedSetMatches(repo, ['one.txt']), null);
  assert.equal(await assertStagedSetMatches(repo, ['./one.txt']), null);
});

test('assertStagedSetMatches: an unstaged request is `missing`', { skip: !HAS_GIT }, async () => {
  const err = await assertStagedSetMatches(repo, ['one.txt', 'two.txt']);
  assert.ok(err);
  assert.equal(err.reason, 'staged-set-mismatch');
  assert.match(err.message, /requested but not staged: two\.txt/);
  assert.equal(err.path, 'two.txt');
});

test('assertStagedSetMatches: an unnamed staged path is `extra`', { skip: !HAS_GIT }, async () => {
  await run('git', argv.add(['two.txt']), opts);
  const err = await assertStagedSetMatches(repo, ['one.txt']);
  assert.ok(err);
  assert.equal(err.reason, 'staged-set-mismatch');
  assert.match(err.message, /also staged: two\.txt/);
  // The whole point: `two.txt` would have ridden along into the commit.
  assert.equal(await assertStagedSetMatches(repo, ['one.txt', 'two.txt']), null);
});

test('a staged rename reports its DESTINATION path only', { skip: !HAS_GIT }, async () => {
  // Rename detection is on by default in both `diff --cached` and
  // `status --porcelain=v2`, so `FileChange.path` (the destination) is what the
  // UI sends and what the assertion must expect. Forcing `--no-renames` here
  // would list source AND destination and make every rename a false mismatch.
  raw(['commit', '-q', '-m', 'land one/two'], repo);
  raw(['mv', 'one.txt', 'renamed.txt'], repo);
  const res = await readStagedPaths(repo);
  assert.ok(res.ok === true);
  assert.deepEqual(res.paths, ['renamed.txt']);
  assert.equal(await assertStagedSetMatches(repo, ['renamed.txt']), null);
});
