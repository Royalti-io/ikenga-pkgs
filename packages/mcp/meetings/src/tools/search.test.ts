import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingsDbClient, SqlExecutor } from '@ikenga/meetings-contract';
import { handleSearchTool } from './search.js';

class MockSearchExecutor implements SqlExecutor {
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (sql.includes('SELECT * FROM meeting_transcripts WHERE text LIKE ?')) {
      return [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          meeting_id: '550e8400-e29b-41d4-a716-446655440000',
          speaker_name: 'Sarah',
          speaker_source: 'dom_cue',
          start_ms: 1000,
          end_ms: 3000,
          text: 'We agreed on a 50-50 publishing split.',
          confidence: 0.98,
        },
      ] as T[];
    }
    if (sql.includes('SELECT * FROM meeting_summaries WHERE meeting_id = ?')) {
      return [
        {
          id: '990e8400-e29b-41d4-a716-446655440004',
          meeting_id: '550e8400-e29b-41d4-a716-446655440000',
          executive_summary: 'Publishing agreement finalized.',
          key_decisions_json: '["50-50 split agreed"]',
          topics_json: '["Publishing", "Splits"]',
          created_at: '2026-08-31T10:00:00Z',
        },
      ] as T[];
    }
    return [] as T[];
  }
  async exec(): Promise<void> {}
}

describe('MCP Meetings Search Tools', () => {
  it('searches transcripts across meetings', async () => {
    const client = new MeetingsDbClient(new MockSearchExecutor());
    const res = await handleSearchTool(client, 'search_transcripts', { query: 'publishing split' });
    assert.equal(res.count, 1);
    assert.equal(res.segments[0]?.speaker, 'Sarah');
    assert.ok(res.segments[0]?.text.includes('50-50'));
  });

  it('retrieves meeting summary', async () => {
    const client = new MeetingsDbClient(new MockSearchExecutor());
    const res = await handleSearchTool(client, 'get_meeting_summary', {
      meeting_id: '550e8400-e29b-41d4-a716-446655440000',
    });
    assert.equal(res.found, true);
    assert.equal(res.executive_summary, 'Publishing agreement finalized.');
    assert.equal(res.key_decisions.length, 1);
  });
});
