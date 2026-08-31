import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFfmpegArgs, FfmpegGraphConfig } from './ffmpeg-graph.js';

describe('FFmpeg Audio-Only Graph Builder', () => {
  it('builds valid audio capture args for pulse audio', () => {
    const config: FfmpegGraphConfig = {
      audioInput: {
        type: 'pulse',
        deviceOrSink: 'virtual-sink.monitor',
      },
      outputAudioPath: '/tmp/meetings/m1/audio.wav',
    };

    const args = buildFfmpegArgs(config);

    // Verify audio input
    assert.ok(args.includes('-f'));
    assert.ok(args.includes('pulse'));
    assert.ok(args.includes('virtual-sink.monitor'));

    // Verify no video stream (-vn)
    assert.ok(args.includes('-vn'));

    // Verify 16kHz mono PCM output
    assert.ok(args.includes('pcm_s16le'));
    assert.ok(args.includes('16000'));
    assert.ok(args.includes('-ac'));
    assert.ok(args.includes('1'));
    assert.ok(args.includes('/tmp/meetings/m1/audio.wav'));
  });

  it('builds valid audio args with optional compressed playback file', () => {
    const config: FfmpegGraphConfig = {
      audioInput: {
        type: 'default',
      },
      outputAudioPath: 'C:\\media\\audio.wav',
      outputCompressedPath: 'C:\\media\\audio.m4a',
    };

    const args = buildFfmpegArgs(config);
    assert.ok(args.includes('C:\\media\\audio.wav'));
    assert.ok(args.includes('C:\\media\\audio.m4a'));
    assert.ok(args.includes('aac'));
  });
});
