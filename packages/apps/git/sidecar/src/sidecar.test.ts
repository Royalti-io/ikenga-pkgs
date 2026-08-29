/**
 * com.ikenga.git · sidecar — end-to-end, through the real process boundary.
 *
 * These tests do NOT import the handlers. They spawn the sidecar the way the
 * shell does — a fresh process per call, request on stdin, response on stdout,
 * exit 0 — because that boundary is where this WP's guarantees actually live:
 *
 *   · **exit 0 on operational failure.** `pkg_sidecar_call` reads a non-zero
 *     exit as `result.ok === false` and never looks at stdout, which would
 *     bury a perfectly good `{ok:false, reason:'not-a-repository'}` behind
 *     "exit code 1". An in-process test cannot catch that regression.
 *   · **one JSON object as the LAST line of stdout.** The shell parses exactly
 *     that (`pkg-iframe-host.tsx`, the `host.pkgSidecarCall` branch). A stray
 *     `console.log` in any dependency would become the "response".
 *   · **the argv/env discipline**, which only exists in a real spawn.
 *
 * Prefers `dist/sidecar.js` — the artefact the kernel actually runs — and
 * falls back to the TypeScript entry under `tsx` when the bundle has not been
 * built, so the suite is green on a fresh clone.
 *
 *   cd packages/apps/git && node --test --import=tsx 'sidecar/src/**\/*.test.ts'
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import {
  RPC_METHODS,
  type RpcMethod,
  type RpcResponse,
} from '../../core/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'dist', 'sidecar.js');
const ENTRY = join(HERE, 'index.ts');

const HAS_GIT = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

/** How the shell spawns it, or the source entry when unbuilt. */
function spawnArgs(): string[] {
  return existsSync(BUNDLE) ? [BUNDLE, 'rpc'] : ['--import', 'tsx', ENTRY, 'rpc'];
}

interface Call {
  response: RpcResponse<Record<string, unknown>> | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * One request → one fresh process, exactly as `pkg_sidecar_call` does it.
 *
 * The response is taken from the LAST non-empty stdout line, which is the
 * shell's own rule — so a test that passes here cannot fail in the shell for
 * transport reasons.
 */
function call(method: string, params?: unknown, env: NodeJS.ProcessEnv = {}): Promise<Call> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, spawnArgs(), {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (exitCode) => {
      const last = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      let response: RpcResponse<Record<string, unknown>> | null = null;
      if (last) {
        try {
          response = JSON.parse(last) as RpcResponse<Record<string, unknown>>;
        } catch {
          response = null;
        }
      }
      resolve({ response, stdout, stderr, exitCode });
    });
    child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })}\n`);
  });
}

/** The `result` payload, asserted to exist. */
async function result(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const res = await call(method, params);
  assert.equal(res.exitCode, 0, `${method} exited ${String(res.exitCode)}: ${res.stderr}`);
  assert.ok(res.response, `${method} produced no parseable response. stdout=${res.stdout}`);
  assert.equal(res.response.error, undefined, `${method} returned a JSON-RPC error`);
  return res.response.result as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture — a meta-repo with a nested child, a worktree, and real history.
// Built with raw `git`, deliberately: `init` and `worktree add` are NOT on
// git-core's subcommand allowlist, which is the point.
// ─────────────────────────────────────────────────────────────────────────────

let tmp = '';
let root = ''; // the project root, itself a repo
let child = ''; // a nested independent clone, gitignored by the parent

function raw(args: string[], cwd: string): void {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

/** Identity as repo-LOCAL config: the sidecar carries no identity code, and
 *  `GIT_CONFIG_GLOBAL` is on git-core's env denylist so it could not be used
 *  here even if we wanted it. */
function identify(repo: string): void {
  raw(['config', 'user.name', 'Ikenga Test'], repo);
  raw(['config', 'user.email', 'test@ikenga.dev'], repo);
  raw(['config', 'commit.gpgsign', 'false'], repo);
}

before(async () => {
  if (!HAS_GIT) return;
  tmp = await mkdtemp(join(tmpdir(), 'ikenga-git-sidecar-'));
  root = join(tmp, 'workspace');
  child = join(root, 'child');
  await mkdir(join(root, 'src'), { recursive: true });

  raw(['init', '-q', '-b', 'main', '.'], root);
  identify(root);
  await writeFile(join(root, '.gitignore'), 'child/\n');
  await writeFile(join(root, 'src', 'a.txt'), 'one\ntwo\nthree\n');
  raw(['add', '.'], root);
  raw(['commit', '-qm', 'root: initial'], root);
  raw(['branch', 'side'], root);
  raw(['worktree', 'add', '-q', join(tmp, 'wt-side'), 'side'], root);

  await mkdir(child, { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], child);
  identify(child);
  await writeFile(join(child, 'c.txt'), 'child\n');
  raw(['add', '.'], child);
  raw(['commit', '-qm', 'child: initial'], child);

  // Leave the parent dirty so `changes.list` has something to report.
  await writeFile(join(root, 'src', 'a.txt'), 'one\ntwo\nthree\nfour\n');
  await writeFile(join(root, 'src', 'new.txt'), 'brand new\n');
});

after(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// DoD: "RPC responds to every method in drafts/rpc.ts"
// ─────────────────────────────────────────────────────────────────────────────

test('every method in RPC_METHODS is dispatched, none reports methodNotFound', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  // Arguments chosen so each method reaches its handler. A method that returns
  // `{ok:false, reason}` here has still RESPONDED — what this asserts is that
  // no method falls through the switch or the envelope.
  const args: Record<RpcMethod, unknown> = {
    'system.probe': {},
    'project.scan': { root },
    'repo.snapshot': { repo: root },
    'repo.aheadBehind': { repo: root, base: 'side', head: 'main' },
    // No remote configured: this must fail as a git error, not an envelope one.
    'repo.fetch': { repo: root },
    'changes.list': { repo: root },
    'changes.diff': { repo: root, path: 'src/a.txt', side: 'unstaged' },
    'changes.stage': { repo: root, paths: ['src/new.txt'] },
    'changes.unstage': { repo: root, paths: ['src/new.txt'] },
    'commit.create': { repo: root, paths: [], message: 'noop probe' },
    'history.log': { repo: root, limit: 5 },
    'history.commit': { repo: root, sha: headSha(root) },
    'branch.list': { repo: root },
    'branch.create': { repo: root, name: 'probe/created' },
    'branch.checkout': { repo: root, name: 'main', confirm: true },
    'worktree.list': { repo: root },
    'worktree.add': { repo: root, path: 'test-wt' },
    'worktree.remove': { repo: root, path: 'test-wt' },
    'repo.staleBase': { repo: root, base: 'main' },
    'pr.list': { repo: root },
    'pr.checkout': { repo: root, number: 1 },
    'pr.create': { repo: root, title: 'test pr', body: 'test body' },
  };

  assert.equal(Object.keys(args).length, RPC_METHODS.length, 'coverage table drifted from RPC_METHODS');

  for (const method of RPC_METHODS) {
    const res = await call(method, args[method]);
    assert.equal(res.exitCode, 0, `${method} exited ${String(res.exitCode)}`);
    assert.ok(res.response, `${method} produced no parseable response (stdout=${res.stdout})`);
    assert.equal(
      res.response.error,
      undefined,
      `${method} returned a JSON-RPC error: ${JSON.stringify(res.response.error)}`
    );
    const payload = res.response.result as { ok?: unknown; reason?: unknown };
    assert.equal(typeof payload.ok, 'boolean', `${method} result has no ok discriminant`);
    if (payload.ok === false) {
      assert.equal(typeof payload.reason, 'string', `${method} failure carries no reason`);
    }
  }
});

function headSha(repo: string): string {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
  return res.stdout.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification 3 — nested repos, and the cross-repo staging guard (G-11)
// ─────────────────────────────────────────────────────────────────────────────

test('project.scan reports the root repo and every nested repo', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const res = await result('project.scan', { root });
  assert.equal(res.ok, true);
  const project = res.project as {
    rootIsRepo: boolean;
    repos: { relPath: string; branch: string | null; nested: unknown[] }[];
  };

  assert.equal(project.rootIsRepo, true);
  const paths = project.repos.map((r) => r.relPath);
  assert.ok(paths.includes('.'), `root repo missing from ${JSON.stringify(paths)}`);
  assert.ok(paths.includes('child'), `nested repo missing from ${JSON.stringify(paths)}`);
  assert.equal(project.repos[0]?.relPath, '.', 'root repo must sort first');

  // The nested clone is gitignored by its parent — the workspace's own oddity,
  // surfaced as data rather than left as tribal knowledge.
  const nested = project.repos[0]?.nested as { name: string; ignoredByParent: boolean }[];
  const asChild = nested.find((n) => n.name === 'child');
  assert.ok(asChild, 'child not described as nested under the root');
  assert.equal(asChild.ignoredByParent, true);
});

test('staging a child-repo path from the root repo is refused (G-11)', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const res = await result('changes.stage', { repo: root, paths: ['child/c.txt'] });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'cross-repo-path');
  assert.equal(res.path, 'child/c.txt');
  assert.equal(res.ownerRepo, child, 'the error must name the repo that DOES own the path');
});

test('the guard catches a repo nested deeper than the scan depth ceiling', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  // `MAX_SCAN_DEPTH` is 4. An ownership check built on `scanForRepos` would
  // never see this repo and would let the parent stage its file — the exact
  // failure the guard exists to prevent, silently. The upward walk has no
  // depth ceiling, so it does.
  const deep = join(root, 'a', 'b', 'c', 'd', 'e', 'deep-repo');
  await mkdir(deep, { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], deep);
  await writeFile(join(deep, 'f.txt'), 'deep\n');

  const res = await result('changes.stage', {
    repo: root,
    paths: ['a/b/c/d/e/deep-repo/f.txt'],
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'cross-repo-path');
  assert.equal(res.ownerRepo, deep);

  // And naming the nested repo's own directory is refused too — staging it
  // from the parent would record a gitlink.
  const asDir = await result('changes.stage', { repo: root, paths: ['a/b/c/d/e/deep-repo'] });
  assert.equal(asDir.reason, 'cross-repo-path');
  assert.equal(asDir.ownerRepo, deep);

  await rm(join(root, 'a'), { recursive: true, force: true });
});

test('a path outside the repo entirely is refused before git sees it', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  // `..` is rejected at the Zod parse boundary as a hardening failure, so this
  // classifies as unsafe-argument rather than cross-repo-path.
  const res = await result('changes.stage', { repo: root, paths: ['../escape.txt'] });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unsafe-argument');
});

// ─────────────────────────────────────────────────────────────────────────────
// Verification 6 — option injection, at the RPC boundary (G-02, rpc.ts DELTA 5)
// ─────────────────────────────────────────────────────────────────────────────

test('option-injection payloads are rejected as unsafe-argument, not flattened', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const injections: [string, unknown][] = [
    ['changes.stage', { repo: root, paths: ['--upload-pack=touch /tmp/pwn'] }],
    ['changes.unstage', { repo: root, paths: ['-c core.sshCommand=touch /tmp/pwn'] }],
    ['changes.diff', { repo: root, path: '--ext-diff', side: 'unstaged' }],
    ['history.log', { repo: root, ref: '-x' }],
    ['branch.create', { repo: root, name: '--force' }],
    ['branch.checkout', { repo: root, name: '--upload-pack=touch /tmp/pwn' }],
    ['repo.aheadBehind', { repo: root, base: '-x' }],
    ['repo.fetch', { repo: root, remote: '--receive-pack=touch /tmp/pwn' }],
  ];

  for (const [method, params] of injections) {
    const res = await result(method, params);
    assert.equal(res.ok, false, `${method} accepted an injection payload`);
    assert.equal(
      res.reason,
      'unsafe-argument',
      `${method} classified an injection as ${String(res.reason)} — the distinction verification 6 asserts on`
    );
  }
});

test('a wrong-typed argument is invalid-args, NOT unsafe-argument', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  // The classification split is the point: an ordinary type error must not be
  // reported as an attempted injection, or the audit trail is worthless.
  const res = await result('history.log', { repo: root, limit: 'lots' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'invalid-args');
});

test('a relative repo path is rejected before any spawn', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const res = await result('repo.snapshot', { repo: 'some/relative/path' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unsafe-argument');
});

// ─────────────────────────────────────────────────────────────────────────────
// Verification 7 — the four G-05 no-root states, each a value not a throw
// ─────────────────────────────────────────────────────────────────────────────

test('every no-root state is a named reason with no failed git spawn', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const noProject = await call('project.scan', {});
  assert.equal((noProject.response?.result as { reason?: string }).reason, 'no-project');
  assert.equal(noProject.stderr, '', 'the no-project state must not spawn git at all');

  const noRoot = await call('project.scan', { root: null });
  assert.equal((noRoot.response?.result as { reason?: string }).reason, 'no-project-root');
  assert.equal(noRoot.stderr, '');

  const plain = join(tmp, 'not-a-repo');
  await mkdir(plain, { recursive: true });
  const notRepo = await result('project.scan', { root: plain });
  assert.equal(notRepo.reason, 'not-a-repository');

  const gone = await result('project.scan', { root: join(tmp, 'does-not-exist') });
  assert.equal(gone.reason, 'unreadable');
});

test('a non-repo root that CONTAINS repos scans fine with rootIsRepo:false', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  // rpc.ts DELTA 3: not-a-repo + zero nested ⇒ not-a-repository;
  //                 not-a-repo + ≥1 nested ⇒ ok with rootIsRepo:false.
  const holder = join(tmp, 'holder');
  await mkdir(join(holder, 'inner'), { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], join(holder, 'inner'));

  const res = await result('project.scan', { root: holder });
  assert.equal(res.ok, true);
  const project = res.project as { rootIsRepo: boolean; repos: unknown[] };
  assert.equal(project.rootIsRepo, false);
  assert.equal(project.repos.length, 1);
});

test('a subdirectory of a repo is refused as a repo (no silent retarget)', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const res = await result('repo.snapshot', { repo: join(root, 'src') });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not-a-repository');
  assert.equal(res.ownerRepo, root, 'the error must name the repo the path really belongs to');
});

// ─────────────────────────────────────────────────────────────────────────────
// Round trip: stage → commit → history, with identity flowing from git config
// ─────────────────────────────────────────────────────────────────────────────

test('stage, commit and read back — the message never touches argv', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const scratch = join(tmp, 'commit-repo');
  await mkdir(scratch, { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], scratch);
  identify(scratch);
  await writeFile(join(scratch, 'f.txt'), 'v1\n');

  const staged = await result('changes.stage', { repo: scratch, paths: ['f.txt'] });
  assert.equal(staged.ok, true);
  assert.equal((staged.snapshot as { staged: number }).staged, 1);

  // A message that BEGINS with `-` and spans lines: proof that `-F -` keeps it
  // off argv entirely, and that trailers survive.
  const message = '--not-a-flag: a subject\n\nBody line.\n\nCo-Authored-By: Chi <chi@ikenga.dev>\n';
  const committed = await result('commit.create', { repo: scratch, paths: [], message });
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.match(committed.sha as string, /^[0-9a-f]{40}$/);
  assert.equal((committed.snapshot as { staged: number }).staged, 0);

  const log = await result('history.log', { repo: scratch, limit: 5 });
  const commits = log.commits as { subject: string; coAuthors: { email: string }[] }[];
  assert.equal(commits.length, 1);
  assert.equal(commits[0]?.subject, '--not-a-flag: a subject');
  assert.equal(commits[0]?.coAuthors[0]?.email, 'chi@ikenga.dev');
  assert.equal(
    (await result('history.commit', { repo: scratch, sha: committed.sha })).ok,
    true
  );
});

test(
  'R6 REGRESSION · an `MM` file commits its INDEX content; the worktree edit survives',
  async (t) => {
    if (!HAS_GIT) return t.skip('git not on PATH');

    // THE defect, through the real process boundary — the same path the shell
    // drives. Before the fix, `argv.commit` emitted `--only -- <paths>`, which
    // commits the WORKING TREE of those paths and ignores the index: this repo
    // ended up with B2 in HEAD while the pkg's staged-diff pane showed B1.
    const B1 = 'staged revision B1\n';
    const B2 = 'worktree revision B2 — never staged, never reviewed\n';

    const scratch = join(tmp, 'mm-repo');
    await mkdir(scratch, { recursive: true });
    raw(['init', '-q', '-b', 'main', '.'], scratch);
    identify(scratch);
    await writeFile(join(scratch, 'f.txt'), 'original\n');
    raw(['add', 'f.txt'], scratch);
    raw(['commit', '-qm', 'land f.txt'], scratch);

    await writeFile(join(scratch, 'f.txt'), B1);
    assert.equal((await result('changes.stage', { repo: scratch, paths: ['f.txt'] })).ok, true);
    await writeFile(join(scratch, 'f.txt'), B2);

    // Porcelain `MM` — staged AND further modified.
    assert.equal(
      spawnSync('git', ['status', '--short'], { cwd: scratch, encoding: 'utf8' }).stdout,
      'MM f.txt\n'
    );

    const committed = await result('commit.create', {
      repo: scratch,
      paths: ['f.txt'],
      message: 'index, not worktree\n',
    });
    assert.equal(committed.ok, true, JSON.stringify(committed));

    const showed = spawnSync('git', ['show', 'HEAD:f.txt'], { cwd: scratch, encoding: 'utf8' });
    assert.equal(showed.status, 0);
    assert.equal(showed.stdout, B1, 'HEAD must hold the STAGED content B1, not B2');
    assert.equal(
      spawnSync('git', ['status', '--short'], { cwd: scratch, encoding: 'utf8' }).stdout,
      ' M f.txt\n',
      'the unstaged edit must still be in the working tree'
    );
  }
);

test(
  'commit.create: requested paths ≠ staged set → staged-set-mismatch, nothing committed',
  async (t) => {
    if (!HAS_GIT) return t.skip('git not on PATH');

    const scratch = join(tmp, 'mismatch-repo');
    await mkdir(scratch, { recursive: true });
    raw(['init', '-q', '-b', 'main', '.'], scratch);
    identify(scratch);
    await writeFile(join(scratch, 'seed.txt'), 'seed\n');
    raw(['add', 'seed.txt'], scratch);
    raw(['commit', '-qm', 'seed'], scratch);
    const headBefore = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: scratch,
      encoding: 'utf8',
    }).stdout.trim();

    await writeFile(join(scratch, 'named.txt'), 'named\n');
    await writeFile(join(scratch, 'unnamed.txt'), 'never mentioned\n');
    assert.equal(
      (await result('changes.stage', { repo: scratch, paths: ['named.txt', 'unnamed.txt'] })).ok,
      true
    );

    // (i) a staged path the caller did not name.
    const extra = await result('commit.create', {
      repo: scratch,
      paths: ['named.txt'],
      message: 'should not happen\n',
    });
    assert.equal(extra.ok, false, JSON.stringify(extra));
    assert.equal(extra.reason, 'staged-set-mismatch');
    assert.match(extra.message as string, /also staged: unnamed\.txt/);

    // (ii) a named path that is not staged.
    await writeFile(join(scratch, 'ghost.txt'), 'not staged\n');
    const missing = await result('commit.create', {
      repo: scratch,
      paths: ['named.txt', 'unnamed.txt', 'ghost.txt'],
      message: 'should not happen either\n',
    });
    assert.equal(missing.ok, false, JSON.stringify(missing));
    assert.equal(missing.reason, 'staged-set-mismatch');
    assert.match(missing.message as string, /requested but not staged: ghost\.txt/);

    // `git log` is unchanged by BOTH refusals.
    assert.equal(
      spawnSync('git', ['rev-parse', 'HEAD'], { cwd: scratch, encoding: 'utf8' }).stdout.trim(),
      headBefore,
      'no commit may have been created'
    );
    assert.equal(
      spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: scratch, encoding: 'utf8' })
        .stdout.trim(),
      '1'
    );

    // (iii) the exact staged set is accepted.
    const okRes = await result('commit.create', {
      repo: scratch,
      paths: ['unnamed.txt', 'named.txt'],
      message: 'both, named explicitly\n',
    });
    assert.equal(okRes.ok, true, JSON.stringify(okRes));
    assert.equal(
      spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: scratch, encoding: 'utf8' })
        .stdout.trim(),
      '2'
    );
  }
);

test('commit.create refuses noVerify', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');
  const res = await result('commit.create', {
    repo: root,
    paths: [],
    message: 'x',
    noVerify: true,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'invalid-args');
});

// ─────────────────────────────────────────────────────────────────────────────
// G-12 confirm tier
// ─────────────────────────────────────────────────────────────────────────────

test('checkout on a dirty tree needs confirmation, then succeeds', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const dirty = join(tmp, 'dirty-repo');
  await mkdir(dirty, { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], dirty);
  identify(dirty);
  await writeFile(join(dirty, 'a.txt'), 'one\n');
  raw(['add', '.'], dirty);
  raw(['commit', '-qm', 'init'], dirty);
  raw(['branch', 'other'], dirty);
  await writeFile(join(dirty, 'a.txt'), 'one\ntwo\n');

  const refused = await result('branch.checkout', { repo: dirty, name: 'other' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'confirm-required');

  const confirmed = await result('branch.checkout', { repo: dirty, name: 'other', confirm: true });
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  assert.equal((confirmed.branch as { name: string }).name, 'other');
  assert.equal((confirmed.snapshot as { branch: string }).branch, 'other');
});

// ─────────────────────────────────────────────────────────────────────────────
// G-13 index.lock
// ─────────────────────────────────────────────────────────────────────────────

test('a held index.lock retries, then reports index-locked with a retry count', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const locked = join(tmp, 'locked-repo');
  await mkdir(locked, { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], locked);
  identify(locked);
  await writeFile(join(locked, 'a.txt'), 'one\n');
  raw(['add', '.'], locked);
  raw(['commit', '-qm', 'init'], locked);
  await writeFile(join(locked, 'a.txt'), 'two\n');
  await writeFile(join(locked, '.git', 'index.lock'), '');

  const res = await result('changes.stage', { repo: locked, paths: ['a.txt'] });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'index-locked');
  assert.equal(res.retries, 5, 'the retry budget must be reported so the UI can say how hard it tried');
  assert.equal(
    res.message,
    'another process is writing to this repo',
    'the copy must be the named state, never a raw git error'
  );

  // Reads are unaffected: they never take the lock.
  const read = await result('changes.list', { repo: locked });
  assert.equal(read.ok, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Diff
// ─────────────────────────────────────────────────────────────────────────────

test('changes.diff returns a unified patch with line counts, and truncates on a line boundary', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const diffRepo = join(tmp, 'diff-repo');
  await mkdir(diffRepo, { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], diffRepo);
  identify(diffRepo);
  await writeFile(join(diffRepo, 'big.txt'), `${Array.from({ length: 400 }, (_, i) => `line ${String(i)}`).join('\n')}\n`);
  raw(['add', '.'], diffRepo);
  raw(['commit', '-qm', 'init'], diffRepo);
  await writeFile(join(diffRepo, 'big.txt'), `${Array.from({ length: 400 }, (_, i) => `LINE ${String(i)}`).join('\n')}\n`);

  const full = await result('changes.diff', { repo: diffRepo, path: 'big.txt', side: 'unstaged' });
  const diff = full.diff as { patch: string; added: number; deleted: number; truncated: boolean };
  assert.equal(diff.truncated, false);
  assert.equal(diff.added, 400);
  assert.equal(diff.deleted, 400);

  const cut = await result('changes.diff', {
    repo: diffRepo,
    path: 'big.txt',
    side: 'unstaged',
    maxBytes: 500,
  });
  const cutDiff = cut.diff as { patch: string; truncated: boolean };
  assert.equal(cutDiff.truncated, true);
  assert.ok(cutDiff.patch.endsWith('\n'), 'a truncated patch must still end on a line boundary');

  // `sha` without `side:'commit'` (and vice versa) is a caller error the frozen
  // Zod schema cannot express, so the handler enforces it.
  const mismatched = await result('changes.diff', {
    repo: diffRepo,
    path: 'big.txt',
    side: 'commit',
  });
  assert.equal(mismatched.reason, 'invalid-args');
});

// ─────────────────────────────────────────────────────────────────────────────
// Envelope
// ─────────────────────────────────────────────────────────────────────────────

test('envelope failures are JSON-RPC errors; the process still exits 0', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const unknown = await call('git.rm', { repo: root });
  assert.equal(unknown.exitCode, 0);
  assert.equal(unknown.response?.error?.code, -32601);
  assert.equal(unknown.response?.result, undefined);
});

test('unparseable stdin is a parse error, not a crash', async () => {
  const child = spawn(process.execPath, spawnArgs(), { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
  child.stdin.end('this is not json\n');
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout.trim()) as RpcResponse;
  assert.equal(parsed.error?.code, -32700);
});

test('stdout carries exactly one JSON line per request and nothing else', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  const res = await call('system.probe', {});
  const lines = res.stdout.split('\n').filter((l) => l.trim().length > 0);
  assert.equal(lines.length, 1, `stdout had ${String(lines.length)} lines: ${res.stdout}`);
  assert.doesNotThrow(() => JSON.parse(lines[0] as string));
});

// ─────────────────────────────────────────────────────────────────────────────
// G-16 — the env asymmetry, through the real spawn path
// ─────────────────────────────────────────────────────────────────────────────

test('IKENGA_* is stripped from git children while the sidecar itself keeps it', async (t) => {
  if (!HAS_GIT) return t.skip('git not on PATH');

  // A `GIT_DIR` in the parent env would hijack EVERY git child away from its
  // `cwd`. If the denylist were not applied, this snapshot would describe the
  // decoy repo instead of `root` — a silent, total retarget that the cross-repo
  // guard cannot catch, because git would be reporting the hijacked repo
  // consistently.
  const decoy = join(tmp, 'decoy');
  await mkdir(decoy, { recursive: true });
  raw(['init', '-q', '-b', 'decoy-branch', '.'], decoy);

  const res = await call(
    'repo.snapshot',
    { repo: root },
    {
      IKENGA_AUTH_TOKEN: 'super-secret-token',
      GIT_DIR: join(decoy, '.git'),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.pager',
      GIT_CONFIG_VALUE_0: 'touch /tmp/pwn-from-env',
    }
  );

  const snapshot = (res.response?.result as { snapshot: { repo: string; branch: string } }).snapshot;
  assert.equal(snapshot.repo, root, 'GIT_DIR from the parent env must not retarget the child');
  assert.notEqual(snapshot.branch, 'decoy-branch');
  assert.equal(existsSync('/tmp/pwn-from-env'), false, 'GIT_CONFIG_* injection reached git');
});
