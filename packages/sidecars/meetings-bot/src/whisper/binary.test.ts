import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhisperBinary } from './binary.js';

describe('Whisper Binary Resolution', () => {
  it('gracefully handles missing whisper binary with helpful error message', async () => {
    const res = await resolveWhisperBinary('/non_existent_whisper_path_999');
    assert.equal(res.available, false);
    assert.ok(res.error?.includes('whisper-cli'));
  });
});
