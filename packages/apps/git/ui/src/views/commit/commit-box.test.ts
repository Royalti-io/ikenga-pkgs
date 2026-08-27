/**
 * The commit box's enabled/disabled logic — R6 UI defect.
 *
 * The bug: `disabled` was computed once, inside `build()`, while `message` was
 * still `''`, and the `input` listener updated `message` without touching the
 * button. The Commit button was therefore permanently disabled and Enter was
 * the only way to commit. These tests drive the REAL `createCommitBox` through
 * the real listener (see `../../test/dom.ts` for what the shim does and does
 * not model) so a regression to build-time-only computation fails here.
 */

import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { installDom, fire, findByText, findByTag, type FakeNode } from '../../test/dom';
import { commitDisabled, createCommitBox, type CommitBoxContext } from './index';
import { VOCAB } from '../../vocabulary';
import type { FileChange, RpcClient } from '../../app/rpc';

let restore: (() => void) | null = null;

beforeEach(() => {
  restore = installDom();
});
afterEach(() => {
  restore?.();
  restore = null;
});

function file(path: string): FileChange {
  return {
    path,
    origPath: null,
    kind: 'ordinary',
    staged: 'M',
    unstaged: '.',
    score: null,
    submodule: null,
    added: 1,
    deleted: 0,
    binary: false,
  };
}

function ctx(over: Partial<CommitBoxContext> = {}): CommitBoxContext {
  return { branch: 'main', staged: [file('a.txt')], conflicted: 0, ...over };
}

/** An RPC that fails loudly: nothing in these tests should reach the sidecar. */
const rpc = (() => {
  throw new Error('no RPC call expected in these tests');
}) as unknown as RpcClient;

function mount(context: CommitBoxContext) {
  const box = createCommitBox({ repo: '/tmp/repo', repoName: 'repo', rpc });
  // `alive()` reads `root.isConnected`, so the box has to be in the document.
  (document as unknown as { body: FakeNode }).body.appendChild(box.root as unknown as FakeNode);
  box.setContext(context);
  return box;
}

function commitButton(box: { root: HTMLElement }): FakeNode {
  const root = box.root as unknown as FakeNode;
  const btn =
    findByText(root, 'button', VOCAB.changes.commit) ??
    findByText(root, 'button', VOCAB.changes.commitBox.committing);
  assert.ok(btn, 'Commit button not found');
  return btn;
}

function typeInto(box: { root: HTMLElement }, text: string): void {
  const input = findByTag(box.root as unknown as FakeNode, 'input');
  assert.ok(input, 'message input not found');
  input.value = text;
  fire(input, 'input');
}

// ═════════════════════════════════════════════════════════════════════════════
// The predicate
// ═════════════════════════════════════════════════════════════════════════════

test('commitDisabled states', () => {
  assert.equal(commitDisabled(ctx(), '', false), true, 'empty message');
  assert.equal(commitDisabled(ctx(), '   ', false), true, 'whitespace-only message');
  assert.equal(commitDisabled(ctx(), 'feat: x', false), false, 'typed message');
  assert.equal(commitDisabled(ctx({ conflicted: 2 }), 'feat: x', false), true, 'conflicted > 0');
  assert.equal(commitDisabled(ctx({ staged: [] }), 'feat: x', false), true, 'nothing staged');
  assert.equal(commitDisabled(ctx(), 'feat: x', true), true, 'commit in flight');
});

// ═════════════════════════════════════════════════════════════════════════════
// The live node — this is the half that failed before the fix
// ═════════════════════════════════════════════════════════════════════════════

test('empty message → Commit disabled', () => {
  const box = mount(ctx());
  assert.equal(commitButton(box).disabled, true);
});

test('typing enables the Commit button WITHOUT a repaint', () => {
  const box = mount(ctx());
  const before = commitButton(box);
  assert.equal(before.disabled, true);

  typeInto(box, 'feat: add the thing');

  const after = commitButton(box);
  assert.equal(after.disabled, false, 'the button must enable as the message is typed');
  // Same node — the fix must not repaint, or the <input> (and the caret) would
  // be replaced mid-keystroke, which is why the original code avoided repaint
  // in the first place.
  assert.equal(after, before, 'the live button node must be updated, not rebuilt');
});

test('clearing the message disables it again', () => {
  const box = mount(ctx());
  typeInto(box, 'feat: x');
  assert.equal(commitButton(box).disabled, false);
  typeInto(box, '');
  assert.equal(commitButton(box).disabled, true);
  typeInto(box, '   ');
  assert.equal(commitButton(box).disabled, true, 'whitespace is not a message');
});

test('conflicted > 0 → disabled even with a message', () => {
  const box = mount(ctx({ conflicted: 1 }));
  typeInto(box, 'feat: x');
  assert.equal(commitButton(box).disabled, true);
  const note = (box.root as unknown as FakeNode)
    .descendants()
    .find((n) => n.className === 'git-commit-box__note');
  assert.equal(note?.textContent, VOCAB.changes.commitBox.conflictsBlock);
});

test('nothing staged → disabled even with a message', () => {
  const box = mount(ctx({ staged: [] }));
  typeInto(box, 'feat: x');
  assert.equal(commitButton(box).disabled, true);
});

test('a context change re-enables correctly against the message already typed', () => {
  // setContext() repaints. The rebuilt button must be computed against the
  // CURRENT message, not against '' — the same class of staleness as the bug.
  const box = mount(ctx({ staged: [] }));
  typeInto(box, 'feat: x');
  assert.equal(commitButton(box).disabled, true);
  box.setContext(ctx({ staged: [file('a.txt'), file('b.txt')] }));
  assert.equal(commitButton(box).disabled, false, 'staging files must enable the typed message');
});

// ═════════════════════════════════════════════════════════════════════════════
// "Send to your Chi" keeps its words, changes its promise
// ═════════════════════════════════════════════════════════════════════════════

test('the Chi button is still labelled "Send to your Chi"', () => {
  const box = mount(ctx());
  const btn = findByText(box.root as unknown as FakeNode, 'button', VOCAB.changes.sendToChi);
  assert.ok(btn, 'the label is load-bearing lore — it must not change');
  assert.equal(btn.disabled, false);
  assert.equal(VOCAB.changes.sendToChi, 'Send to your Chi');
  // …and what it reports is a copy, not a delivery.
  assert.equal(VOCAB.changes.commitBox.chiCopied, 'Copied — paste it to your Chi');
});
