import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFfmpegArgs, FfmpegGraphConfig } from './ffmpeg-graph.js';

describe('FFmpeg Parameterized Graph Builder', () => {
  it('builds valid args for x11grab and pulse audio', () => {
    const config: FfmpegGraphConfig = {
      videoInput: {
        type: 'x11grab',
        displayOrWindow: ':99.0',
        framerate: 25,
      },
      audioInput: {
        type: 'pulse',
        deviceOrSink: 'virtual-sink.monitor',
      },
      outputVideoPath: '/tmp/meetings/m1/video.mp4',
      outputAudioPath: '/tmp/meetings/m1/audio.wav',
    };

    const args = buildFfmpegArgs(config);

    // Verify video input
    assert.ok(args.includes('-f'));
    assert.ok(args.includes('x11grab'));
    assert.ok(args.includes(':99.0'));
    assert.ok(args.includes('25'));

    // Verify audio input
    assert.ok(args.includes('pulse'));
    assert.ok(args.includes('virtual-sink.monitor'));

    // Verify video output encoding (H.264 + AAC + faststart)
    assert.ok(args.includes('libx264'));
    assert.ok(args.includes('aac'));
    assert.ok(args.includes('+faststart'));
    assert.ok(args.includes('/tmp/meetings/m1/video.mp4'));

    // Verify audio output extraction (16kHz mono PCM)
    assert.ok(args.includes('pcm_s16le'));
    assert.ok(args.includes('16000'));
    assert.ok(args.includes('/tmp/meetings/m1/audio.wav'));
  });

  it('builds valid args for gdigrab and dshow on Windows', () => {
    const config: FfmpegGraphConfig = {
      videoInput: {
        type: 'gdigrab',
        displayOrWindow: 'desktop',
      },
      audioInput: {
        type: 'dshow',
        deviceOrSink: 'audio=virtual-audio-capturer',
      },
      outputVideoPath: 'C:\\media\\video.mp4',
      outputAudioPath: 'C:\\media\\audio.wav',
    };

    const args = buildFfmpegArgs(config);
    assert.ok(args.includes('gdigrab'));
    assert.ok(args.includes('desktop'));
    assert.ok(args.includes('dshow'));
  });
});
