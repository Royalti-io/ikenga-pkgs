/**
 * `watcher.ts` — debounce + hard-ceiling coalescing (rpc.ts §5.1), and the
 * `.git/{HEAD,index,refs}` + worktree relevance filter, tested with a FAKE
 * `@parcel/watcher.subscribe` so the timing is deterministic and the suite
 * needs no native fs backend. `isRelevantEvent` itself is pure and tested
 * directly, so the OS-level integration this fakes out is the only untested
 * seam — acceptable: `@parcel/watcher` is a well-established upstream, not
 * code this pkg owns.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ignoreGlobsFor, isRelevantEvent, nestedReposOf, RepoWatcher } from './watcher.js';
import type { RepoChangedParams } from '../../core/src/rpc.js';

// ── isRelevantEvent ──────────────────────────────────────────────────────

test('isRelevantEvent: worktree files outside .git are always relevant', () => {
  assert.equal(isRelevantEvent('src/index.ts'), true);
  assert.equal(isRelevantEvent('README.md'), true);
});

test('isRelevantEvent: .git/HEAD, .git/index, .git/refs/** are relevant', () => {
  assert.equal(isRelevantEvent('.git/HEAD'), true);
  assert.equal(isRelevantEvent('.git/index'), true);
  assert.equal(isRelevantEvent('.git/refs/heads/main'), true);
});

test('isRelevantEvent: other .git churn (objects, logs) is NOT relevant', () => {
  assert.equal(isRelevantEvent('.git/objects/ab/cdef'), false);
  assert.equal(isRelevantEvent('.git/logs/HEAD'), false);
  assert.equal(isRelevantEvent('.git/COMMIT_EDITMSG'), false);
});

// ── RepoWatcher: debounce + coalescing + hard ceiling ───────────────────

type FakeCallback = (err: Error | null, events: { path: string; type: 'create' | 'update' | 'delete' }[]) => void;

/** A fake `watcher.subscribe` that hands the test direct control over when
 *  events fire, with real timers (the module under test schedules with real
 *  `setTimeout`, so the test uses real time on short, test-appropriate
 *  intervals rather than mocking the clock). */
function fakeSubscribeFactory() {
  const callbacks = new Map<string, FakeCallback>();
  const subscribe = async (dir: string, cb: FakeCallback) => {
    callbacks.set(dir, cb);
    return { unsubscribe: async () => { callbacks.delete(dir); } };
  };
  const fire = (dir: string, relPaths: string[]) => {
    const cb = callbacks.get(dir);
    if (!cb) throw new Error(`no subscription for ${dir}`);
    cb(null, relPaths.map((p) => ({ path: `${dir}/${p}`, type: 'update' as const })));
  };
  return { subscribe, fire };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test('RepoWatcher: a single relevant event flushes exactly one repo.changed with coalesced=1', async () => {
  const { subscribe, fire } = fakeSubscribeFactory();
  const flushed: RepoChangedParams[] = [];
  const w = new RepoWatcher((p) => flushed.push(p), subscribe as never);
  await w.reconcile(['/repo/a']);

  fire('/repo/a', ['.git/HEAD']);
  await sleep(300); // > WATCH_DEBOUNCE_MS (150ms)

  assert.equal(flushed.length, 1);
  assert.equal(flushed[0]?.repo, '/repo/a');
  assert.equal(flushed[0]?.coalesced, 1);
  assert.equal(flushed[0]?.seq, 1);
  assert.equal(flushed[0]?.reason, 'fs');

  await w.stop();
});

test('RepoWatcher: a burst within the debounce window coalesces into ONE notification', async () => {
  const { subscribe, fire } = fakeSubscribeFactory();
  const flushed: RepoChangedParams[] = [];
  const w = new RepoWatcher((p) => flushed.push(p), subscribe as never);
  await w.reconcile(['/repo/a']);

  for (let i = 0; i < 20; i += 1) {
    fire('/repo/a', ['.git/index']);
    await sleep(20); // stays under WATCH_DEBOUNCE_MS between events
  }
  await sleep(300);

  assert.equal(flushed.length, 1, 'a debounced burst must coalesce into one notification');
  assert.equal(flushed[0]?.coalesced, 20);

  await w.stop();
});

test('RepoWatcher: an event stream longer than the max-wait ceiling forces at least two flushes', async () => {
  const { subscribe, fire } = fakeSubscribeFactory();
  const flushed: RepoChangedParams[] = [];
  const w = new RepoWatcher((p) => flushed.push(p), subscribe as never);
  await w.reconcile(['/repo/a']);

  // Continuous stream for well past WATCH_MAX_WAIT_MS (1000ms), never leaving
  // a 150ms quiet gap — pure debounce would NEVER fire here.
  const start = Date.now();
  while (Date.now() - start < 1400) {
    fire('/repo/a', ['.git/index']);
    await sleep(50);
  }
  await sleep(300);

  assert.ok(
    flushed.length >= 2,
    `max-wait ceiling should have forced a flush mid-stream; got ${String(flushed.length)}`
  );
  const totalCoalesced = flushed.reduce((s, p) => s + p.coalesced, 0);
  assert.ok(totalCoalesced > 20, 'every raw event should still be accounted for across flushes');
  // seq is strictly increasing per repo.
  const seqs = flushed.map((p) => p.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, seqs.length, 'seq must be unique per flush');

  await w.stop();
});

test('RepoWatcher: irrelevant events (.git/objects) never trigger a flush', async () => {
  const { subscribe, fire } = fakeSubscribeFactory();
  const flushed: RepoChangedParams[] = [];
  const w = new RepoWatcher((p) => flushed.push(p), subscribe as never);
  await w.reconcile(['/repo/a']);

  fire('/repo/a', ['.git/objects/ab/cdef', '.git/logs/HEAD']);
  await sleep(300);

  assert.equal(flushed.length, 0);
  await w.stop();
});

test('RepoWatcher: reconcile adds and removes subscriptions without dropping the ones that stay', async () => {
  const { subscribe, fire } = fakeSubscribeFactory();
  const flushed: RepoChangedParams[] = [];
  const w = new RepoWatcher((p) => flushed.push(p), subscribe as never);

  await w.reconcile(['/repo/a', '/repo/b']);
  assert.deepEqual([...w.watched].sort(), ['/repo/a', '/repo/b']);

  await w.reconcile(['/repo/a', '/repo/c']);
  assert.deepEqual([...w.watched].sort(), ['/repo/a', '/repo/c']);

  fire('/repo/a', ['.git/HEAD']);
  await sleep(300);
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0]?.repo, '/repo/a');

  await w.stop();
});

// ── Nested repos: an event belongs to ONE repo, the deepest ───────────────
//
// The live-shell sweep caught this: one `touch` in
// `royalti-co/ikenga/contract/` produced THREE `repo.changed` frames —
// `royalti-co`, `ikenga` and `contract` — because all three are watched
// recursively and all three callbacks saw the path.

test('nestedReposOf: only strict descendants, and not a sibling with a shared prefix', () => {
  const all = ['/w', '/w/a', '/w/a/b', '/w/ab', '/other'];
  assert.deepEqual(nestedReposOf('/w/a', all).sort(), ['/w/a/b']);
  assert.deepEqual(nestedReposOf('/w', all).sort(), ['/w/a', '/w/a/b', '/w/ab']);
  assert.deepEqual(nestedReposOf('/other', all), []);
});

test('ignoreGlobsFor: nested repo roots are ignored as both dir and subtree', () => {
  const globs = ignoreGlobsFor('/w/a', ['/w/a/b']);
  assert.ok(globs.includes('b'));
  assert.ok(globs.includes('b/**'));
  // The standing perf globs survive.
  assert.ok(globs.includes('.git/objects/**'));
  assert.ok(globs.includes('**/node_modules/**'));
});

test('RepoWatcher: a write inside a nested repo does NOT fan out to its ancestors', async () => {
  const { subscribe, fire } = fakeSubscribeFactory();
  const flushed: RepoChangedParams[] = [];
  const w = new RepoWatcher((p) => flushed.push(p), subscribe as never);

  // The real shape: royalti-co ⊃ ikenga ⊃ contract, three independent clones.
  await w.reconcile(['/w', '/w/ikenga', '/w/ikenga/contract']);

  // The OS ignore globs would normally suppress these, but a native backend
  // can and does still deliver them — so fire on ALL THREE subscriptions, the
  // worst case, and assert the JS gate alone is enough.
  fire('/w', ['ikenga/contract/src/rpc.ts']);
  fire('/w/ikenga', ['contract/src/rpc.ts']);
  fire('/w/ikenga/contract', ['src/rpc.ts']);
  await sleep(300);

  assert.equal(flushed.length, 1);
  assert.equal(flushed[0]?.repo, '/w/ikenga/contract');

  await w.stop();
});

test('RepoWatcher: a write in the ancestor itself still belongs to the ancestor', async () => {
  const { subscribe, fire } = fakeSubscribeFactory();
  const flushed: RepoChangedParams[] = [];
  const w = new RepoWatcher((p) => flushed.push(p), subscribe as never);
  await w.reconcile(['/w', '/w/ikenga']);

  fire('/w', ['STATUS.md']);
  await sleep(300);

  assert.equal(flushed.length, 1);
  assert.equal(flushed[0]?.repo, '/w');

  await w.stop();
});
