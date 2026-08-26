/**
 * VERIFICATION 5 — env asymmetry, BY EXECUTION (G-16).
 *
 * `plans/git/01-plan.md` §Phase 1 verification, item 5:
 *
 *   > Env asymmetry, by execution (G-16): exec `env` through the real git-core
 *   > spawn path → no `IKENGA_*` in the child, `GIT_TERMINAL_PROMPT=0`
 *   > present, `SSH_AUTH_SOCK`/`GIT_ASKPASS` preserved; AND the sidecar's own
 *   > process still holds `IKENGA_AUTH_TOKEN`.
 *
 * The word doing the work is **execution**. A test that asserts on the object
 * `buildChildEnv()` returns proves the builder is right and says nothing about
 * whether the spawn path uses it — and the spawn path is where the leak
 * actually happened before, in the cron daemon (memory
 * `reference_daemon_secrets_traps`: every PTY the daemon spawned inherited
 * `IKENGA_AUTH_TOKEN`, proved by execution, not by review).
 *
 * So these tests mutate the REAL `process.env`, spawn a REAL child through
 * `spawnChild` — the same function `exec` / `run` / every git call uses — and
 * read the child's actual environment back out. Both halves of the asymmetry
 * are asserted in one test, because the asymmetry is the property: the parent
 * KEEPS the token (it needs the bridge), the child does NOT.
 *
 *   cd packages/apps/git && npm test
 */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { after, before, test } from 'node:test';
import {
  ENV_AUTH_PRESERVED,
  assertChildEnvSafe,
  buildChildEnv,
  isDeniedEnvName,
} from './env.js';
import { spawnChild } from './exec.js';

/** A value that is obviously not a real credential but is shaped like one. */
const FAKE_TOKEN = 'ikenga-test-token-0000000000';
const FAKE_SOCK = '/tmp/ikenga-test-ssh-agent.sock';
const FAKE_ASKPASS = '/tmp/ikenga-test-askpass';
const HIJACK_GIT_DIR = '/tmp/ikenga-test-hijack/.git';

const saved: Record<string, string | undefined> = {};
const INJECTED = [
  'IKENGA_AUTH_TOKEN',
  'IKENGA_PKG_ID',
  'IKENGA_PROJECT_ROOT',
  'SSH_AUTH_SOCK',
  'GIT_ASKPASS',
  'GIT_DIR',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
];

before(() => {
  for (const k of INJECTED) saved[k] = process.env[k];
  process.env['IKENGA_AUTH_TOKEN'] = FAKE_TOKEN;
  process.env['IKENGA_PKG_ID'] = 'com.ikenga.git';
  process.env['IKENGA_PROJECT_ROOT'] = '/some/stale/root';
  process.env['SSH_AUTH_SOCK'] = FAKE_SOCK;
  process.env['GIT_ASKPASS'] = FAKE_ASKPASS;
  process.env['GIT_DIR'] = HIJACK_GIT_DIR;
  process.env['GIT_CONFIG_COUNT'] = '1';
  process.env['GIT_CONFIG_KEY_0'] = 'core.sshCommand';
});

after(() => {
  for (const k of INJECTED) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** Read a spawned child's environment back as a real object. */
async function childEnv(): Promise<Record<string, string>> {
  const outcome = await spawnChild(
    process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
    { cwd: tmpdir() }
  );
  assert.equal(outcome.code, 0, `probe child failed: ${outcome.stderr}`);
  return JSON.parse(outcome.stdout) as Record<string, string>;
}

test('verification 5 · the asymmetry holds through a real spawn', async () => {
  const child = await childEnv();

  // ── Half one: the child is clean. ──────────────────────────────────────────
  const leaked = Object.keys(child).filter((k) => k.startsWith('IKENGA_'));
  assert.deepEqual(leaked, [], `IKENGA_* leaked into the child: ${leaked.join(', ')}`);
  assert.equal(child['IKENGA_AUTH_TOKEN'], undefined);

  // The bridge token must not survive under ANY name, not merely its own.
  const byValue = Object.entries(child).filter(([, v]) => v === FAKE_TOKEN);
  assert.deepEqual(byValue, [], 'the bridge token reached the child under another name');

  // Repo-targeting vars are stripped: they would override `cwd` for every call.
  assert.equal(child['GIT_DIR'], undefined);
  assert.equal(child['GIT_CONFIG_COUNT'], undefined);
  assert.equal(child['GIT_CONFIG_KEY_0'], undefined);

  // ── Half two: git-core's own additions. ────────────────────────────────────
  assert.equal(child['GIT_TERMINAL_PROMPT'], '0');

  // ── Half three: the user's auth path is untouched. ────────────────────────
  assert.equal(child['SSH_AUTH_SOCK'], FAKE_SOCK);
  assert.equal(child['GIT_ASKPASS'], FAKE_ASKPASS);
  assert.equal(child['PATH'], process.env['PATH']);
  assert.equal(child['HOME'], process.env['HOME']);

  // ── Half four: the PARENT still holds the token. ──────────────────────────
  // This is the asymmetry. The sidecar/MCP needs `IKENGA_AUTH_TOKEN` for the
  // iyke bridge; only its grandchildren must lose it. A "fix" that unset the
  // variable process-wide would pass every assertion above and break the pkg.
  assert.equal(process.env['IKENGA_AUTH_TOKEN'], FAKE_TOKEN);
});

test('verification 5 · literally `env`, as the plan words it (POSIX only)', async (t) => {
  if (process.platform === 'win32') {
    t.skip('no `env` binary on Windows');
    return;
  }
  const outcome = await spawnChild('env', [], { cwd: tmpdir() });
  assert.equal(outcome.code, 0, outcome.stderr);

  const names = outcome.stdout
    .split('\n')
    .map((l) => l.slice(0, l.indexOf('=')))
    .filter((n) => n.length > 0);

  assert.equal(
    names.some((n) => n.startsWith('IKENGA_')),
    false,
    'IKENGA_* present in `env` output'
  );
  assert.match(outcome.stdout, /^GIT_TERMINAL_PROMPT=0$/m);
  assert.match(outcome.stdout, new RegExp(`^SSH_AUTH_SOCK=${FAKE_SOCK}$`, 'm'));
  assert.equal(outcome.stdout.includes(FAKE_TOKEN), false, 'token text present in `env` output');
});

test('clear-first: a variable added to process.env AFTER module load is still filtered', () => {
  // The spread-then-delete idiom would forward this, because the delete list is
  // written once and this name was never on it. Building up cannot miss it.
  process.env['IKENGA_SOMETHING_INVENTED_LATER'] = 'x';
  try {
    const built = buildChildEnv();
    assert.equal(built['IKENGA_SOMETHING_INVENTED_LATER'], undefined);
  } finally {
    delete process.env['IKENGA_SOMETHING_INVENTED_LATER'];
  }
});

test('denylist membership', () => {
  assert.equal(isDeniedEnvName('IKENGA_AUTH_TOKEN'), true);
  assert.equal(isDeniedEnvName('GIT_DIR'), true);
  assert.equal(isDeniedEnvName('GIT_CONFIG_VALUE_7'), true);
  // Auth and signing config are NEVER denied — that is the whole reuse premise.
  for (const name of ENV_AUTH_PRESERVED) {
    assert.equal(isDeniedEnvName(name), false, `${name} must not be denied`);
  }
  assert.equal(isDeniedEnvName('GIT_TERMINAL_PROMPT'), false);
  // Near-misses that must stay allowed.
  assert.equal(isDeniedEnvName('IKENGA'), false);
  assert.equal(isDeniedEnvName('GIT_DIRECTORY_SOMETHING'), false);
});

test('an unset variable is not forwarded as an empty string', () => {
  const built = buildChildEnv({ SET: 'v', UNSET: undefined });
  assert.equal(built['SET'], 'v');
  assert.equal('UNSET' in built, false);
});

test('assertChildEnvSafe rejects a hand-built env that leaks', () => {
  assert.throws(
    () => assertChildEnvSafe({ IKENGA_AUTH_TOKEN: 'x', GIT_TERMINAL_PROMPT: '0' }, {}),
    /G-16 violation: denied env name/
  );
  assert.throws(() => assertChildEnvSafe({ PATH: '/usr/bin' }, {}), /GIT_TERMINAL_PROMPT/);
  assert.throws(
    () => assertChildEnvSafe({ GIT_TERMINAL_PROMPT: '0' }, { SSH_AUTH_SOCK: '/s' }),
    /auth-critical env "SSH_AUTH_SOCK" was not preserved/
  );
  // The happy path does not throw.
  assertChildEnvSafe(buildChildEnv());
});
