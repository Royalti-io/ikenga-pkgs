import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingsDbClient, SqlExecutor } from '@ikenga/meetings-contract';
import { handleRecorderTool } from './recorder.js';

class MockRecorderExecutor implements SqlExecutor {
  public inserted: any[] = [];
  async query<T = unknown>(sql: string): Promise<T[]> {
    if (sql.includes('SELECT * FROM meetings')) {
      return [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          title: 'A&R Demo Listening',
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
  it('lists meetings from database', async () => {
    const mock = new MockRecorderExecutor();
    const client = new MeetingsDbClient(mock);
    const res = await handleRecorderTool(client, 'list_meetings', {});
    assert.equal(res.count, 1);
    assert.equal(res.meetings[0]?.title, 'A&R Demo Listening');
  });

  it('starts and stops local recorder sessions', async () => {
    const mock = new MockRecorderExecutor();
    const client = new MeetingsDbClient(mock);

    const startRes = await handleRecorderTool(client, 'start_local_recorder', {
      title: 'Label Strategy Sync',
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

  it('schedules a future recording slot', async () => {
    const mock = new MockRecorderExecutor();
    const client = new MeetingsDbClient(mock);

    const schedRes = await handleRecorderTool(client, 'schedule_recording', {
      title: 'Publishing Quarterly Call',
      start_time: '2026-09-01T15:00:00Z',
      platform: 'google_meet',
      url: 'https://meet.google.com/xyz-123',
    });

    assert.equal(schedRes.ok, true);
    assert.equal(schedRes.status, 'scheduled');
    assert.equal(schedRes.title, 'Publishing Quarterly Call');
  });
});
