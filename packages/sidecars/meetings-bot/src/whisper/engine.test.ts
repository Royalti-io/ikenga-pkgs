import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateWer, parseWhisperCppJson } from './engine.js';

describe('Local Whisper STT Engine', () => {
  it('calculates exact Word Error Rate (WER) against benchmark reference', () => {
    const reference = 'we agreed on a fifty fifty publishing split';
    const perfectHypothesis = 'we agreed on a fifty fifty publishing split';
    assert.equal(calculateWer(reference, perfectHypothesis), 0);

    const oneSub = 'we agreed on a sixty fifty publishing split';
    // 1 edit / 8 words = 0.125
    assert.equal(calculateWer(reference, oneSub), 0.125);

    const oneInsert = 'we agreed on a fifty fifty master publishing split';
    // 1 insertion / 8 words = 0.125
    assert.equal(calculateWer(reference, oneInsert), 0.125);

    const oneDelete = 'we agreed on a fifty publishing split';
    // 1 deletion / 8 words = 0.125
    assert.equal(calculateWer(reference, oneDelete), 0.125);
  });

  it('parses whisper.cpp JSON with word-level timestamps', () => {
    const sampleWhisperJson = {
      transcription: [
        {
          timestamps: { from: '00:00:01.000', to: '00:00:03.500' },
          text: ' Let us finalize the contract terms.',
          words: [
            {
              timestamps: { from: '00:00:01.000', to: '00:00:01.400' },
              word: 'Let',
              confidence: 0.98,
            },
            {
              timestamps: { from: '00:00:01.450', to: '00:00:01.650' },
              word: 'us',
              confidence: 0.99,
            },
            {
              timestamps: { from: '00:00:01.700', to: '00:00:02.200' },
              word: 'finalize',
              confidence: 0.97,
            },
            {
              timestamps: { from: '00:00:02.250', to: '00:00:02.450' },
              word: 'the',
              confidence: 0.99,
            },
            {
              timestamps: { from: '00:00:02.500', to: '00:00:02.900' },
              word: 'contract',
              confidence: 0.95,
            },
            {
              timestamps: { from: '00:00:02.950', to: '00:00:03.500' },
              word: 'terms.',
              confidence: 0.96,
            },
          ],
        },
      ],
    };

    const meetingId = '550e8400-e29b-41d4-a716-446655440000';
    const segments = parseWhisperCppJson(sampleWhisperJson, meetingId);

    assert.equal(segments.length, 1);
    const seg = segments[0]!;
    assert.equal(seg.text, 'Let us finalize the contract terms.');
    assert.equal(seg.start_ms, 1000);
    assert.equal(seg.end_ms, 3500);
    assert.equal(seg.words?.length, 6);
    assert.equal(seg.words[0]?.word, 'Let');
    assert.equal(seg.words[0]?.start_ms, 1000);
  });
});

describe('whisper.cpp timestamp parsing', () => {
  it('keeps milliseconds from SRT-style comma-separated timestamps', () => {
    // Regression: whisper.cpp writes "00:00:01,220"; parseFloat("01,220") is 1,
    // so the milliseconds were silently dropped and every segment snapped to a
    // whole second. Player seeks then landed up to 1s off the spoken word.
    const segs = parseWhisperCppJson(
      {
        transcription: [
          { timestamps: { from: '00:00:01,220', to: '00:00:02,750' }, text: 'hello there' },
        ],
      },
      'm1'
    );
    assert.equal(segs.length, 1);
    assert.equal(segs[0]?.start_ms, 1220);
    assert.equal(segs[0]?.end_ms, 2750);
  });

  it('prefers the numeric offsets block over the display timestamps', () => {
    const segs = parseWhisperCppJson(
      {
        transcription: [
          {
            offsets: { from: 4321, to: 8765 },
            timestamps: { from: '00:00:04,321', to: '00:00:08,765' },
            text: 'offsets win',
          },
        ],
      },
      'm1'
    );
    assert.equal(segs[0]?.start_ms, 4321);
    assert.equal(segs[0]?.end_ms, 8765);
  });

  it('still handles period-separated timestamps', () => {
    const segs = parseWhisperCppJson(
      { transcription: [{ timestamps: { from: '00:00:02.500', to: '00:00:03.250' }, text: 'x' }] },
      'm1'
    );
    assert.equal(segs[0]?.start_ms, 2500);
    assert.equal(segs[0]?.end_ms, 3250);
  });
});
