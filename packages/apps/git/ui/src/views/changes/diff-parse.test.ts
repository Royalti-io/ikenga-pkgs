import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePatch, pairSideBySide } from './diff-parse.js';

test('parsePatch: single hunk, context + add + del', () => {
  const patch = [
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,3 +1,3 @@ fn foo()',
    ' unchanged',
    '-old line',
    '+new line',
    ' tail',
  ].join('\n');
  const hunks = parsePatch(patch);
  assert.equal(hunks.length, 1);
  const h = hunks[0]!;
  assert.equal(h.oldStart, 1);
  assert.equal(h.newStart, 1);
  assert.equal(h.header, '@@ -1,3 +1,3 @@ fn foo()');
  assert.deepEqual(
    h.lines.map((l) => [l.kind, l.oldNo, l.newNo, l.text]),
    [
      ['context', 1, 1, 'unchanged'],
      ['del', 2, null, 'old line'],
      ['add', null, 2, 'new line'],
      ['context', 3, 3, 'tail'],
    ]
  );
});

test('parsePatch: multiple hunks', () => {
  const patch = [
    '@@ -1,2 +1,2 @@',
    '-a',
    '+b',
    ' c',
    '@@ -10,2 +10,3 @@',
    ' d',
    '+e',
    ' f',
  ].join('\n');
  const hunks = parsePatch(patch);
  assert.equal(hunks.length, 2);
  assert.equal(hunks[0]!.lines.length, 3);
  assert.equal(hunks[1]!.lines.length, 3);
  assert.equal(hunks[1]!.oldStart, 10);
});

test('parsePatch: no-newline-at-eof marker annotates the previous line, not a new one', () => {
  const patch = ['@@ -1,1 +1,1 @@', '-old', '+new', '\\ No newline at end of file'].join('\n');
  const hunks = parsePatch(patch);
  const h = hunks[0]!;
  assert.equal(h.lines.length, 2);
  assert.equal(h.lines[1]!.text, 'new');
  assert.equal(h.lines[1]!.noNewline, true);
});

test('parsePatch: rename/mode-only patch with no hunks returns []', () => {
  const patch = [
    'diff --git a/old.txt b/new.txt',
    'similarity index 100%',
    'rename from old.txt',
    'rename to new.txt',
    '',
  ].join('\n');
  assert.deepEqual(parsePatch(patch), []);
});

test('parsePatch: empty string returns []', () => {
  assert.deepEqual(parsePatch(''), []);
});

test('pairSideBySide: equal-length del/add run zips 1:1', () => {
  const hunks = parsePatch(['@@ -1,2 +1,2 @@', '-a1', '-a2', '+b1', '+b2'].join('\n'));
  const rows = pairSideBySide(hunks[0]!.lines);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.left?.text, 'a1');
  assert.equal(rows[0]!.right?.text, 'b1');
  assert.equal(rows[1]!.left?.text, 'a2');
  assert.equal(rows[1]!.right?.text, 'b2');
});

test('pairSideBySide: unequal-length runs leave the shorter side blank', () => {
  const hunks = parsePatch(['@@ -1,1 +1,3 @@', '-a1', '+b1', '+b2', '+b3'].join('\n'));
  const rows = pairSideBySide(hunks[0]!.lines);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.left?.text, 'a1');
  assert.equal(rows[0]!.right?.text, 'b1');
  assert.equal(rows[1]!.left, null);
  assert.equal(rows[1]!.right?.text, 'b2');
  assert.equal(rows[2]!.left, null);
  assert.equal(rows[2]!.right?.text, 'b3');
});

test('pairSideBySide: context lines pair with themselves', () => {
  const hunks = parsePatch(['@@ -1,1 +1,1 @@', ' same'].join('\n'));
  const rows = pairSideBySide(hunks[0]!.lines);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.left, rows[0]!.right);
});

test('parsePatch: a 2000-line hunk parses well under 200ms', () => {
  const lines = ['@@ -1,1000 +1,1000 @@'];
  for (let i = 0; i < 1000; i++) lines.push(` context line ${String(i)}`);
  for (let i = 0; i < 500; i++) lines.push(`-old ${String(i)}`);
  for (let i = 0; i < 500; i++) lines.push(`+new ${String(i)}`);
  const patch = lines.join('\n');
  const start = performance.now();
  const hunks = parsePatch(patch);
  const elapsed = performance.now() - start;
  assert.equal(hunks[0]!.lines.length, 2000);
  assert.ok(elapsed < 200, `parsePatch took ${String(elapsed)}ms`);
});
