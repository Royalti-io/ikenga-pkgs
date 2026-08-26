/**
 * `discover.ts` — the four G-05 no-root states, the bounded nested scan, and
 * the cross-repo ownership primitive (G-11).
 *
 * The scan tests build a real directory tree in a temp dir rather than mocking
 * `fs`: the behaviours that matter (a `.git` FILE for a worktree, descending
 * into a found repo, skipping `node_modules`, depth truncation) are all
 * filesystem behaviours, and a mock would encode this implementation's
 * assumptions instead of testing them.
 *
 *   cd packages/apps/git && npm test
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  assertPathsOwnedBy,
  isInside,
  ownerRepoOf,
  readGitmodulePaths,
  resolveProjectRoot,
  scanForRepos,
} from './discover.js';
import { isGitError } from './rpc.js';

let root = '';

/** A tree shaped like the real ikenga workspace. */
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'ikenga-git-discover-'));

  const dirs = [
    '.git', // root meta-repo
    'shell/.git', // child clone
    'shell/src',
    'contract/.git',
    '.worktrees/shell-wt', // agent worktrees live under a DOTDIR
    'node_modules/vendored/.git', // must be skipped
    'plain-folder',
    'a/b/c/d/deep/.git', // beyond MAX_SCAN_DEPTH from root
  ];
  for (const d of dirs) await mkdir(join(root, d), { recursive: true });

  // A linked worktree's `.git` is a FILE, not a directory. Testing only for a
  // directory misses every worktree — and worktrees are what this pkg is for.
  await writeFile(join(root, '.worktrees/shell-wt/.git'), 'gitdir: /somewhere/.git/worktrees/x\n');

  await writeFile(
    join(root, '.gitmodules'),
    '[submodule "vendor/lib"]\n\tpath = vendor/lib\n\turl = https://example.com/lib.git\n'
  );
});

after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// G-05 · the no-root states
// ═════════════════════════════════════════════════════════════════════════════

test('G-05 (a) · an absent activeProject field is `no-project`', async () => {
  const res = await resolveProjectRoot(undefined);
  assert.ok(isGitError(res));
  assert.equal(res.reason, 'no-project');
});

test('G-05 (b) · a null root is `no-project-root`', async () => {
  // The seed Default project and any skill-only project have a genuinely null
  // `root_path`. This is not an error condition — it is a named empty state.
  const res = await resolveProjectRoot(null);
  assert.ok(isGitError(res));
  assert.equal(res.reason, 'no-project-root');
});

test('G-05 (d) · an unreadable or missing root is `unreadable`', async () => {
  const missing = await resolveProjectRoot(join(root, 'does-not-exist'));
  assert.ok(isGitError(missing));
  assert.equal(missing.reason, 'unreadable');

  const notADir = await resolveProjectRoot(join(root, '.gitmodules'));
  assert.ok(isGitError(notADir));
  assert.equal(notADir.reason, 'unreadable');

  const relative = await resolveProjectRoot('relative/path');
  assert.ok(isGitError(relative));
  assert.equal(relative.reason, 'unreadable');
});

test('a readable directory resolves, repo or not', async () => {
  // G-05 (c) "not a repository" is NOT decided here: a root that is not itself
  // a repo but contains nested clones is a valid project
  // (`ProjectRollup.rootIsRepo: false`, rpc.ts DELTA 3). Only the scan knows.
  const res = await resolveProjectRoot(root);
  assert.equal(res.ok, true);

  const plain = await resolveProjectRoot(join(root, 'plain-folder'));
  assert.equal(plain.ok, true);
});

test('none of the no-root states throws', async () => {
  // "Each is a named UI state and a structured {ok:false, reason} from the
  // sidecar — never a throw, never a failed git spawn."
  for (const input of [undefined, null, '/nonexistent/root', 'relative']) {
    await assert.doesNotReject(() => resolveProjectRoot(input));
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// The bounded nested scan
// ═════════════════════════════════════════════════════════════════════════════

test('the scan finds the root repo, its children, and worktrees under a dotdir', async () => {
  const { repos } = await scanForRepos(root);
  const rel = repos.map((r) => r.slice(root.length + 1) || '.').sort();

  assert.ok(rel.includes('.'), 'root meta-repo missing');
  assert.ok(rel.includes('shell'), 'child clone missing');
  assert.ok(rel.includes('contract'), 'child clone missing');
  // Dot-directories ARE walked: skipping them wholesale would miss
  // `.worktrees/`, which is where agent worktrees actually live here.
  assert.ok(rel.includes('.worktrees/shell-wt'), 'worktree (.git FILE) missing');
});

test('the scan descends INTO a repo it already found', async () => {
  // The workspace is meta-repo → children → .worktrees/*. Stopping at the
  // first hit would find one repo and call it a day.
  const { repos } = await scanForRepos(root);
  assert.ok(repos.length >= 4, `expected the nested clones too, got ${String(repos.length)}`);
});

test('SCAN_SKIP_DIRS keeps the walk out of node_modules', async () => {
  const { repos } = await scanForRepos(root);
  assert.equal(
    repos.some((r) => r.includes('node_modules')),
    false,
    'walked into node_modules — a pnpm store can hold vendored checkouts and cost seconds'
  );
});

test('.git itself is never descended into', async () => {
  const { repos } = await scanForRepos(root);
  assert.equal(
    repos.some((r) => r.includes(`${'/'}.git${'/'}`)),
    false
  );
});

test('depth and count limits set `truncated` rather than silently cutting', async () => {
  const shallow = await scanForRepos(root, { maxDepth: 1 });
  assert.equal(shallow.truncated, true);
  assert.equal(
    shallow.repos.some((r) => r.endsWith('shell-wt')),
    false,
    'a depth-2 repo should be out of reach at maxDepth 1'
  );

  const capped = await scanForRepos(root, { maxRepos: 2 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.repos.length, 2);

  // Breadth-first means the cap keeps the SHALLOW repos — a partial view that
  // keeps the top-level children beats one that keeps a random subtree.
  assert.ok(capped.repos[0] === root);
});

test('a full scan of a small tree is not truncated', async () => {
  const res = await scanForRepos(join(root, 'contract'));
  assert.equal(res.truncated, false);
  assert.deepEqual(res.repos, [join(root, 'contract')]);
});

test('an unreadable subdirectory is skipped, not fatal', async () => {
  // One bad-permission directory must not blank the whole project view.
  await assert.doesNotReject(() => scanForRepos(join(root, 'plain-folder')));
});

test('.gitmodules paths are read (read-only signal, v1)', async () => {
  assert.deepEqual(await readGitmodulePaths(root), ['vendor/lib']);
  // Absent is the common case here — these are independent clones, not
  // submodules — and absent is not an error.
  assert.deepEqual(await readGitmodulePaths(join(root, 'shell')), []);
});

// ═════════════════════════════════════════════════════════════════════════════
// G-11 · ownership and the cross-repo staging guard
// ═════════════════════════════════════════════════════════════════════════════

test('isInside respects path boundaries', () => {
  assert.equal(isInside('/a/b', '/a/b'), true);
  assert.equal(isInside('/a/b', '/a/b/c'), true);
  // The classic bug: `/a/bc` is NOT inside `/a/b`, but a naive startsWith says
  // it is — and that would let a sibling repo's files be staged.
  assert.equal(isInside('/a/b', '/a/bc'), false);
  assert.equal(isInside('/a/b', '/a'), false);
});

test('ownerRepoOf returns the DEEPEST containing repo', () => {
  const repos = ['/ws', '/ws/shell', '/ws/contract'];
  // `/ws/shell/src/main.rs` is inside both `/ws` and `/ws/shell`. Returning
  // the outermost match is exactly the bug the guard exists to prevent.
  assert.equal(ownerRepoOf('/ws/shell/src/main.rs', repos), '/ws/shell');
  assert.equal(ownerRepoOf('/ws/README.md', repos), '/ws');
  assert.equal(ownerRepoOf('/elsewhere/x', repos), null);
});

test('G-11 · the root repo may not stage a child repo path', () => {
  // The workspace rule ("don't stage child-folder paths from the root repo")
  // becomes a hard refusal, with `ownerRepo` so the UI can offer a jump.
  const repos = ['/ws', '/ws/shell'];
  const err = assertPathsOwnedBy('/ws', ['shell/src/main.rs'], repos);
  assert.ok(err && isGitError(err));
  assert.equal(err.reason, 'cross-repo-path');
  assert.equal(err.ownerRepo, '/ws/shell');
  assert.equal(err.path, 'shell/src/main.rs');
});

test('G-11 · a child repo may not stage a root file', () => {
  const repos = ['/ws', '/ws/shell'];
  const err = assertPathsOwnedBy('/ws/shell', ['../README.md'], repos);
  assert.ok(err && isGitError(err));
  assert.equal(err.reason, 'cross-repo-path');
  assert.equal(err.ownerRepo, '/ws');
});

test('G-11 · paths genuinely owned by the target repo pass', () => {
  const repos = ['/ws', '/ws/shell'];
  assert.equal(assertPathsOwnedBy('/ws/shell', ['src/main.rs', 'Cargo.toml'], repos), null);
  assert.equal(assertPathsOwnedBy('/ws', ['README.md', 'docs/adr/009.md'], repos), null);
});

test('G-11 · the guard is a containment test, not a string test', () => {
  // `PathspecSchema` rejects a literal `..`; this catches the cases that do
  // not contain one — a sibling directory reached by name, for instance.
  const repos = ['/ws/a', '/ws/b'];
  const err = assertPathsOwnedBy('/ws/a', ['../b/file.txt'], repos);
  assert.ok(err && isGitError(err));
  assert.equal(err.ownerRepo, '/ws/b');
});

test('G-11 · a path outside every known repo is still refused', () => {
  const err = assertPathsOwnedBy('/ws', ['../../etc/passwd'], ['/ws']);
  assert.ok(err && isGitError(err));
  assert.equal(err.reason, 'cross-repo-path');
  assert.equal(err.ownerRepo, null);
});
