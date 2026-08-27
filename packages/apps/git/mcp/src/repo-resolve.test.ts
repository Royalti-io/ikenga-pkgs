/**
 * `repo-resolve.ts` — the G-04 containment gate — against a REAL temp repo.
 * `getKnownRoots` is injected so this needs no live shell / iyke bridge; the
 * live end-to-end path (a real running Ikenga app, a real `/iyke/project/
 * list` round trip) was verified separately by execution against this
 * session's own running desktop app (see the WP-05 report).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { resolveRepo } from './repo-resolve.js';

const HAS_GIT = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

let tmp = '';
let root = '';
let repo = '';
let outsideRepo = '';

function raw(args: string[], cwd: string): void {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

before(async () => {
  if (!HAS_GIT) return;
  tmp = await mkdtemp(join(tmpdir(), 'ikenga-git-mcp-resolve-'));
  root = join(tmp, 'project-root');
  repo = join(root, 'nested', 'child-repo');
  outsideRepo = join(tmp, 'not-a-known-project');

  await mkdir(repo, { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], repo);

  await mkdir(outsideRepo, { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], outsideRepo);
});

after(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const knownRoots = (roots: string[]) => async () => ({ ok: true as const, roots });
const rootsUnreachable = async () => ({ ok: false as const, message: 'app not running' });

test('resolveRepo: a nested repo under a known root resolves ok', { skip: !HAS_GIT }, async () => {
  const res = await resolveRepo(repo, knownRoots([root]));
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.resolved.repo, resolve(repo));
    assert.equal(res.resolved.projectRoot, resolve(root));
    assert.equal(res.resolved.relPath, 'nested/child-repo');
  }
});

test('resolveRepo: the root itself resolves with relPath "."', { skip: !HAS_GIT }, async () => {
  await mkdir(join(tmp, 'solo'), { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], join(tmp, 'solo'));
  const res = await resolveRepo(join(tmp, 'solo'), knownRoots([join(tmp, 'solo')]));
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.resolved.relPath, '.');
});

test('resolveRepo: a repo outside every known root is refused', { skip: !HAS_GIT }, async () => {
  const res = await resolveRepo(outsideRepo, knownRoots([root]));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'repo-not-known');
});

test('resolveRepo: a directory that is not a git repo at all fails not-a-repository, never repo-not-known first', { skip: !HAS_GIT }, async () => {
  const res = await resolveRepo(tmp, knownRoots([tmp]));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'not-a-repository');
});

test('resolveRepo: when the roots resolver fails (app not running), refuses as repo-not-known — fail closed', { skip: !HAS_GIT }, async () => {
  const res = await resolveRepo(repo, rootsUnreachable);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, 'repo-not-known');
    assert.match(res.message, /app not running/);
  }
});
