import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingsDbClient, SqlExecutor } from '@ikenga/meetings-contract';
import { handleRecorderTool, RECORDER_TOOLS } from './recorder.js';
import { InMemorySqlExecutor } from '../sqlite.js';

class MockRecorderExecutor implements SqlExecutor {
  public inserted: any[] = [];
  async query<T = unknown>(sql: string): Promise<T[]> {
    if (sql.includes('SELECT * FROM meetings')) {
      return [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          title: 'test meeting 1',
          platform: 'local_recording',
          status: 'completed',
          start_time: '2026-08-31T11:00:00Z',
          duration_seconds: 1800,
          created_at: '2026-08-31T10:55:00Z',
          updated_at: '2026-08-31T11:30:00Z',
        },
      ] as T[];
    }
    return [] as T[];
  }
  async exec(sql: string, params: unknown[] = []): Promise<void> {
    this.inserted.push({ sql, params });
  }
}

describe('MCP Meetings Recorder Tools', () => {
  it('exposes list_meetings, start_recording, start_local_recorder, stop_recording, stop_local_recorder, schedule_recording', () => {
    const toolNames = RECORDER_TOOLS.map((t) => t.name);
    assert.ok(toolNames.includes('list_meetings'));
    assert.ok(toolNames.includes('start_recording'));
    assert.ok(toolNames.includes('start_local_recorder'));
    assert.ok(toolNames.includes('stop_recording'));
    assert.ok(toolNames.includes('stop_local_recorder'));
    assert.ok(toolNames.includes('schedule_recording'));
  });

  it('lists meetings from database', async () => {
    const mock = new MockRecorderExecutor();
    const client = new MeetingsDbClient(mock);
    const res = await handleRecorderTool(client, 'list_meetings', {});
    assert.equal(res.count, 1);
    assert.equal(res.meetings[0]?.title, 'test meeting 1');
  });

  it('starts and stops local recorder sessions via start_local_recorder & stop_local_recorder', async () => {
    const mock = new MockRecorderExecutor();
    const client = new MeetingsDbClient(mock);

    const startRes = await handleRecorderTool(client, 'start_local_recorder', {
      title: 'test recording session',
    });
    assert.equal(startRes.ok, true);
    assert.equal(startRes.status, 'recording');
    assert.ok(startRes.meeting_id);

    const stopRes = await handleRecorderTool(client, 'stop_local_recorder', {
      meeting_id: startRes.meeting_id,
    });
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.status, 'completed');
  });

  it('starts and stops recorder sessions via start_recording & stop_recording aliases', async () => {
    const mock = new MockRecorderExecutor();
    const client = new MeetingsDbClient(mock);

    const startRes = await handleRecorderTool(client, 'start_recording', {
      title: 'test call',
    });
    assert.equal(startRes.ok, true);
    assert.equal(startRes.status, 'recording');
    assert.ok(startRes.meeting_id);

    const stopRes = await handleRecorderTool(client, 'stop_recording', {
      meeting_id: startRes.meeting_id,
    });
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.status, 'completed');
  });

  it('schedules a future recording slot', async () => {
    const mock = new MockRecorderExecutor();
    const client = new MeetingsDbClient(mock);

    const schedRes = await handleRecorderTool(client, 'schedule_recording', {
      title: 'test scheduled meeting',
      start_time: '2026-09-01T15:00:00Z',
      platform: 'google_meet',
      url: 'https://meet.google.com/xyz-test',
    });

    assert.equal(schedRes.ok, true);
    assert.equal(schedRes.status, 'scheduled');
    assert.equal(schedRes.title, 'test scheduled meeting');
  });

  it('throws error for unknown recorder tool', async () => {
    const client = new MeetingsDbClient(new InMemorySqlExecutor());
    await assert.rejects(
      async () => handleRecorderTool(client, 'unknown_recorder_tool', {}),
      /Unknown recorder tool/
    );
  });
});
