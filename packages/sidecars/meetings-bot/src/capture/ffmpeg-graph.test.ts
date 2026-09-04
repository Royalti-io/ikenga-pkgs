import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFfmpegArgs, deriveStereoPath, FfmpegGraphConfig } from './ffmpeg-graph.js';

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

  it('asplits the mix when a compressed playback copy is requested', () => {
    // A filter output pad can only be consumed by ONE output, so mapping
    // [aout] into both the WAV and the M4A fails at runtime with "Filter aout
    // has an unconnected output". The graph must split instead.
    const args = buildFfmpegArgs({
      audioInput: { type: 'pulse' },
      outputAudioPath: '/tmp/m/audio.wav',
      outputCompressedPath: '/tmp/m/audio.m4a',
    });

    const filterIdx = args.indexOf('-filter_complex');
    assert.match(String(args[filterIdx + 1]), /asplit=2\[aout\]\[acomp\]/);

    // Both outputs are mapped, from different pads.
    assert.ok(args.includes('[aout]'));
    assert.ok(args.includes('[acomp]'));
    assert.equal(args.filter((a) => a === '-map').length, 2);

    // Compressed copy is low-bitrate mono: it exists to cross the MCP bridge
    // as base64, where size is the binding constraint.
    assert.ok(args.includes('32k'));
    assert.ok(args.includes('/tmp/m/audio.m4a'));
  });

  it('does not asplit when only the master is requested', () => {
    const args = buildFfmpegArgs({
      audioInput: { type: 'pulse' },
      outputAudioPath: '/tmp/m/audio.wav',
    });
    const filterIdx = args.indexOf('-filter_complex');
    assert.ok(!String(args[filterIdx + 1]).includes('asplit'));
    assert.equal(args.filter((a) => a === '-map').length, 1);
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

  // ── WP-21: stereo master for free two-way speaker attribution (D-15) ───
  describe('stereo master (left=monitor/remote, right=mic/local)', () => {
    it('adds a join filter chain and a third mapped output alongside the existing mono outputs', () => {
      const args = buildFfmpegArgs({
        audioInput: { type: 'pulse' },
        outputAudioPath: '/tmp/m/audio.wav',
        outputCompressedPath: '/tmp/m/audio.m4a',
        outputStereoPath: '/tmp/m/audio.stereo.wav',
      });

      // Still exactly two capture inputs — the stereo master is a second
      // filter chain off the SAME two inputs, not a third input.
      assert.equal(args.filter((a) => a === '-i').length, 2);

      const filterIdx = args.indexOf('-filter_complex');
      assert.ok(filterIdx !== -1);
      const graph = String(args[filterIdx + 1]);
      assert.match(graph, /amix=inputs=2.*asplit=2\[aout\]\[acomp\]/);
      assert.match(graph, /join=inputs=2:channel_layout=stereo:map=0\.0-FL\|1\.0-FR\[astereo\]/);

      // Three mapped outputs now: the mono master, the compressed copy, and
      // the stereo master.
      assert.equal(args.filter((a) => a === '-map').length, 3);
      assert.ok(args.includes('[astereo]'));

      // Existing mono outputs are unchanged: 16kHz mono PCM master, 32k mono
      // AAC compressed copy.
      assert.ok(args.includes('pcm_s16le'));
      assert.ok(args.includes('/tmp/m/audio.wav'));
      assert.ok(args.includes('32k'));
      assert.ok(args.includes('/tmp/m/audio.m4a'));

      // The new stereo output is 2-channel PCM, not mono, and lands at its
      // own path.
      const stereoOutIdx = args.indexOf('/tmp/m/audio.stereo.wav');
      assert.ok(stereoOutIdx !== -1);
      assert.equal(args[stereoOutIdx - 1], '2', 'stereo master must be -ac 2');
    });

    it('works standalone (no compressed copy requested)', () => {
      const args = buildFfmpegArgs({
        audioInput: { type: 'pulse' },
        outputAudioPath: '/tmp/m/audio.wav',
        outputStereoPath: '/tmp/m/audio.stereo.wav',
      });

      const filterIdx = args.indexOf('-filter_complex');
      const graph = String(args[filterIdx + 1]);
      assert.match(graph, /amix=inputs=2:duration=longest:dropout_transition=0\[aout\]/);
      assert.ok(!graph.includes('asplit'), 'no compressed copy means no asplit on the mix leg');
      assert.match(graph, /join=inputs=2:channel_layout=stereo/);
      assert.equal(args.filter((a) => a === '-map').length, 2);
      assert.ok(args.includes('/tmp/m/audio.stereo.wav'));
    });

    it('is silently ignored on the single-device (non-dual-source) path', () => {
      // Nothing to split when there was only ever one input — asserting this
      // stays quiet rather than erroring keeps `outputStereoPath` safe to set
      // unconditionally at the call site regardless of platform/config.
      const args = buildFfmpegArgs({
        audioInput: { type: 'pulse', deviceOrSink: 'some.monitor' },
        mixSystemAndMic: false,
        outputAudioPath: '/tmp/m/audio.wav',
        outputStereoPath: '/tmp/m/audio.stereo.wav',
      });
      assert.ok(!args.includes('/tmp/m/audio.stereo.wav'));
      assert.ok(!args.includes('[astereo]'));
    });
  });

  describe('deriveStereoPath', () => {
    it('sits next to the mono master with a .stereo.wav suffix', () => {
      assert.equal(deriveStereoPath('/tmp/m/audio.wav'), '/tmp/m/audio.stereo.wav');
    });
  });
});
