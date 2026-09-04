import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelExtractArgs, deriveChannelPath } from './channel-extract.js';

describe('channel extraction (WP-21 per-speaker transcription)', () => {
  it('extracts the left channel (monitor/remote) with a pan filter', () => {
    const args = buildChannelExtractArgs('/tmp/m/audio.stereo.wav', '/tmp/m/audio.channel-left.wav', 'left');
    assert.deepEqual(args, [
      '-y',
      '-i', '/tmp/m/audio.stereo.wav',
      '-af', 'pan=mono|c0=c0',
      '-vn',
      '-c:a', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '/tmp/m/audio.channel-left.wav',
    ]);
  });

  it('extracts the right channel (mic/local) with a pan filter', () => {
    const args = buildChannelExtractArgs('/tmp/m/audio.stereo.wav', '/tmp/m/audio.channel-right.wav', 'right');
    const afIdx = args.indexOf('-af');
    assert.equal(args[afIdx + 1], 'pan=mono|c0=c1');
  });

  it('outputs mono 16kHz PCM, matching whisper.cpp\'s native input format', () => {
    const args = buildChannelExtractArgs('/tmp/m/audio.stereo.wav', '/tmp/m/audio.channel-left.wav', 'left');
    assert.ok(args.includes('pcm_s16le'));
    assert.ok(args.includes('16000'));
    const acIdx = args.indexOf('-ac');
    assert.equal(args[acIdx + 1], '1');
  });

  it('derives the channel path next to the stereo master', () => {
    assert.equal(
      deriveChannelPath('/tmp/m/audio.stereo.wav', 'left'),
      '/tmp/m/audio.channel-left.wav'
    );
    assert.equal(
      deriveChannelPath('/tmp/m/audio.stereo.wav', 'right'),
      '/tmp/m/audio.channel-right.wav'
    );
  });
});
