import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhisperBinary } from './binary.js';

describe('Whisper Binary Resolution', () => {
  it('gracefully handles missing whisper binary with helpful error message', async () => {
    const res = await resolveWhisperBinary('/non_existent_whisper_path_999');
    assert.equal(res.available, false);
    assert.ok(res.error?.includes('whisper-cli'));
  });

  it('does NOT fall back to another binary when an explicit path is wrong', async () => {
    // Regression: the resolver used to treat an explicit path as merely the
    // first entry in a candidate chain, so on a machine that happens to have
    // whisper installed at ~/.ikenga/bin, a bogus --whisper-bin still resolved
    // — silently transcribing with a binary the user did not choose, and
    // making the "is it installed" probe impossible to fail.
    const res = await resolveWhisperBinary('/definitely/not/whisper/anywhere');
    assert.equal(res.available, false);
    assert.equal(res.source, undefined);
    assert.match(String(res.error), /configured path/);
  });
});
