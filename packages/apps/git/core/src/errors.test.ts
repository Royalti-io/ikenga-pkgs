/**
 * `errors.ts` — the frozen error vocabulary: construction, classification,
 * redaction.
 *
 *   cd packages/apps/git && npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyGitFailure,
  crossRepoPath,
  firstLine,
  fromGitFailure,
  gitError,
  notAllowed,
  redact,
  trimStderr,
} from './errors.js';
import { GIT_ERROR_REASONS, MAX_STDERR_CHARS, isGitError } from './rpc.js';

// ─────────────────────────────────────────────────────────────────────────────
// Redaction — nothing credential-shaped may reach a rendered error
// ─────────────────────────────────────────────────────────────────────────────

test('a credential embedded in a remote URL is redacted', () => {
  // The realistic leak: git echoes the remote URL with an inline credential
  // when a helper supplied one, and the UI renders stderr behind a disclosure.
  const raw = "fatal: unable to access 'https://nedjamez:ghp_ABCDEFGHIJKLMNOP1234@github.com/x/y.git/'";
  const clean = redact(raw);
  assert.equal(clean.includes('ghp_ABCDEFGHIJKLMNOP1234'), false);
  assert.ok(clean.includes('https://nedjamez:***@github.com'));
});

test('bare token shapes are redacted wherever they appear', () => {
  for (const token of [
    'ghp_ABCDEFGHIJKLMNOP1234',
    'gho_ABCDEFGHIJKLMNOP1234',
    'ghs_ABCDEFGHIJKLMNOP1234',
    'github_pat_11ABCDEFG0abcdefghijklmno',
  ]) {
    assert.equal(redact(`error: bad token ${token}`).includes(token), false, token);
  }
  assert.equal(redact('url?token=abc123&x=1').includes('abc123'), false);
  assert.equal(redact('password=hunter2').includes('hunter2'), false);
});

test('redaction runs on the message AND the stderr of a constructed error', () => {
  const e = gitError('git-failed', 'https://u:secretpw@h/x', {
    stderr: 'https://u:secretpw@h/x',
  });
  assert.equal(e.message.includes('secretpw'), false);
  assert.equal((e.stderr ?? '').includes('secretpw'), false);
});

test('stderr is capped, with the cut announced', () => {
  const long = 'x'.repeat(MAX_STDERR_CHARS + 500);
  const trimmed = trimStderr(long);
  assert.ok(trimmed.length < long.length);
  assert.match(trimmed, /more chars\)$/);
});

test('firstLine takes the useful sentence, not the advice block', () => {
  const stderr =
    'fatal: Unable to create index.lock: File exists.\n\nAnother git process seems to be running…\n';
  assert.equal(firstLine(stderr), 'fatal: Unable to create index.lock: File exists.');
  assert.equal(firstLine('\n\n  \n'), '');
});

// ─────────────────────────────────────────────────────────────────────────────
// Classification — G-13's two concurrency reasons
// ─────────────────────────────────────────────────────────────────────────────

test('index.lock contention classifies as `index-locked`', () => {
  // The user's own agents commit in the same repos while the UI stages. This
  // must read as a named, retryable state — never as a raw git error.
  for (const stderr of [
    "fatal: Unable to create '/repo/.git/index.lock': File exists.",
    'Another git process seems to be running in this repository',
    "error: unable to create '/repo/.git/index.lock': File exists",
  ]) {
    assert.equal(classifyGitFailure(128, stderr), 'index-locked', stderr);
  }
});

test('`index-locked` gets the user-facing copy, with the raw text still attached', () => {
  const e = fromGitFailure(128, "fatal: Unable to create '/r/.git/index.lock': File exists.");
  assert.equal(e.reason, 'index-locked');
  assert.equal(e.message, 'another process is writing to this repo');
  assert.ok((e.stderr ?? '').includes('index.lock'), 'the truth is still available behind a disclosure');
});

test('a sequenced operation in progress is refused, not half-applied', () => {
  for (const stderr of [
    'error: you have unmerged files.',
    'fatal: It seems that there is already a rebase-merge directory',
    'error: a cherry-pick is already in progress',
    'You are in the middle of a merge -- cannot amend.',
  ]) {
    assert.equal(classifyGitFailure(1, stderr), 'operation-in-progress', stderr);
  }
});

test('a dirty tree blocking a checkout is its own reason', () => {
  const stderr =
    'error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\n';
  assert.equal(classifyGitFailure(1, stderr), 'dirty-tree');
});

test('anything unrecognised stays `git-failed`, carrying exit code and stderr', () => {
  const e = fromGitFailure(1, "error: pathspec 'nope.txt' did not match any file(s) known to git");
  assert.equal(e.reason, 'git-failed');
  assert.equal(e.exitCode, 1);
  assert.match(e.message, /pathspec/);
});

test('"not a git repository" classifies as the named G-05 state', () => {
  assert.equal(
    classifyGitFailure(128, 'fatal: not a git repository (or any of the parent directories): .git'),
    'not-a-repository'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Construction
// ─────────────────────────────────────────────────────────────────────────────

test('cross-repo errors carry the owning repo so the UI can offer a jump', () => {
  const e = crossRepoPath('shell/src/main.rs', '/ws', '/ws/shell');
  assert.equal(e.reason, 'cross-repo-path');
  assert.equal(e.path, 'shell/src/main.rs');
  assert.equal(e.ownerRepo, '/ws/shell');
  assert.match(e.message, /belongs to \/ws\/shell/);
});

test('an unknown subcommand is `not-allowed`, naming it', () => {
  const e = notAllowed('push');
  assert.equal(e.reason, 'not-allowed');
  assert.equal(e.path, 'push');
});

test('every constructed error is a GitError and uses a frozen reason', () => {
  const built = [
    gitError('internal', 'x'),
    crossRepoPath('a', '/r', null),
    notAllowed('push'),
    fromGitFailure(1, 'boom'),
  ];
  for (const e of built) {
    assert.ok(isGitError(e));
    assert.equal(e.ok, false);
    assert.ok(
      (GIT_ERROR_REASONS as readonly string[]).includes(e.reason),
      `${e.reason} is not in the frozen union`
    );
  }
});

test('optional fields are omitted rather than set to undefined', () => {
  // The frozen shape allows them to be absent; emitting `exitCode: undefined`
  // survives JSON.stringify as a dropped key but not as a structured-clone
  // round trip, and the sidecar's transport is JSON either way.
  const e = gitError('no-project', 'no active project');
  assert.equal('exitCode' in e, false);
  assert.equal('stderr' in e, false);
  assert.equal('ownerRepo' in e, false);
});
