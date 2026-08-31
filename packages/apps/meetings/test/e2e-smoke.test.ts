import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  MeetingsDbClient,
  SqlExecutor,
  Meeting,
  TranscriptSegment,
  MeetingSpeaker,
} from '@ikenga/meetings-contract';
import { summarizeMeetingTranscript } from '../src/intelligence/summarizer.js';
import { handleSearchTool } from '../../../mcp/meetings/src/tools/search.js';
import { handleRecorderTool } from '../../../mcp/meetings/src/tools/recorder.js';

class InMemorySmokeDatabase implements SqlExecutor {
  private meetings = new Map<string, Meeting>();
  private transcripts = new Map<string, TranscriptSegment[]>();
  private speakers = new Map<string, MeetingSpeaker[]>();
  private summaries = new Map<string, any>();

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (sql.includes('SELECT * FROM meetings WHERE id = ?')) {
      const found = this.meetings.get(String(params[0]));
      return (found ? [found] : []) as T[];
    }
    if (sql.includes('SELECT * FROM meetings')) {
      return Array.from(this.meetings.values()) as T[];
    }
    if (sql.includes('SELECT * FROM meeting_transcripts WHERE text LIKE ?')) {
      const rawPattern = String(params[0] ?? '').replace(/%/g, '').toLowerCase();
      const allTranscripts = Array.from(this.transcripts.values()).flat();
      return allTranscripts.filter((t) => t.text.toLowerCase().includes(rawPattern)) as T[];
    }
    if (sql.includes('SELECT * FROM meeting_transcripts WHERE meeting_id = ?')) {
      return (this.transcripts.get(String(params[0])) ?? []) as T[];
    }
    if (sql.includes('SELECT * FROM meeting_speakers WHERE meeting_id = ?')) {
      return (this.speakers.get(String(params[0])) ?? []) as T[];
    }
    if (sql.includes('SELECT * FROM meeting_summaries WHERE meeting_id = ?')) {
      const found = this.summaries.get(String(params[0]));
      return (found ? [found] : []) as T[];
    }
    return [] as T[];
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    if (sql.includes('INSERT INTO meetings')) {
      const [id, title, platform, url, status, start_time, end_time, duration_seconds, video_path, audio_path, created_at, updated_at] = params;
      this.meetings.set(String(id), {
        id: String(id),
        title: String(title),
        platform: platform as any,
        url: url as any,
        status: status as any,
        start_time: String(start_time),
        end_time: end_time as any,
        duration_seconds: Number(duration_seconds),
        video_path: video_path as any,
        audio_path: audio_path as any,
        created_at: String(created_at),
        updated_at: String(updated_at),
      });
    } else if (sql.includes('INSERT INTO meeting_transcripts')) {
      const [id, meeting_id, speaker_id, speaker_name, speaker_source, start_ms, end_ms, text, words_json, confidence] = params;
      const list = this.transcripts.get(String(meeting_id)) ?? [];
      list.push({
        id: String(id),
        meeting_id: String(meeting_id),
        speaker_id: speaker_id as any,
        speaker_name: speaker_name as any,
        speaker_source: speaker_source as any,
        start_ms: Number(start_ms),
        end_ms: Number(end_ms),
        text: String(text),
        words: words_json ? JSON.parse(String(words_json)) : undefined,
        confidence: Number(confidence),
      });
      this.transcripts.set(String(meeting_id), list);
    } else if (sql.includes('INSERT INTO meeting_speakers')) {
      const [id, meeting_id, name, avatar_url, speaker_source] = params;
      const list = this.speakers.get(String(meeting_id)) ?? [];
      list.push({
        id: String(id),
        meeting_id: String(meeting_id),
        name: String(name),
        avatar_url: avatar_url as any,
        speaker_source: speaker_source as any,
      });
      this.speakers.set(String(meeting_id), list);
    } else if (sql.includes('INSERT INTO meeting_summaries')) {
      const [id, meeting_id, executive_summary, key_decisions_json, topics_json, created_at] = params;
      this.summaries.set(String(meeting_id), {
        id: String(id),
        meeting_id: String(meeting_id),
        executive_summary: String(executive_summary),
        key_decisions: JSON.parse(String(key_decisions_json)),
        topics_json: JSON.parse(String(topics_json)),
        created_at: String(created_at),
      });
    }
  }
}

describe('End-to-End Meeting Pipeline Smoke Test', () => {
  it('records, transcribes, stores, summarizes, and queries via MCP', async () => {
    const db = new InMemorySmokeDatabase();
    const client = new MeetingsDbClient(db);

    // Step 1: Start recording via MCP / Recorder Bar
    const startRes = await handleRecorderTool(client, 'start_local_recorder', {
      title: 'Q3 Royalties & Publishing Review',
    });
    assert.equal(startRes.ok, true);
    const meetingId = startRes.meeting_id;

    const speaker1Id = crypto.randomUUID();
    const speaker2Id = crypto.randomUUID();

    // Step 2: Ingest Speaker & Transcript Segments
    await client.insertSpeaker({
      id: speaker1Id,
      meeting_id: meetingId,
      name: 'Ned Jamez',
      speaker_source: 'dom_cue',
    });
    await client.insertSpeaker({
      id: speaker2Id,
      meeting_id: meetingId,
      name: 'Legal Counsel',
      speaker_source: 'dom_cue',
    });

    const segments: TranscriptSegment[] = [
      {
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        speaker_id: speaker1Id,
        speaker_name: 'Ned Jamez',
        speaker_source: 'dom_cue',
        start_ms: 1000,
        end_ms: 4500,
        confidence: 0.98,
        text: 'We agreed on a 50-50 master publishing split for the UK release.',
      },
      {
        id: crypto.randomUUID(),
        meeting_id: meetingId,
        speaker_id: speaker2Id,
        speaker_name: 'Legal Counsel',
        speaker_source: 'dom_cue',
        start_ms: 5000,
        end_ms: 9000,
        confidence: 0.96,
        text: 'I will send the revised split sheet agreement by Friday.',
      },
    ];

    for (const seg of segments) {
      await client.insertTranscriptSegment(seg);
    }

    // Step 3: Summarize transcript & extract action items
    const analysis = summarizeMeetingTranscript(meetingId, segments);
    assert.equal(analysis.actionItems.length, 1);
    assert.equal(analysis.actionItems[0]?.assignee, 'Legal Counsel');
    assert.ok(analysis.actionItems[0]?.title.includes('revised split sheet'));

    await client.insertSummary(analysis.summary);

    // Step 4: Verify MCP search returns spoken segments and timestamps
    const searchRes = await handleSearchTool(client, 'search_transcripts', {
      query: 'publishing split',
    });
    assert.equal(searchRes.count, 1);
    assert.equal(searchRes.segments[0]?.speaker, 'Ned Jamez');
    assert.equal(searchRes.segments[0]?.start_ms, 1000);

    // Step 5: Verify MCP get_meeting_summary returns locked decisions
    const summaryRes = await handleSearchTool(client, 'get_meeting_summary', {
      meeting_id: meetingId,
    });
    assert.equal(summaryRes.found, true);
    assert.ok(summaryRes.executive_summary.includes('Publishing'));
  });
});
