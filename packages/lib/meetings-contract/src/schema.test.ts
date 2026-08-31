import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MeetingSchema,
  TranscriptSegmentSchema,
  MeetingSpeakerSchema,
  MeetingActionItemSchema,
  MeetingSummarySchema,
  MeetingPlatformSchema,
  SpeakerSourceSchema,
} from './schema.js';

describe('Meeting Entities & Schemas', () => {
  it('validates a complete Meeting record across platforms', () => {
    const validMeeting = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Q3 Royalties & Publishing Review',
      platform: 'google_meet',
      url: 'https://meet.google.com/abc-defg-hij',
      status: 'completed',
      start_time: '2026-08-31T10:00:00Z',
      end_time: '2026-08-31T10:45:00Z',
      duration_seconds: 2700,
      video_path: '/home/user/.ikenga/media/meetings/550e8400-e29b-41d4-a716-446655440000/video.mp4',
      audio_path: '/home/user/.ikenga/media/meetings/550e8400-e29b-41d4-a716-446655440000/audio.wav',
      created_at: '2026-08-31T09:55:00Z',
      updated_at: '2026-08-31T10:46:00Z',
    };

    const parsed = MeetingSchema.parse(validMeeting);
    assert.equal(parsed.platform, 'google_meet');
    assert.equal(parsed.duration_seconds, 2700);

    // Verify local_recording platform
    const localMeeting = {
      ...validMeeting,
      platform: 'local_recording',
      url: undefined,
    };
    const parsedLocal = MeetingSchema.parse(localMeeting);
    assert.equal(parsedLocal.platform, 'local_recording');
  });

  it('validates all three speaker_source values on MeetingSpeaker', () => {
    const sources: Array<'dom_cue' | 'audio_embedding' | 'manual'> = [
      'dom_cue',
      'audio_embedding',
      'manual',
    ];

    for (const source of sources) {
      const speaker = {
        id: '660e8400-e29b-41d4-a716-446655440001',
        meeting_id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Producer Dave',
        speaker_source: source,
      };
      const parsed = MeetingSpeakerSchema.parse(speaker);
      assert.equal(parsed.speaker_source, source);
    }
  });

  it('validates TranscriptSegment with word-level timestamps and speaker_source', () => {
    const segment = {
      id: '770e8400-e29b-41d4-a716-446655440002',
      meeting_id: '550e8400-e29b-41d4-a716-446655440000',
      speaker_id: '660e8400-e29b-41d4-a716-446655440001',
      speaker_name: 'Producer Dave',
      speaker_source: 'dom_cue',
      start_ms: 1200,
      end_ms: 3800,
      text: 'We agreed on a 50-50 publishing split.',
      confidence: 0.96,
      words: [
        { word: 'We', start_ms: 1200, end_ms: 1400, confidence: 0.98 },
        { word: 'agreed', start_ms: 1420, end_ms: 1800, confidence: 0.99 },
        { word: 'on', start_ms: 1820, end_ms: 1950, confidence: 0.99 },
        { word: 'a', start_ms: 1960, end_ms: 2050, confidence: 0.95 },
        { word: '50-50', start_ms: 2100, end_ms: 2600, confidence: 0.92 },
        { word: 'publishing', start_ms: 2650, end_ms: 3200, confidence: 0.97 },
        { word: 'split.', start_ms: 3250, end_ms: 3800, confidence: 0.96 },
      ],
    };

    const parsed = TranscriptSegmentSchema.parse(segment);
    assert.equal(parsed.words?.length, 7);
    assert.equal(parsed.speaker_source, 'dom_cue');
  });

  it('validates MeetingActionItem and MeetingSummary', () => {
    const actionItem = {
      id: '880e8400-e29b-41d4-a716-446655440003',
      meeting_id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Draft split agreement contract',
      assignee: 'Legal Team',
      due_date: '2026-09-05',
      status: 'pending',
    };
    const parsedAction = MeetingActionItemSchema.parse(actionItem);
    assert.equal(parsedAction.status, 'pending');

    const summary = {
      id: '990e8400-e29b-41d4-a716-446655440004',
      meeting_id: '550e8400-e29b-41d4-a716-446655440000',
      executive_summary: 'Agreed on 50/50 publishing split and delivery of final mix by Friday.',
      key_decisions: ['50/50 publishing split locked', 'Master delivery set for Friday'],
      topics_json: ['Publishing', 'Delivery Schedule', 'Contract Terms'],
    };
    const parsedSummary = MeetingSummarySchema.parse(summary);
    assert.equal(parsedSummary.key_decisions.length, 2);
  });
});
