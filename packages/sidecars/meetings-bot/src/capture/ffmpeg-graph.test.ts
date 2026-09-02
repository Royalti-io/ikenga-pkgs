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

  // ── Regression: both sides of the meeting must be captured ─────────────
  // The first cut of this builder emitted `-f pulse -i default`, which is the
  // default *source* (the mic). A meeting recorded that way contains only the
  // local speaker — every remote participant is silent. These tests pin the
  // dual-input mix so that cannot regress silently.
  it('captures system audio AND mic by default on linux pulse', () => {
    const args = buildFfmpegArgs({
      audioInput: { type: 'pulse' },
      outputAudioPath: '/tmp/m/audio.wav',
    });

    // Two pulse inputs, not one.
    const inputCount = args.filter((a) => a === '-i').length;
    assert.equal(inputCount, 2, 'expected two capture inputs (monitor + mic)');

    assert.ok(args.includes('@DEFAULT_MONITOR@'), 'must capture the output sink monitor (remote participants)');
    assert.ok(args.includes('@DEFAULT_SOURCE@'), 'must capture the default input (local mic)');

    // Mixed down to a single mono track for whisper.
    const filterIdx = args.indexOf('-filter_complex');
    assert.ok(filterIdx !== -1, 'expected an amix filter graph');
    assert.match(String(args[filterIdx + 1]), /amix=inputs=2/);
    assert.ok(args.includes('-map'), 'mixed output must be explicitly mapped');

    // Never records the bare `default` source, which is the original bug.
    assert.ok(!args.includes('default'), 'must not fall back to the bare default source');
  });

  it('honours an explicit monitor override for the system-audio leg', () => {
    const args = buildFfmpegArgs({
      audioInput: { type: 'pulse', deviceOrSink: 'ikenga_meetings_sink.monitor' },
      outputAudioPath: '/tmp/m/audio.wav',
    });
    assert.ok(args.includes('ikenga_meetings_sink.monitor'));
    // The mic leg is still present alongside the override.
    assert.ok(args.includes('@DEFAULT_SOURCE@'));
  });

  it('falls back to a single input when the mix is explicitly disabled', () => {
    const args = buildFfmpegArgs({
      audioInput: { type: 'pulse', deviceOrSink: 'some.monitor' },
      mixSystemAndMic: false,
      outputAudioPath: '/tmp/m/audio.wav',
    });
    assert.equal(args.filter((a) => a === '-i').length, 1);
    assert.ok(!args.includes('-filter_complex'));
  });
});
