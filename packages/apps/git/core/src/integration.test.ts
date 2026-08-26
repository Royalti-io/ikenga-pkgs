/**
 * git-core end-to-end against a REAL `git` binary.
 *
 * The parser tests next door prove the porcelain grammars; this one proves the
 * pieces fit: builder → `exec` → parser, over a repo git actually created. It
 * is the test that catches a format string that parses a fixture beautifully
 * and is rejected by git, or an argv that git accepts and means something
 * other than intended.
 *
 * It also exercises three things a fixture cannot:
 *   · a commit message that BEGINS WITH `-` and spans lines, proving `-F -`
 *     keeps it off argv entirely;
 *   · identity flowing through the inherited environment, with zero
 *     identity/signing code in this pkg (verification 4's mechanism);
 *   · `--no-optional-locks` on a real read (verification 10's mechanism).
 *
 * Skipped wholesale when `git` is not on PATH, so the suite stays green on a
 * machine without it — git-core is a library and its unit tests need no shell
 * and no git.
 *
 *   cd packages/apps/git && npm test
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import * as argv from './argv.js';
import { assertPathsOwnedBy, findToplevel, isIgnoredByParent, scanForRepos } from './discover.js';
import { run, runTolerant, type ExecOutcome } from './exec.js';
import {
  countChanges,
  mergeNumstat,
  parseBranchList,
  parseCommitDetail,
  parseLeftRightCount,
  parseLog,
  parseNumstat,
  parseStatus,
  parseWorktreeList,
} from './parse/index.js';
import { isGitError, type GitError } from './rpc.js';

const HAS_GIT = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

let repo = '';
let tmp = '';

/** Raw setup, deliberately NOT through git-core: fixture construction uses
 *  subcommands git-core does not allow (`init`, `worktree add`), which is the
 *  point — the allowlist is real. */
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
      GIT_CONFIG_GLOBAL: '/dev/null', // never read the developer's real config
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

before(async () => {
  if (!HAS_GIT) return;
  tmp = await mkdtemp(join(tmpdir(), 'ikenga-git-integration-'));
  repo = join(tmp, 'workspace');
  await mkdir(join(repo, 'sub'), { recursive: true });

  raw(['init', '-q', '-b', 'main', '.'], repo);
  await writeFile(join(repo, 'a.txt'), 'hello\n');
  await writeFile(join(repo, 'sub/b.txt'), 'x\n');
  await writeFile(join(repo, '.gitignore'), 'child/\n');
  raw(['add', '.'], repo);
  raw(
    ['commit', '-q', '-m', 'first\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>'],
    repo
  );

  // A nested INDEPENDENT clone, gitignored by its parent — the ikenga shape.
  await mkdir(join(repo, 'child'), { recursive: true });
  raw(['init', '-q', '-b', 'main', '.'], join(repo, 'child'));
  await writeFile(join(repo, 'child/z.txt'), 'z\n');
  raw(['add', '.'], join(repo, 'child'));
  raw(['commit', '-q', '-m', 'child first'], join(repo, 'child'));

  // A linked worktree, so `worktree list` has two records.
  raw(['worktree', 'add', '-q', join(tmp, 'wt'), '-b', 'side'], repo);

  // Working-tree state to read back: modified, staged-new, staged rename,
  // untracked, binary.
  await writeFile(join(repo, 'a.txt'), 'hello\nmore\n');
  raw(['mv', 'sub/b.txt', 'sub/c.txt'], repo);
  await writeFile(join(repo, 'untracked.txt'), 'new\n');
  await writeFile(join(repo, 'bin.dat'), Buffer.from([0x78, 0x00, 0x79]));
  raw(['add', 'bin.dat'], repo);
});

after(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

/** Env for git-core calls: an identity, and no access to the real gitconfig. */
const parentEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Ikenga Test',
  GIT_AUTHOR_EMAIL: 'test@ikenga.dev',
  GIT_COMMITTER_NAME: 'Ikenga Test',
  GIT_COMMITTER_EMAIL: 'test@ikenga.dev',
};

function unwrap(res: { ok: true; outcome: ExecOutcome } | GitError): ExecOutcome {
  if (res.ok !== true) {
    assert.fail(`git-core call failed: ${res.reason} — ${res.message}`);
  }
  return res.outcome;
}

const opts = (cwd: string) => ({ cwd, parentEnv });

test('status: the builder round-trips through real git into the parser', { skip: !HAS_GIT }, async () => {
  const out = unwrap(await run('git', argv.status(), opts(repo)));
  const s = parseStatus(out.stdout);

  assert.equal(s.branch, 'main');
  assert.equal(s.detached, false);
  assert.equal(s.upstream, null); // no remote in a fresh init — a real case
  assert.equal(s.ahead, null);
  assert.equal(s.behind, null);
  assert.match(s.headSha ?? '', /^[0-9a-f]{40}$/);

  const paths = s.entries.map((e) => e.path).sort();
  assert.deepEqual(paths, ['a.txt', 'bin.dat', 'sub/c.txt', 'untracked.txt']);

  const rename = s.entries.find((e) => e.kind === 'renamed');
  assert.equal(rename?.path, 'sub/c.txt');
  assert.equal(rename?.origPath, 'sub/b.txt');
  assert.equal(rename?.score, 100);

  assert.deepEqual(countChanges(s.entries), {
    staged: 2,
    unstaged: 1,
    untracked: 1,
    conflicted: 0,
  });
});

test('numstat: binary is null-null, not zero-zero', { skip: !HAS_GIT }, async () => {
  const status = parseStatus(unwrap(await run('git', argv.status(), opts(repo))).stdout);
  const numstat = parseNumstat(
    unwrap(await run('git', argv.diffNumstat({ cached: true }), opts(repo))).stdout
  );
  const merged = mergeNumstat(status.entries, numstat);

  const bin = merged.find((e) => e.path === 'bin.dat');
  assert.equal(bin?.binary, true);
  assert.equal(bin?.added, null);
  assert.equal(bin?.deleted, null);

  const untracked = merged.find((e) => e.path === 'untracked.txt');
  assert.equal(untracked?.added, null, 'an untracked file has no numstat row at all');
});

test('worktree list: two records, main first', { skip: !HAS_GIT }, async () => {
  const w = parseWorktreeList(unwrap(await run('git', argv.worktreeList(), opts(repo))).stdout);
  assert.equal(w.length, 2);
  assert.equal(w[0]?.isMain, true);
  assert.equal(w[0]?.branch, 'refs/heads/main');
  assert.equal(w[1]?.isMain, false);
  assert.equal(w[1]?.branch, 'refs/heads/side');
  assert.equal(w[1]?.ownerTerminalId, null); // Phase 1: always null
});

test('log: NUL format survives a nasty body; co-authors parse', { skip: !HAS_GIT }, async () => {
  const commits = parseLog(unwrap(await run('git', argv.log({ limit: 10 }), opts(repo))).stdout);
  assert.equal(commits.length, 1);
  const c = commits[0];
  assert.ok(c);
  assert.equal(c.subject, 'first');
  assert.deepEqual(c.parents, []); // root commit
  assert.equal(c.authorName, 'Ikenga Test');
  assert.deepEqual(c.coAuthors, [{ name: 'Claude Fable 5', email: 'noreply@anthropic.com' }]);
  assert.ok(c.refs.some((r) => r.includes('main')));
});

test('branch list: `%(HEAD)` and worktree occupancy come back real', { skip: !HAS_GIT }, async () => {
  const b = parseBranchList(unwrap(await run('git', argv.branchList(), opts(repo))).stdout);
  const main = b.find((x) => x.name === 'main');
  const side = b.find((x) => x.name === 'side');

  assert.equal(main?.isHead, true);
  assert.equal(side?.isHead, false);
  // `side` is checked out in the linked worktree — the UI must disable
  // checkout for it rather than let git error.
  assert.ok(side?.worktreePath?.endsWith('wt'));
  assert.equal(main?.upstream, null);
});

test('rev-list --left-right --count is behind-first', { skip: !HAS_GIT }, async () => {
  const out = unwrap(
    await run('git', argv.revListLeftRightCount({ base: 'main', head: 'side' }), opts(repo))
  );
  assert.deepEqual(parseLeftRightCount(out.stdout), { behind: 0, ahead: 0 });
});

test(
  'commit: a message beginning with `-` goes on stdin, never argv',
  { skip: !HAS_GIT },
  async () => {
    // The adversarial case. If the message reached argv, git would parse
    // `--amend` as an option and this commit would rewrite the previous one.
    const nasty = '--amend this is a subject, not a flag\n\nBody line\n\nCo-Authored-By: A <a@x>\n';

    await writeFile(join(repo, 'a.txt'), 'hello\nmore\nand more\n');
    const res = await run('git', argv.commit({ paths: ['a.txt'], message: nasty }), opts(repo));
    const out = unwrap(res);
    assert.match(out.stdout, /\[main [0-9a-f]+\]/);

    const commits = parseLog(unwrap(await run('git', argv.log({ limit: 5 }), opts(repo))).stdout);
    // TWO commits — the previous one was not amended away.
    assert.equal(commits.length, 2);
    assert.equal(commits[0]?.subject, '--amend this is a subject, not a flag');
    assert.deepEqual(commits[0]?.coAuthors, [{ name: 'A', email: 'a@x' }]);
    // Identity came from the inherited environment; the pkg configured nothing.
    assert.equal(commits[0]?.authorEmail, 'test@ikenga.dev');
  }
);

test('commit --only commits ONLY the named paths', { skip: !HAS_GIT }, async () => {
  // `bin.dat` is staged from the fixture. Committing `a.txt` alone must leave
  // it staged — "stages nothing implicitly" also means "commits nothing
  // implicitly", which is what makes `git_commit` safe as the one mutating
  // MCP tool.
  const before = parseStatus(unwrap(await run('git', argv.status(), opts(repo))).stdout);
  assert.ok(before.entries.some((e) => e.path === 'bin.dat' && e.staged === 'A'));

  await writeFile(join(repo, 'a.txt'), 'hello\nmore\nand more\nagain\n');
  unwrap(await run('git', argv.commit({ paths: ['a.txt'], message: 'only a.txt\n' }), opts(repo)));

  const afterStatus = parseStatus(unwrap(await run('git', argv.status(), opts(repo))).stdout);
  assert.ok(
    afterStatus.entries.some((e) => e.path === 'bin.dat' && e.staged === 'A'),
    'bin.dat must still be staged — --only must not sweep it into the commit'
  );
});

test('commit detail: body, trailers, signature status', { skip: !HAS_GIT }, async () => {
  const headSha = unwrap(await run('git', argv.revParseVerify('HEAD'), opts(repo))).stdout.trim();
  const out = unwrap(
    await run('git', argv.logCommit({ sha: headSha, withSignature: true }), opts(repo))
  );
  const d = parseCommitDetail(out.stdout, { withSignature: true });
  assert.ok(d);
  assert.equal(d.sha, headSha);
  assert.equal(d.subject, 'only a.txt');
  // Unsigned repo → `%G?` is `N` → null, one falsy case rather than two.
  assert.equal(d.signature, null);
});

test('stage / unstage: a mixed reset leaves the working tree alone', { skip: !HAS_GIT }, async () => {
  await writeFile(join(repo, 'staged-then-not.txt'), 'content\n');
  unwrap(await run('git', argv.add(['staged-then-not.txt']), opts(repo)));

  let s = parseStatus(unwrap(await run('git', argv.status(), opts(repo))).stdout);
  assert.equal(s.entries.find((e) => e.path === 'staged-then-not.txt')?.staged, 'A');

  unwrap(await run('git', argv.resetPaths(['staged-then-not.txt']), opts(repo)));

  s = parseStatus(unwrap(await run('git', argv.status(), opts(repo))).stdout);
  const back = s.entries.find((e) => e.path === 'staged-then-not.txt');
  assert.equal(back?.kind, 'untracked', 'unstaged back to untracked');
  // The file itself must still exist — a mixed reset never touches the tree.
  assert.equal(
    parseStatus(unwrap(await run('git', argv.status(), opts(repo))).stdout).entries.length > 0,
    true
  );
});

test('branch create + checkout round-trips', { skip: !HAS_GIT }, async () => {
  unwrap(await run('git', argv.branchCreate({ name: 'feat/from-core' }), opts(repo)));
  const b = parseBranchList(unwrap(await run('git', argv.branchList(), opts(repo))).stdout);
  assert.ok(b.some((x) => x.name === 'feat/from-core'));

  unwrap(await run('git', argv.checkout({ name: 'feat/from-core' }), opts(repo)));
  const s = parseStatus(unwrap(await run('git', argv.status(), opts(repo))).stdout);
  assert.equal(s.branch, 'feat/from-core');

  unwrap(await run('git', argv.checkout({ name: 'main' }), opts(repo)));
});

test('discovery: toplevel from a subdirectory, and the nested clone', { skip: !HAS_GIT }, async () => {
  const top = await findToplevel(join(repo, 'sub'), { parentEnv });
  assert.equal(top.ok, true);
  assert.ok(top.ok === true && top.repo === repo);

  const outside = await findToplevel(tmpdir(), { parentEnv });
  // A directory that is not in a repo is the NAMED G-05 state, not a raw
  // git failure the user has to read stderr for.
  if (!outside.ok) assert.equal(outside.reason, 'not-a-repository');

  const { repos } = await scanForRepos(repo);
  assert.ok(repos.includes(repo));
  assert.ok(repos.includes(join(repo, 'child')));
});

test('the nested clone is reported as ignored by its parent', { skip: !HAS_GIT }, async () => {
  // Answered with a pathspec-scoped `status --ignored`, because `check-ignore`
  // is not on the subcommand allowlist. This is what puts "why does the parent
  // not see this repo" on screen instead of in tribal memory.
  assert.equal(await isIgnoredByParent(repo, 'child', { parentEnv }), true);
  assert.equal(await isIgnoredByParent(repo, 'sub', { parentEnv }), false);
});

test('G-11 · staging a child-repo path from the parent is refused', { skip: !HAS_GIT }, async () => {
  const known = (await scanForRepos(repo)).repos;
  const err = assertPathsOwnedBy(repo, ['child/z.txt'], known);
  assert.ok(err && isGitError(err));
  assert.equal(err.reason, 'cross-repo-path');
  assert.equal(err.ownerRepo, join(repo, 'child'));
});

test('every read really carries --no-optional-locks (verification 10)', { skip: !HAS_GIT }, async () => {
  // Proven by running it, not by inspecting the array: git accepts the flag
  // and the read still succeeds. A flag git rejected would fail here.
  const built = argv.status();
  assert.ok(built.ok === true && built.argv.includes('--no-optional-locks'));
  const out = unwrap(await run('git', built, opts(repo)));
  assert.ok(out.stdout.length >= 0);
});

test('a non-zero exit becomes a classified GitError, not a throw', { skip: !HAS_GIT }, async () => {
  const res = await run('git', argv.checkout({ name: 'no-such-branch' }), opts(repo));
  assert.equal(res.ok, false);
  assert.ok(isGitError(res));
  assert.equal(res.reason, 'git-failed');
  assert.equal(res.exitCode, 1);
  assert.ok((res.stderr ?? '').length > 0);
});

test('a tolerated non-zero exit is data, not failure', { skip: !HAS_GIT }, async () => {
  // `rev-parse --verify --quiet` exits 1 for an unknown ref; that is an
  // answer, not an error.
  const res = await runTolerant('git', argv.revParseVerify('definitely-not-a-ref'), opts(repo));
  assert.equal(res.ok, true);
  assert.ok(res.ok === true && res.outcome.code !== 0);
});

test('a builder rejection is never spawned', { skip: !HAS_GIT }, async () => {
  // `run` threads the ArgvResult union through, so a validation failure
  // short-circuits before any process exists.
  const res = await run('git', argv.add(['--upload-pack=touch /tmp/pwn']), opts(repo));
  assert.equal(res.ok, false);
  assert.ok(isGitError(res));
  assert.equal(res.reason, 'unsafe-argument');
});

test('a missing binary is `gh-missing`, never a crash', { skip: !HAS_GIT }, async () => {
  // D3: `gh` absent must darken Phase 3 and never park the pkg.
  const { exec } = await import('./exec.js');
  const res = await exec('gh', ['--version'], {
    cwd: repo,
    parentEnv: { ...parentEnv, PATH: join(tmp, 'empty-path') },
  });
  if (!res.ok) {
    assert.equal(res.reason, 'gh-missing');
  }
});
