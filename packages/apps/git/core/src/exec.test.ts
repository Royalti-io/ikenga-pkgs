/**
 * `exec.ts` — spawn-failure classification.
 *
 * The property under test is the one the sweep caught: `child_process.spawn`
 * reports a missing CWD with the same `ENOENT` as a missing binary, so a naive
 * mapping tells a user with a working git that "git was not found on PATH".
 * These tests pin the disambiguation in both directions — a bad cwd must never
 * read as `git-missing`, and a good cwd must still let a real run succeed.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exec } from './exec.js';

test('exec: a nonexistent cwd is `unreadable`, NOT `git-missing`', async () => {
  const gone = join(tmpdir(), `com.ikenga.git-no-such-dir-${String(process.pid)}-${String(Date.now())}`);
  const res = await exec('git', ['rev-parse', '--show-toplevel'], { cwd: gone });

  assert.equal(res.ok, false);
  if (res.ok !== false) return;
  assert.notEqual(res.reason, 'git-missing');
  assert.equal(res.reason, 'unreadable');
  // The message must name the directory — "cannot read" with no path is the
  // same dead end as the wrong reason.
  assert.ok(res.message.includes(gone), `message should name the cwd: ${res.message}`);
  assert.equal(res.path, gone);
});

test('exec: a cwd that exists but is a FILE is `unreadable`, not `git-missing`', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'com.ikenga.git-exec-'));
  const file = join(dir, 'a-file');
  await writeFile(file, 'x');
  try {
    const res = await exec('git', ['rev-parse', '--show-toplevel'], { cwd: file });
    assert.equal(res.ok, false);
    if (res.ok !== false) return;
    assert.notEqual(res.reason, 'git-missing');
    assert.equal(res.reason, 'unreadable');
    assert.ok(res.message.includes(file), `message should name the cwd: ${res.message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('exec: a real cwd with git on PATH still runs (the disambiguation is not a blanket)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'com.ikenga.git-exec-'));
  try {
    const res = await exec('git', ['--version'], { cwd: dir });
    assert.equal(res.ok, true);
    if (res.ok !== true) return;
    assert.equal(res.outcome.code, 0);
    assert.match(res.outcome.stdout, /^git version /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
