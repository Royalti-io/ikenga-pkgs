import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingsDbClient, SqlExecutor } from './client.js';

class MockSqlExecutor implements SqlExecutor {
  public executed: Array<{ sql: string; params?: unknown[] }> = [];
  public queryResults: Array<{ sqlPattern: string; rows: unknown[] }> = [];

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    this.executed.push({ sql, params });
    for (const qr of this.queryResults) {
      if (sql.includes(qr.sqlPattern)) {
        return qr.rows as T[];
      }
    }
    return [];
  }

  async exec(sql: string, params?: unknown[]): Promise<void> {
    this.executed.push({ sql, params });
  }
}

describe('MeetingsDbClient', () => {
  it('inserts and queries a meeting record', async () => {
    const mock = new MockSqlExecutor();
    const client = new MeetingsDbClient(mock);

    const meeting = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Label Pitch Review',
      platform: 'google_meet' as const,
      url: 'https://meet.google.com/xyz',
      status: 'scheduled' as const,
      start_time: '2026-08-31T10:00:00Z',
      duration_seconds: 0,
      created_at: '2026-08-31T09:50:00Z',
      updated_at: '2026-08-31T09:50:00Z',
    };

    await client.insertMeeting(meeting);
    assert.equal(mock.executed.length, 1);
    assert.ok(mock.executed[0]?.sql.includes('INSERT INTO meetings'));

    mock.queryResults.push({
      sqlPattern: 'SELECT * FROM meetings WHERE id = ?',
      rows: [meeting],
    });

    const fetched = await client.getMeetingById(meeting.id);
    assert.ok(fetched);
    assert.equal(fetched.title, 'Label Pitch Review');
  });

  it('handles speakers, transcripts with words_json, action items, and summaries', async () => {
    const mock = new MockSqlExecutor();
    const client = new MeetingsDbClient(mock);

    const meetingId = '550e8400-e29b-41d4-a716-446655440000';

    // Speaker
    await client.insertSpeaker({
      id: '660e8400-e29b-41d4-a716-446655440001',
      meeting_id: meetingId,
      name: 'Alice',
      speaker_source: 'dom_cue',
    });

    // Transcript Segment
    await client.insertTranscriptSegment({
      id: '770e8400-e29b-41d4-a716-446655440002',
      meeting_id: meetingId,
      start_ms: 0,
      end_ms: 2000,
      text: 'Hello team.',
      confidence: 1.0,
      words: [{ word: 'Hello', start_ms: 0, end_ms: 800, confidence: 1.0 }],
    });

    // Action Item
    await client.insertActionItem({
      id: '880e8400-e29b-41d4-a716-446655440003',
      meeting_id: meetingId,
      title: 'Finalize audio mastering contract',
      status: 'pending',
    });

    // Summary
    await client.insertSummary({
      id: '990e8400-e29b-41d4-a716-446655440004',
      meeting_id: meetingId,
      executive_summary: 'Discussed album delivery.',
      key_decisions: ['Master delivery next week'],
      topics_json: ['Album', 'Delivery'],
    });

    // Assert executions recorded
    assert.ok(mock.executed.some((e) => e.sql.includes('INSERT INTO meeting_speakers')));
    assert.ok(mock.executed.some((e) => e.sql.includes('INSERT INTO meeting_transcripts')));
    assert.ok(mock.executed.some((e) => e.sql.includes('INSERT INTO meeting_action_items')));
    assert.ok(mock.executed.some((e) => e.sql.includes('INSERT INTO meeting_summaries')));
  });

  it('performs cascading deletion across all 5 tables', async () => {
    const mock = new MockSqlExecutor();
    const client = new MeetingsDbClient(mock);

    const meetingId = '550e8400-e29b-41d4-a716-446655440000';
    await client.deleteMeetingCascade(meetingId);

    const tables = [
      'meeting_transcripts',
      'meeting_speakers',
      'meeting_action_items',
      'meeting_summaries',
      'meetings',
    ];

    for (const table of tables) {
      assert.ok(
        mock.executed.some((e) => e.sql.includes(`DELETE FROM ${table}`)),
        `Expected DELETE FROM ${table}`
      );
    }
  });
});
