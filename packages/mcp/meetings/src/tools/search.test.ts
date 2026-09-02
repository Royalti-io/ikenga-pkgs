import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingsDbClient, SqlExecutor } from '@ikenga/meetings-contract';
import { handleSearchTool, SEARCH_TOOLS } from './search.js';
import { InMemorySqlExecutor } from '../sqlite.js';

class MockSearchExecutor implements SqlExecutor {
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (sql.includes('SELECT * FROM meeting_transcripts WHERE text LIKE ?')) {
      return [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          meeting_id: '550e8400-e29b-41d4-a716-446655440000',
          speaker_name: 'Speaker 1',
          speaker_source: 'dom_cue',
          start_ms: 1000,
          end_ms: 3000,
          text: 'lorem ipsum test search keyword target text',
          confidence: 0.98,
        },
      ] as T[];
    }
    if (sql.includes('SELECT * FROM meeting_transcripts WHERE meeting_id = ?')) {
      return [
        {
          id: '770e8400-e29b-41d4-a716-446655440002',
          meeting_id: '550e8400-e29b-41d4-a716-446655440000',
          speaker_name: 'Speaker 1',
          speaker_source: 'dom_cue',
          start_ms: 1000,
          end_ms: 3000,
          text: 'lorem ipsum test search keyword target text',
          confidence: 0.98,
        },
      ] as T[];
    }
    if (sql.includes('SELECT * FROM meeting_speakers WHERE meeting_id = ?')) {
      return [
        {
          id: '660e8400-e29b-41d4-a716-446655440001',
          meeting_id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Speaker 1',
          speaker_source: 'dom_cue',
        },
      ] as T[];
    }
    if (sql.includes('SELECT * FROM meeting_summaries WHERE meeting_id = ?')) {
      const id = String(params[0]);
      if (id === '550e8400-e29b-41d4-a716-446655440000') {
        return [
          {
            id: '990e8400-e29b-41d4-a716-446655440004',
            meeting_id: '550e8400-e29b-41d4-a716-446655440000',
            executive_summary: 'test meeting summary text',
            key_decisions_json: '["test decision 1"]',
            topics_json: '["topic 1", "topic 2"]',
            created_at: '2026-08-31T10:00:00.000Z',
          },
        ] as T[];
      }
      return [] as T[];
    }
    return [] as T[];
  }
  async exec(): Promise<void> {}
}

describe('MCP Meetings Search Tools', () => {
  it('exposes correct search tool definitions', () => {
    const toolNames = SEARCH_TOOLS.map((t) => t.name);
    assert.deepEqual(toolNames, [
      'search_transcripts',
      'get_meeting_transcript',
      'get_meeting_summary',
    ]);
  });

  it('searches transcripts across meetings', async () => {
    const client = new MeetingsDbClient(new MockSearchExecutor());
    const res = await handleSearchTool(client, 'search_transcripts', { query: 'keyword target' });
    assert.equal(res.count, 1);
    assert.equal(res.segments[0]?.speaker, 'Speaker 1');
    assert.ok(res.segments[0]?.text.includes('keyword target'));
  });

  it('retrieves full meeting transcript segments and speaker roster', async () => {
    const client = new MeetingsDbClient(new MockSearchExecutor());
    const res = await handleSearchTool(client, 'get_meeting_transcript', {
      meeting_id: '550e8400-e29b-41d4-a716-446655440000',
    });
    assert.equal(res.meeting_id, '550e8400-e29b-41d4-a716-446655440000');
    assert.equal(res.segment_count, 1);
    assert.equal(res.speakers.length, 1);
    assert.equal(res.speakers[0]?.name, 'Speaker 1');
    assert.equal(res.segments[0]?.speaker, 'Speaker 1');
  });

  it('retrieves meeting summary when found', async () => {
    const client = new MeetingsDbClient(new MockSearchExecutor());
    const res = await handleSearchTool(client, 'get_meeting_summary', {
      meeting_id: '550e8400-e29b-41d4-a716-446655440000',
    });
    assert.equal(res.found, true);
    assert.equal(res.executive_summary, 'test meeting summary text');
    assert.equal(res.key_decisions.length, 1);
    assert.deepEqual(res.topics, ['topic 1', 'topic 2']);
  });

  it('returns graceful not-found message when summary does not exist', async () => {
    const client = new MeetingsDbClient(new MockSearchExecutor());
    const res = await handleSearchTool(client, 'get_meeting_summary', {
      meeting_id: '00000000-0000-0000-0000-000000000000',
    });
    assert.equal(res.found, false);
    assert.ok(res.message.includes('No summary generated yet'));
  });

  it('throws error for unknown search tool', async () => {
    const client = new MeetingsDbClient(new InMemorySqlExecutor());
    await assert.rejects(
      async () => handleSearchTool(client, 'unknown_tool', {}),
      /Unknown search tool/
    );
  });
});
