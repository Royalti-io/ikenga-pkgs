import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptSegment } from '@ikenga/meetings-contract';
import { summarizeMeetingTranscript } from './summarizer.js';

describe('Meeting Intelligence Summarizer', () => {
  it('extracts executive summary, decisions, and action items', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'seg-1',
        meeting_id: 'm-100',
        speaker_name: 'David',
        speaker_source: 'dom_cue',
        start_ms: 1000,
        end_ms: 5000,
        confidence: 0.98,
        text: 'We agreed on a 50-50 publishing split for the album track.',
      },
      {
        id: 'seg-2',
        meeting_id: 'm-100',
        speaker_name: 'Sarah',
        speaker_source: 'dom_cue',
        start_ms: 6000,
        end_ms: 10000,
        confidence: 0.95,
        text: 'I will send the revised split sheet contract by Friday.',
      },
    ];

    const result = summarizeMeetingTranscript('m-100', segments);

    // Summary
    assert.equal(result.summary.meeting_id, 'm-100');
    assert.ok(result.summary.executive_summary.includes('Publishing'));
    assert.equal(result.summary.key_decisions.length, 1);
    assert.ok(result.summary.key_decisions[0]?.includes('50-50'));

    // Action Items
    assert.equal(result.actionItems.length, 1);
    assert.equal(result.actionItems[0]?.assignee, 'Sarah');
    assert.ok(result.actionItems[0]?.title.includes('revised split sheet'));
  });
});
