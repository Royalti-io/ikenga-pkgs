/**
 * VERIFICATION 6 — option injection, plus the rest of G-02.
 *
 * `plans/git/01-plan.md` §Phase 1 verification, item 6:
 *
 *   > Option-injection unit test: pathspec `--upload-pack=touch /tmp/pwn` and
 *   > ref `-x` are rejected (or passed only after `--`) (G-02).
 *
 * Why this class matters at all: several git options execute a program.
 * `--upload-pack` / `--receive-pack` name a binary to run on the far side,
 * `-c core.sshCommand=…` and `-c diff.external=…` run one locally. A pathspec
 * or ref that reaches argv while still starting with `-` is parsed as an
 * option, not as data — so "reject `^-`" is not hygiene, it is the difference
 * between a file picker and a command runner.
 *
 * The tests below assert four separate things, because passing only the first
 * would be a false green:
 *   1. the injection payload is REJECTED, not merely escaped;
 *   2. it is rejected as `unsafe-argument`, not flattened into `invalid-args`
 *      (`rpc.ts` DELTA 5 — that flattening is what would make an injection
 *      attempt indistinguishable from a typo in an audit log);
 *   3. `--` precedes every pathspec that does get through;
 *   4. no builder in the module can emit a forbidden flag, checked by walking
 *      every builder rather than by inspection.
 *
 *   cd packages/apps/git && npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as argv from './argv.js';
import {
  ALLOWED_SUBCOMMANDS,
  FORBIDDEN_ARG_PREFIXES,
  GLOBALS,
  PATHSPEC_SEPARATOR,
  SUBCOMMAND_VERBS,
  assertArgvSafe,
  checkPathspecs,
  checkRef,
  type ArgvResult,
} from './argv.js';
import { isGitError } from './rpc.js';

const NUL = '\u0000';

function err(res: ArgvResult): { reason: string; path?: string | null } {
  assert.equal(res.ok, false, `expected a rejection, got argv: ${JSON.stringify(res)}`);
  assert.ok(isGitError(res));
  return { reason: res.reason, path: res.path };
}

function ok(res: ArgvResult): string[] {
  assert.equal(res.ok, true, `expected argv, got ${JSON.stringify(res)}`);
  assert.ok(res.ok === true);
  return res.argv;
}

// ═════════════════════════════════════════════════════════════════════════════
// Verification 6 · the named payloads
// ═════════════════════════════════════════════════════════════════════════════

test('verification 6 · pathspec `--upload-pack=touch /tmp/pwn` is rejected', () => {
  const payload = '--upload-pack=touch /tmp/pwn';

  // Every builder that accepts a pathspec must refuse it — checking only
  // `add` would leave `commit`, `reset` and `diff` open.
  assert.equal(err(argv.add([payload])).reason, 'unsafe-argument');
  assert.equal(err(argv.resetPaths([payload])).reason, 'unsafe-argument');
  // NOT `commit`: as of the R6 index-semantics fix it takes no pathspec at
  // all (`git commit -F -` records the index — argv.ts). Its containment moved
  // to `assertStagedSetMatches`, tested in staged.test.ts.
  assert.equal(
    err(argv.diffPatch({ side: 'unstaged', path: payload })).reason,
    'unsafe-argument'
  );
  assert.equal(err(argv.log({ path: payload })).reason, 'unsafe-argument');
  assert.equal(err(argv.statusOfPath(payload)).reason, 'unsafe-argument');
  assert.equal(
    err(argv.commitPatch({ sha: '0123456789abcdef0123456789abcdef01234567', path: payload }))
      .reason,
    'unsafe-argument'
  );
});

test('verification 6 · ref `-x` is rejected', () => {
  assert.equal(err(argv.checkout({ name: '-x' })).reason, 'unsafe-argument');
  assert.equal(err(argv.log({ ref: '-x' })).reason, 'unsafe-argument');
  assert.equal(err(argv.branchCreate({ name: '-x' })).reason, 'unsafe-argument');
  assert.equal(err(argv.branchCreate({ name: 'ok', startPoint: '-x' })).reason, 'unsafe-argument');
  assert.equal(err(argv.revListLeftRightCount({ base: '-x' })).reason, 'unsafe-argument');
  assert.equal(err(argv.mergeBase({ base: 'main', head: '-x' })).reason, 'unsafe-argument');
  assert.equal(err(argv.fetch({ remote: '-x' })).reason, 'unsafe-argument');
  assert.equal(err(argv.revParseVerify('-x')).reason, 'unsafe-argument');
});

test('verification 6 · injection is `unsafe-argument`, a typo is `invalid-args`', () => {
  // DELTA 5. If both collapsed to `invalid-args`, an audit could not tell an
  // attempted `--upload-pack` from someone sending a number where a path goes.
  const injection = checkPathspecs(['--receive-pack=/bin/sh']);
  assert.ok(injection && isGitError(injection));
  assert.equal(injection.reason, 'unsafe-argument');
  assert.equal(injection.path, 'paths[0]');

  const wrongType = checkPathspecs([42 as unknown as string]);
  assert.ok(wrongType && isGitError(wrongType));
  assert.equal(wrongType.reason, 'invalid-args');
});

test('the other `^-` shapes, not just the two named ones', () => {
  for (const payload of ['-c', '--exec=sh', '-', '--', '-C/tmp', '--git-dir=/x']) {
    assert.equal(
      err(argv.add([payload])).reason,
      'unsafe-argument',
      `pathspec "${payload}" was not rejected`
    );
  }
  for (const payload of ['-c', '--upload-pack=x', '-']) {
    assert.equal(
      err(argv.checkout({ name: payload })).reason,
      'unsafe-argument',
      `ref "${payload}" was not rejected`
    );
  }
});

test('pathspecs that are not options but still escape the repo', () => {
  assert.equal(err(argv.add(['/etc/passwd'])).reason, 'unsafe-argument'); // absolute
  assert.equal(err(argv.add(['../outside/file'])).reason, 'unsafe-argument'); // traversal
  assert.equal(err(argv.add([`a${NUL}b`])).reason, 'unsafe-argument'); // NUL
  assert.equal(err(argv.add(['sub/../../escape'])).reason, 'unsafe-argument'); // mid-path `..`
  // A path merely CONTAINING a dash, or a dot-dot inside a name, is fine.
  ok(argv.add(['src/some-file.ts', 'a..b/c.txt', '.gitignore']));
});

test('refs with characters that could split argv', () => {
  for (const bad of ['a b', 'a\tb', 'a~1', 'a^', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b']) {
    assert.equal(err(argv.checkout({ name: bad })).reason, 'unsafe-argument', `ref "${bad}"`);
  }
  ok(argv.checkout({ name: 'feat/sidecar-event-envelope' }));
  ok(argv.checkout({ name: 'v1.2.3' }));
});

// ═════════════════════════════════════════════════════════════════════════════
// Rule 3 · `--` before every pathspec
// ═════════════════════════════════════════════════════════════════════════════

test('rule 3 · every builder that takes a pathspec emits `--` before it', () => {
  const cases: { name: string; res: ArgvResult; paths: string[] }[] = [
    { name: 'add', res: argv.add(['a.txt', 'b/c.txt']), paths: ['a.txt', 'b/c.txt'] },
    { name: 'resetPaths', res: argv.resetPaths(['a.txt']), paths: ['a.txt'] },
    {
      name: 'diffPatch',
      res: argv.diffPatch({ side: 'staged', path: 'a.txt' }),
      paths: ['a.txt'],
    },
    {
      name: 'diffNumstat',
      res: argv.diffNumstat({ cached: false, paths: ['a.txt'] }),
      paths: ['a.txt'],
    },
    { name: 'log', res: argv.log({ path: 'a.txt' }), paths: ['a.txt'] },
    { name: 'statusOfPath', res: argv.statusOfPath('shell'), paths: ['shell'] },
    {
      name: 'commitPatch',
      res: argv.commitPatch({ sha: 'abc1234', path: 'a.txt' }),
      paths: ['a.txt'],
    },
  ];

  for (const c of cases) {
    const built = ok(c.res);
    const sep = built.indexOf(PATHSPEC_SEPARATOR);
    assert.notEqual(sep, -1, `${c.name}: no "--" in ${built.join(' ')}`);
    assert.deepEqual(
      built.slice(sep + 1),
      c.paths,
      `${c.name}: everything after "--" must be exactly the pathspecs`
    );
  }
});

test('a lone `--` cannot be smuggled in as a path', () => {
  // Passing `--` as a pathspec would end the pathspec list from git's point of
  // view; `PathspecSchema` rejects it as `^-` before that can matter.
  assert.equal(err(argv.add(['--'])).reason, 'unsafe-argument');
});

// ═════════════════════════════════════════════════════════════════════════════
// Rule 1 · the subcommand allowlist
// ═════════════════════════════════════════════════════════════════════════════

test('rule 1 · subcommands outside the allowlist are refused by the final gate', () => {
  for (const sub of ['push', 'clean', 'rebase', 'filter-branch', 'config', 'remote', 'init']) {
    const res = assertArgvSafe([...GLOBALS, sub]);
    assert.ok(res && isGitError(res), `"${sub}" passed the gate`);
    assert.equal(res.reason, 'not-allowed');
  }
});

test('rule 1 · restricted subcommands are pinned to one verb', () => {
  // `worktree remove` and `stash drop` are both on the never-in-v1 list; the
  // allowlist naming only `worktree` / `stash` would let them through.
  for (const bad of [
    ['worktree', 'remove'],
    ['worktree', 'prune'],
    ['worktree', 'add'],
    ['stash', 'drop'],
    ['stash', 'push'],
    ['stash', 'pop'],
  ]) {
    const res = assertArgvSafe([...GLOBALS, ...bad]);
    assert.ok(res && isGitError(res), `"${bad.join(' ')}" passed the gate`);
    assert.equal(res.reason, 'not-allowed');
  }
  assert.equal(assertArgvSafe([...GLOBALS, 'worktree', 'list', '--porcelain']), null);
  assert.equal(assertArgvSafe([...GLOBALS, 'stash', 'create']), null);
});

test('every restricted subcommand in SUBCOMMAND_VERBS is on the allowlist', () => {
  for (const sub of Object.keys(SUBCOMMAND_VERBS)) {
    assert.ok(
      (ALLOWED_SUBCOMMANDS as readonly string[]).includes(sub),
      `${sub} is restricted but not allowed at all`
    );
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// The forbidden-flag rescan
// ═════════════════════════════════════════════════════════════════════════════

test('the final gate catches a destructive flag even in a hand-built argv', () => {
  for (const bad of [
    ['reset', '--hard'],
    ['reset', '--hard', 'HEAD'],
    ['checkout', '--force', 'main'],
    ['branch', '-D', 'gone'],
    ['branch', '--delete', 'gone'],
    ['commit', '--no-verify', '-m', 'x'],
    ['-c', 'core.sshCommand=sh', 'status'],
    ['status', '--ext-diff'],
    ['log', '--exec=sh'],
    ['fetch', '--upload-pack=sh'],
  ]) {
    const res = assertArgvSafe([...GLOBALS, ...bad]);
    assert.ok(res && isGitError(res), `"${bad.join(' ')}" passed the gate`);
    assert.ok(
      res.reason === 'unsafe-argument' || res.reason === 'not-allowed',
      `"${bad.join(' ')}" → ${res.reason}`
    );
  }
});

test('the negations we WANT are not caught by the forbidden prefixes', () => {
  assert.equal(assertArgvSafe([...GLOBALS, 'diff', '--no-ext-diff', '--no-textconv']), null);
  assert.equal(assertArgvSafe([...GLOBALS, 'log', '--first-parent', '--format=%H']), null);
  assert.equal(assertArgvSafe([...GLOBALS, 'diff', '--cached', '--numstat']), null);
  assert.equal(assertArgvSafe([...GLOBALS, 'rev-list', '--count', 'a...b']), null);
});

// ═════════════════════════════════════════════════════════════════════════════
// Whole-module properties
// ═════════════════════════════════════════════════════════════════════════════

/** Every builder, called with benign input. Kept explicit rather than
 *  reflected so a new builder must be added here consciously. */
function allBuilders(): { name: string; res: ArgvResult }[] {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  return [
    { name: 'status', res: argv.status() },
    { name: 'status(ignored)', res: argv.status({ includeIgnored: true }) },
    { name: 'statusOfPath', res: argv.statusOfPath('shell') },
    { name: 'diffNumstat', res: argv.diffNumstat({ cached: true }) },
    { name: 'diffCachedNameOnly', res: argv.diffCachedNameOnly() },
    { name: 'diffPatch', res: argv.diffPatch({ side: 'unstaged', path: 'a.txt' }) },
    { name: 'commitPatch', res: argv.commitPatch({ sha, path: 'a.txt' }) },
    { name: 'log', res: argv.log({ ref: 'main', limit: 500, skip: 200 }) },
    { name: 'logCommit', res: argv.logCommit({ sha }) },
    { name: 'logCommit(sig)', res: argv.logCommit({ sha, withSignature: true }) },
    { name: 'logCommitNumstat', res: argv.logCommitNumstat({ sha }) },
    { name: 'branchList', res: argv.branchList() },
    { name: 'branchList(remote)', res: argv.branchList({ includeRemote: true }) },
    { name: 'worktreeList', res: argv.worktreeList() },
    { name: 'revListLeftRightCount', res: argv.revListLeftRightCount({ base: 'main' }) },
    { name: 'mergeBase', res: argv.mergeBase({ base: 'main' }) },
    { name: 'revParse', res: argv.revParse('show-toplevel') },
    { name: 'revParseVerify', res: argv.revParseVerify('main') },
    { name: 'add', res: argv.add(['a.txt']) },
    { name: 'resetPaths', res: argv.resetPaths(['a.txt']) },
    { name: 'commit', res: argv.commit({ message: 'm' }) },
    { name: 'branchCreate', res: argv.branchCreate({ name: 'feat/x', startPoint: 'main' }) },
    { name: 'checkout', res: argv.checkout({ name: 'main' }) },
    { name: 'checkoutNewBranch', res: argv.checkoutNewBranch({ name: 'feat/x' }) },
    { name: 'fetch', res: argv.fetch({ remote: 'origin', prune: true }) },
    { name: 'stashCreate', res: argv.stashCreate() },
  ];
}

test('every builder produces argv that passes the final gate', () => {
  for (const b of allBuilders()) {
    const built = ok(b.res);
    assert.equal(assertArgvSafe(built), null, `${b.name}: ${built.join(' ')}`);
  }
});

test('rule 4 · every builder carries `--no-optional-locks` (verification 10)', () => {
  // The documented bug class: a background `git status` loop that takes
  // `.git/index.lock` breaks the user's own `tsc --watch` / HMR in the same
  // repo. Applied to writes too, where it is a harmless no-op, so that no
  // future builder can forget it.
  for (const b of allBuilders()) {
    assert.ok(
      ok(b.res).includes('--no-optional-locks'),
      `${b.name} is missing --no-optional-locks`
    );
  }
});

test('rule 4b · every builder carries `--literal-pathspecs`', () => {
  // Without it, a filename beginning with `:` is reinterpreted as magic
  // pathspec syntax and `add` stages something other than what the UI showed.
  for (const b of allBuilders()) {
    assert.ok(ok(b.res).includes('--literal-pathspecs'), `${b.name} is missing --literal-pathspecs`);
  }
});

test('no builder emits any forbidden flag', () => {
  for (const b of allBuilders()) {
    for (const arg of ok(b.res)) {
      for (const bad of FORBIDDEN_ARG_PREFIXES) {
        if (arg === '--no-ext-diff' || arg === '--no-textconv') continue;
        assert.notEqual(arg, bad, `${b.name} emits ${bad}`);
      }
    }
  }
});

test('rule 2 · nothing that reaches argv is a shell fragment', () => {
  // Structural, not stylistic: every element is a separate array member, so
  // `exec.ts`'s `shell: false` means no quoting bug can become injection.
  for (const b of allBuilders()) {
    for (const arg of ok(b.res)) {
      assert.equal(typeof arg, 'string');
      assert.equal(arg.includes(NUL), false, `${b.name}: NUL in argv`);
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Shape checks on individual builders
// ═════════════════════════════════════════════════════════════════════════════

test('commit puts the message on stdin, never in argv', () => {
  // A commit message is multi-line free text that can begin with `-`. Passing
  // it via `-F -` removes it from argv entirely.
  const nasty = '--amend\n\nnot really a flag\n';
  const res = argv.commit({ message: nasty });
  assert.ok(res.ok === true);
  assert.equal(res.stdin, nasty);
  assert.equal(res.argv.includes(nasty), false);
  assert.equal(
    res.argv.some((a) => a.includes('not really a flag')),
    false,
    'no fragment of the message reached argv'
  );
  assert.deepEqual(res.argv.slice(-3), ['commit', '-F', '-']);
});

test('commit NEVER emits a pathspec — it records the index (R6, DELTA 7)', () => {
  // The regression guard for the data-integrity bug. `git commit -- <paths>`
  // and its explicit spelling `--only` commit the WORKING TREE content of
  // those paths and ignore the index, so an `MM` file committed the edit the
  // user had NOT staged and had never seen in the staged-diff pane. There is
  // no argument that can put a path in this argv any more; "explicit paths"
  // is `assertStagedSetMatches` (staged.test.ts).
  const built = ok(argv.commit({ message: 'm' }));
  assert.deepEqual(built.slice(-3), ['commit', '-F', '-']);
  assert.equal(built.includes('--only'), false, 'no --only');
  assert.equal(built.includes('--include'), false, 'no --include either');
  assert.equal(built.includes(PATHSPEC_SEPARATOR), false, 'no pathspec separator');
  assert.equal(built.includes('a.txt'), false);
});

test('an empty commit message is refused', () => {
  assert.equal(err(argv.commit({ message: '' })).reason, 'unsafe-argument');
});

test('stage/unstage refuse an empty path list — there is no "stage all"', () => {
  assert.equal(err(argv.add([])).reason, 'unsafe-argument');
  assert.equal(err(argv.resetPaths([])).reason, 'unsafe-argument');
});

test('unstage is a MIXED reset, scoped to paths — never --hard', () => {
  const built = ok(argv.resetPaths(['a.txt']));
  assert.equal(built.includes('--hard'), false);
  assert.equal(built.includes('--merge'), false);
  assert.equal(built.includes('--keep'), false);
  assert.ok(built.includes(PATHSPEC_SEPARATOR));
});

test('checkout emits no `--`, so discard is unreachable by construction', () => {
  // `checkout -- <path>` is the only common git op with no reflog recovery and
  // is out of v1 entirely. It cannot be built here: no parameter carries a
  // path, and no `--` is emitted.
  assert.equal(ok(argv.checkout({ name: 'main' })).includes(PATHSPEC_SEPARATOR), false);
  assert.equal(
    ok(argv.checkoutNewBranch({ name: 'feat/x' })).includes(PATHSPEC_SEPARATOR),
    false
  );
});

test('patch-producing builders disable external diff drivers', () => {
  for (const built of [
    ok(argv.diffPatch({ side: 'unstaged', path: 'a.txt' })),
    ok(argv.commitPatch({ sha: 'abc1234', path: 'a.txt' })),
    ok(argv.diffNumstat({ cached: false })),
  ]) {
    assert.ok(built.includes('--no-ext-diff'), built.join(' '));
    assert.ok(built.includes('--no-textconv'), built.join(' '));
  }
});

test('rev-parse takes an enum, never a caller-supplied flag', () => {
  assert.deepEqual(ok(argv.revParse('show-toplevel')).slice(-1), ['--show-toplevel']);
  assert.deepEqual(ok(argv.revParse('git-dir')).slice(-1), ['--absolute-git-dir']);
  assert.equal(err(argv.revParse('--upload-pack' as never)).reason, 'not-allowed');
});

test('checkRef / checkPathspecs are exported for callers that build their own', () => {
  assert.equal(checkRef('main'), null);
  assert.ok(checkRef('-x'));
  assert.equal(checkPathspecs(['a', 'b/c']), null);
});
