import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { MeetingsDbClient } from '@ikenga/meetings-contract';
import { BetterSqliteExecutor } from './sqlite.js';
import { handleSearchTool } from './tools/search.js';
import { handleRecorderTool } from './tools/recorder.js';

describe('MCP Meetings Real SQLite Integration Test', () => {
  let tmpDbPath: string;
  let executor: BetterSqliteExecutor;
  let client: MeetingsDbClient;

  const meetingId = '7b053bb1-29a3-4e07-bfc5-3c4e40d08033';
  const speaker1Id = '8c053bb1-29a3-4e07-bfc5-3c4e40d08034';
  const speaker2Id = '9d053bb1-29a3-4e07-bfc5-3c4e40d08035';
  const transcript1Id = 'ae053bb1-29a3-4e07-bfc5-3c4e40d08036';
  const transcript2Id = 'bf053bb1-29a3-4e07-bfc5-3c4e40d08037';
  const summaryId = 'd1053bb1-29a3-4e07-bfc5-3c4e40d08039';

  before(async () => {
    tmpDbPath = path.join(os.tmpdir(), `test-meetings-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
    executor = new BetterSqliteExecutor(tmpDbPath);
    client = new MeetingsDbClient(executor);

    // Insert meeting row with nullable columns explicitly NULL in SQLite
    await executor.exec(`
      INSERT INTO meetings (
        id, title, platform, url, status, start_time, end_time, duration_seconds, video_path, audio_path, created_at, updated_at
      ) VALUES (
        '${meetingId}',
        'test meeting 1',
        'google_meet',
        'https://meet.google.com/test-abc-xyz',
        'completed',
        '2026-09-02T10:00:00.000Z',
        '2026-09-02T10:45:00.000Z',
        2700,
        NULL,
        NULL,
        '2026-09-02T09:55:00.000Z',
        '2026-09-02T10:46:00.000Z'
      );

      INSERT INTO meeting_speakers (
        id, meeting_id, name, avatar_url, contact_id, speaker_source
      ) VALUES (
        '${speaker1Id}',
        '${meetingId}',
        'Speaker 1',
        NULL,
        NULL,
        'dom_cue'
      ), (
        '${speaker2Id}',
        '${meetingId}',
        'Speaker 2',
        NULL,
        NULL,
        'audio_embedding'
      );

      INSERT INTO meeting_transcripts (
        id, meeting_id, speaker_id, speaker_name, speaker_source, start_ms, end_ms, text, confidence, words_json
      ) VALUES (
        '${transcript1Id}',
        '${meetingId}',
        '${speaker1Id}',
        'Speaker 1',
        'dom_cue',
        0,
        4500,
        'test transcript segment alpha with sample search target phrase',
        0.98,
        NULL
      ), (
        '${transcript2Id}',
        '${meetingId}',
        '${speaker2Id}',
        'Speaker 2',
        'audio_embedding',
        5000,
        10200,
        'test transcript segment beta with target phrase and additional details',
        0.99,
        NULL
      );

      INSERT INTO meeting_summaries (
        id, meeting_id, executive_summary, key_decisions_json, topics_json, created_at
      ) VALUES (
        '${summaryId}',
        '${meetingId}',
        'test executive summary lorem ipsum for test meeting 1',
        '["test decision 1", "test decision 2"]',
        '["topic 1", "topic 2"]',
        NULL
      );
    `);
  });

  after(() => {
    executor.close();
    if (fs.existsSync(tmpDbPath)) {
      try {
        fs.unlinkSync(tmpDbPath);
      } catch {}
    }
  });

  it('searches transcripts across meeting 7b053bb1-29a3-4e07-bfc5-3c4e40d08033 with real SQLite', async () => {
    const res = await handleSearchTool(client, 'search_transcripts', {
      query: 'target phrase',
      meeting_id: meetingId,
    });
    assert.equal(res.count, 2);
    assert.equal(res.segments.length, 2);
    assert.equal(res.segments[0]?.speaker, 'Speaker 1');
    assert.equal(res.segments[0]?.start_ms, 0);
    assert.equal(res.segments[1]?.speaker, 'Speaker 2');
    assert.equal(res.segments[1]?.start_ms, 5000);
    assert.ok(res.segments[1]?.text.includes('target phrase'));
  });

  it('retrieves full meeting transcript and speakers for meeting 7b053bb1-29a3-4e07-bfc5-3c4e40d08033', async () => {
    const res = await handleSearchTool(client, 'get_meeting_transcript', {
      meeting_id: meetingId,
    });
    assert.equal(res.meeting_id, meetingId);
    assert.equal(res.segment_count, 2);
    assert.equal(res.speakers.length, 2);
    assert.equal(res.speakers[0]?.name, 'Speaker 1');
    assert.equal(res.speakers[1]?.name, 'Speaker 2');
  });

  it('retrieves meeting summary without failing on SQLite NULL created_at', async () => {
    const res = await handleSearchTool(client, 'get_meeting_summary', {
      meeting_id: meetingId,
    });
    assert.equal(res.found, true);
    assert.equal(res.meeting_id, meetingId);
    assert.ok(res.executive_summary.includes('test executive summary'));
    assert.equal(res.key_decisions.length, 2);
    assert.deepEqual(res.key_decisions, [
      'test decision 1',
      'test decision 2',
    ]);
  });

  it('records and updates meetings via recorder tools in SQLite', async () => {
    // 1. Start recording
    const startRes = await handleRecorderTool(client, 'start_recording', {
      title: 'test recording 2',
    });
    assert.equal(startRes.ok, true);
    assert.equal(startRes.status, 'recording');
    const newId = startRes.meeting_id;
    assert.ok(newId);

    // 2. Stop recording
    const stopRes = await handleRecorderTool(client, 'stop_recording', {
      meeting_id: newId,
    });
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.status, 'completed');

    // 3. Schedule recording
    const schedRes = await handleRecorderTool(client, 'schedule_recording', {
      title: 'test scheduled meeting 3',
      start_time: '2026-09-10T14:00:00.000Z',
      platform: 'google_meet',
      url: 'https://meet.google.com/test-link',
    });
    assert.equal(schedRes.ok, true);
    assert.equal(schedRes.status, 'scheduled');
    assert.equal(schedRes.title, 'test scheduled meeting 3');

    // 4. List meetings
    const listRes = await handleRecorderTool(client, 'list_meetings', {
      limit: 10,
    });
    assert.ok(listRes.count >= 3);
    const titles = listRes.meetings.map((m: any) => m.title);
    assert.ok(titles.includes('test meeting 1'));
    assert.ok(titles.includes('test recording 2'));
    assert.ok(titles.includes('test scheduled meeting 3'));
  });
});
