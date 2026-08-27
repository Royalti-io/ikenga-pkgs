/**
 * `parse/log.ts` — the NUL log format, trailers, co-authors.
 *
 *   cd packages/apps/git && npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOG_FIELD_COUNT,
  LOG_FIELD_COUNT_WITH_SIGNATURE,
  LOG_FORMAT,
  LOG_FORMAT_WITH_SIGNATURE,
  chunkNulRecords,
  parseCoAuthors,
  parseCommitDetail,
  parseDecorations,
  parseLog,
  parseTrailers,
} from './log.js';

const N = '\u0000';

/** Build a record with the 12 fields in `LOG_FORMAT` order. */
function record(fields: Partial<Record<number, string>>): string {
  const f = Array.from({ length: LOG_FIELD_COUNT }, (_, i) => fields[i] ?? '');
  return f.join(N) + N;
}

test('the format string and the declared field count agree', () => {
  // The two are one contract; drift here is an off-by-one on every commit.
  assert.equal(LOG_FORMAT.split('%x00').length, LOG_FIELD_COUNT);
  assert.equal(LOG_FORMAT_WITH_SIGNATURE.split('%x00').length, LOG_FIELD_COUNT_WITH_SIGNATURE);
  // `%B` must be LAST in both, or a multi-line body eats the next field.
  assert.ok(LOG_FORMAT.endsWith('%B'));
  assert.ok(LOG_FORMAT_WITH_SIGNATURE.endsWith('%B'));
});

test('a real single-commit capture parses', () => {
  // From git 2.43.0, transcribed with \0 for NUL. Note `%P` is EMPTY: this is
  // a root commit, and [] is the correct answer, not a failure.
  const raw = [
    '80d03fb59d5d1c68268f65f21736cbe67891a49a',
    '80d03fb',
    '',
    'T',
    't@t',
    '1787786767',
    'T',
    't@t',
    '1787786767',
    'first',
    'HEAD -> main, side',
    'first\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>\nSigned-off-by: T <t@t>\n',
    '',
  ].join(N);

  const commits = parseLog(raw);
  assert.equal(commits.length, 1);
  const c = commits[0];
  assert.ok(c);
  assert.equal(c.sha, '80d03fb59d5d1c68268f65f21736cbe67891a49a');
  assert.equal(c.shortSha, '80d03fb');
  assert.deepEqual(c.parents, []);
  assert.equal(c.authorName, 'T');
  assert.equal(c.authorAt, 1787786767);
  assert.equal(c.subject, 'first');
  assert.deepEqual(c.refs, ['HEAD -> main', 'side']);
  assert.deepEqual(c.coAuthors, [
    { name: 'Claude Fable 5', email: 'noreply@anthropic.com' },
  ]);
});

test('a body containing NULs cannot exist, but a body containing everything else can', () => {
  // Newlines, tabs, pipes, commas, quotes — all legal in a commit message and
  // all fatal to a tab/pipe-delimited format. NUL is the only safe delimiter.
  const body = 'subject\n\nbody with\ttabs, commas | pipes "quotes" and\nnewlines\n';
  const raw = record({ 0: 'a'.repeat(40), 1: 'aaaaaaa', 9: 'subject', 11: body });
  const [c] = parseLog(raw);
  assert.equal(c?.subject, 'subject');
});

test('two records chunk cleanly — the record terminator is unambiguous', () => {
  const raw =
    record({ 0: 'a'.repeat(40), 9: 'one', 11: 'one\n' }) +
    record({ 0: 'b'.repeat(40), 2: 'a'.repeat(40), 9: 'two', 11: 'two\n' });
  const commits = parseLog(raw);
  assert.equal(commits.length, 2);
  assert.equal(commits[0]?.subject, 'one');
  assert.deepEqual(commits[1]?.parents, ['a'.repeat(40)]);
});

test('a merge commit carries every parent', () => {
  const raw = record({
    0: 'c'.repeat(40),
    2: `${'a'.repeat(40)} ${'b'.repeat(40)}`,
    9: 'Merge pull request #72',
  });
  assert.deepEqual(parseLog(raw)[0]?.parents, ['a'.repeat(40), 'b'.repeat(40)]);
});

test('chunkNulRecords drops the trailing empty and ignores a partial tail', () => {
  assert.deepEqual(chunkNulRecords(`a${N}b${N}c${N}d${N}`, 2), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
  // A truncated final record is dropped rather than padded with empties —
  // half a commit is worse than no commit.
  assert.deepEqual(chunkNulRecords(`a${N}b${N}c${N}`, 2), [['a', 'b']]);
  assert.deepEqual(chunkNulRecords('', 2), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Trailers
// ─────────────────────────────────────────────────────────────────────────────

test('trailers come from the last paragraph only', () => {
  const body = 'subject\n\nSome prose that mentions Fixes: nothing.\n\nCo-Authored-By: A <a@x>\nSigned-off-by: B <b@x>\n';
  assert.deepEqual(parseTrailers(body), [
    { key: 'Co-Authored-By', value: 'A <a@x>' },
    { key: 'Signed-off-by', value: 'B <b@x>' },
  ]);
});

test('a last paragraph with one non-trailer line yields NO trailers', () => {
  // Partial recognition is how prose turns into a phantom trailer.
  const body = 'subject\n\nCo-Authored-By: A <a@x>\nand some prose\n';
  assert.deepEqual(parseTrailers(body), []);
});

test('a single-paragraph message has no trailers', () => {
  assert.deepEqual(parseTrailers('just a subject\n'), []);
  assert.deepEqual(parseTrailers('Fixes: #1\n'), []);
});

test('a continuation line extends the previous trailer', () => {
  const body = 'subject\n\nHelped-by: Someone\n  with a wrapped value\n';
  assert.deepEqual(parseTrailers(body), [
    { key: 'Helped-by', value: 'Someone\nwith a wrapped value' },
  ]);
});

test('co-authors: absent is a real case, not an error', () => {
  // The attribution string is user-configurable and can be suppressed; the
  // History view must render both states.
  assert.deepEqual(parseCoAuthors(parseTrailers('subject\n\nSigned-off-by: B <b@x>\n')), []);
});

test('co-authors: the key is matched case-insensitively', () => {
  const t = parseTrailers('s\n\nco-authored-by: A <a@x>\nCO-AUTHORED-BY: B <b@x>\n');
  assert.deepEqual(parseCoAuthors(t), [
    { name: 'A', email: 'a@x' },
    { name: 'B', email: 'b@x' },
  ]);
});

test('co-authors: a malformed value is kept, not silently dropped', () => {
  const t = parseTrailers('s\n\nCo-Authored-By: NoAngleBrackets\n');
  assert.deepEqual(parseCoAuthors(t), [{ name: 'NoAngleBrackets', email: '' }]);
});

test('decorations split on comma and trim', () => {
  assert.deepEqual(parseDecorations('HEAD -> main, origin/main, tag: v1.0'), [
    'HEAD -> main',
    'origin/main',
    'tag: v1.0',
  ]);
  assert.deepEqual(parseDecorations(''), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Commit detail
// ─────────────────────────────────────────────────────────────────────────────

test('commit detail carries the raw body and parsed trailers', () => {
  const body = 'subject\n\nCo-Authored-By: A <a@x>\n';
  const raw = record({ 0: 'a'.repeat(40), 9: 'subject', 11: body });
  const d = parseCommitDetail(raw);
  assert.ok(d);
  assert.equal(d.body, body);
  assert.deepEqual(d.trailers, [{ key: 'Co-Authored-By', value: 'A <a@x>' }]);
  // `files` is filled by the caller from a second `--numstat` invocation.
  assert.deepEqual(d.files, []);
  assert.equal(d.signature, null);
});

test('signature fields sit before %B and `N` reads as unsigned', () => {
  const withSig = (status: string, signer: string): string => {
    const f = Array.from({ length: LOG_FIELD_COUNT_WITH_SIGNATURE }, () => '');
    f[0] = 'a'.repeat(40);
    f[9] = 'subject';
    f[11] = status;
    f[12] = signer;
    f[13] = 'subject\n';
    return f.join(N) + N;
  };

  const good = parseCommitDetail(withSig('G', 'Chinedum <c@x>'), { withSignature: true });
  assert.deepEqual(good?.signature, { status: 'G', signer: 'Chinedum <c@x>' });
  assert.equal(good?.body, 'subject\n');

  // `N` = not signed. One falsy case for "no signature", not two.
  const none = parseCommitDetail(withSig('N', ''), { withSignature: true });
  assert.equal(none?.signature, null);
});

test('empty output is null, not a fabricated commit', () => {
  assert.equal(parseCommitDetail(''), null);
  assert.deepEqual(parseLog(''), []);
});
