import {
  Meeting,
  MeetingActionItem,
  MeetingActionItemStatus,
  MeetingSpeaker,
  MeetingStatus,
  MeetingSummary,
  TranscriptSegment,
  MeetingSchema,
  MeetingSpeakerSchema,
  TranscriptSegmentSchema,
  MeetingActionItemSchema,
  MeetingSummarySchema,
} from '../schema.js';

export interface SqlExecutor {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string, params?: unknown[]): Promise<void | unknown>;
}

export class MeetingsDbClient {
  constructor(private readonly executor: SqlExecutor) {}

  // ==========================================
  // Meetings
  // ==========================================

  async listMeetings(options?: {
    status?: MeetingStatus;
    limit?: number;
    offset?: number;
  }): Promise<Meeting[]> {
    let sql = 'SELECT * FROM meetings';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options?.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      if (options?.offset) {
        sql += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    const rows = await this.executor.query<Record<string, unknown>>(sql, params);
    return rows.map((row) => MeetingSchema.parse(row));
  }

  async getMeetingById(id: string): Promise<Meeting | null> {
    const rows = await this.executor.query<Record<string, unknown>>(
      'SELECT * FROM meetings WHERE id = ? LIMIT 1',
      [id]
    );
    if (!rows || rows.length === 0 || !rows[0]) {
      return null;
    }
    return MeetingSchema.parse(rows[0]);
  }

  async insertMeeting(meeting: Meeting): Promise<void> {
    const validated = MeetingSchema.parse(meeting);
    await this.executor.exec(
      `INSERT INTO meetings (
        id, title, platform, url, status, start_time, end_time,
        duration_seconds, video_path, audio_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        validated.id,
        validated.title,
        validated.platform,
        validated.url ?? null,
        validated.status,
        validated.start_time,
        validated.end_time ?? null,
        validated.duration_seconds,
        validated.video_path ?? null,
        validated.audio_path ?? null,
        validated.created_at,
        validated.updated_at,
      ]
    );
  }

  async updateMeetingStatus(
    id: string,
    status: MeetingStatus,
    extra?: {
      duration_seconds?: number;
      end_time?: string;
      video_path?: string;
      audio_path?: string;
    }
  ): Promise<void> {
    const sets: string[] = ['status = ?', 'updated_at = ?'];
    const now = new Date().toISOString();
    const params: unknown[] = [status, now];

    if (extra?.duration_seconds !== undefined) {
      sets.push('duration_seconds = ?');
      params.push(extra.duration_seconds);
    }
    if (extra?.end_time !== undefined) {
      sets.push('end_time = ?');
      params.push(extra.end_time);
    }
    if (extra?.video_path !== undefined) {
      sets.push('video_path = ?');
      params.push(extra.video_path);
    }
    if (extra?.audio_path !== undefined) {
      sets.push('audio_path = ?');
      params.push(extra.audio_path);
    }

    params.push(id);
    await this.executor.exec(
      `UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
  }

  // ==========================================
  // Speakers
  // ==========================================

  async insertSpeaker(speaker: MeetingSpeaker): Promise<void> {
    const validated = MeetingSpeakerSchema.parse(speaker);
    await this.executor.exec(
      `INSERT INTO meeting_speakers (
        id, meeting_id, name, avatar_url, contact_id, speaker_source
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        validated.id,
        validated.meeting_id,
        validated.name,
        validated.avatar_url ?? null,
        validated.contact_id ?? null,
        validated.speaker_source,
      ]
    );
  }

  async listSpeakers(meetingId: string): Promise<MeetingSpeaker[]> {
    const rows = await this.executor.query<Record<string, unknown>>(
      'SELECT * FROM meeting_speakers WHERE meeting_id = ?',
      [meetingId]
    );
    return rows.map((r) => MeetingSpeakerSchema.parse(r));
  }

  // ==========================================
  // Transcripts
  // ==========================================

  async insertTranscriptSegment(segment: TranscriptSegment): Promise<void> {
    const validated = TranscriptSegmentSchema.parse(segment);
    const wordsJson = validated.words ? JSON.stringify(validated.words) : null;
    await this.executor.exec(
      `INSERT INTO meeting_transcripts (
        id, meeting_id, speaker_id, speaker_name, speaker_source,
        start_ms, end_ms, text, confidence, words_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        validated.id,
        validated.meeting_id,
        validated.speaker_id ?? null,
        validated.speaker_name ?? null,
        validated.speaker_source ?? null,
        validated.start_ms,
        validated.end_ms,
        validated.text,
        validated.confidence,
        wordsJson,
      ]
    );
  }

  async listTranscriptSegments(meetingId: string): Promise<TranscriptSegment[]> {
    const rows = await this.executor.query<Record<string, unknown>>(
      'SELECT * FROM meeting_transcripts WHERE meeting_id = ? ORDER BY start_ms ASC',
      [meetingId]
    );
    return rows.map((r) => {
      let words = undefined;
      if (typeof r.words_json === 'string') {
        try {
          words = JSON.parse(r.words_json);
        } catch {
          words = undefined;
        }
      }
      return TranscriptSegmentSchema.parse({
        ...r,
        words,
      });
    });
  }

  async searchTranscripts(query: string, meetingId?: string): Promise<TranscriptSegment[]> {
    let sql = 'SELECT * FROM meeting_transcripts WHERE text LIKE ?';
    const params: unknown[] = [`%${query}%`];
    if (meetingId) {
      sql += ' AND meeting_id = ?';
      params.push(meetingId);
    }
    sql += ' ORDER BY start_ms ASC LIMIT 50';

    const rows = await this.executor.query<Record<string, unknown>>(sql, params);
    return rows.map((r) => {
      let words = undefined;
      if (typeof r.words_json === 'string') {
        try {
          words = JSON.parse(r.words_json);
        } catch {
          words = undefined;
        }
      }
      return TranscriptSegmentSchema.parse({
        ...r,
        words,
      });
    });
  }

  // ==========================================
  // Action Items
  // ==========================================

  async insertActionItem(item: MeetingActionItem): Promise<void> {
    const validated = MeetingActionItemSchema.parse(item);
    await this.executor.exec(
      `INSERT INTO meeting_action_items (
        id, meeting_id, title, assignee, due_date, status, task_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        validated.id,
        validated.meeting_id,
        validated.title,
        validated.assignee ?? null,
        validated.due_date ?? null,
        validated.status,
        validated.task_id ?? null,
      ]
    );
  }

  async listActionItems(meetingId: string): Promise<MeetingActionItem[]> {
    const rows = await this.executor.query<Record<string, unknown>>(
      'SELECT * FROM meeting_action_items WHERE meeting_id = ?',
      [meetingId]
    );
    return rows.map((r) => MeetingActionItemSchema.parse(r));
  }

  async updateActionItemStatus(
    id: string,
    status: MeetingActionItemStatus,
    taskId?: string
  ): Promise<void> {
    const sets = ['status = ?'];
    const params: unknown[] = [status];
    if (taskId !== undefined) {
      sets.push('task_id = ?');
      params.push(taskId);
    }
    params.push(id);
    await this.executor.exec(
      `UPDATE meeting_action_items SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
  }

  // ==========================================
  // Summaries
  // ==========================================

  async insertSummary(summary: MeetingSummary): Promise<void> {
    const validated = MeetingSummarySchema.parse(summary);
    const keyDecisionsJson = JSON.stringify(validated.key_decisions);
    const topicsJson = JSON.stringify(validated.topics_json);
    await this.executor.exec(
      `INSERT INTO meeting_summaries (
        id, meeting_id, executive_summary, key_decisions_json, topics_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        validated.id,
        validated.meeting_id,
        validated.executive_summary,
        keyDecisionsJson,
        topicsJson,
        validated.created_at ?? new Date().toISOString(),
      ]
    );
  }

  async getSummary(meetingId: string): Promise<MeetingSummary | null> {
    const rows = await this.executor.query<Record<string, unknown>>(
      'SELECT * FROM meeting_summaries WHERE meeting_id = ? LIMIT 1',
      [meetingId]
    );
    if (!rows || rows.length === 0 || !rows[0]) {
      return null;
    }
    const r = rows[0];
    let key_decisions = [];
    let topics_json = [];
    if (typeof r.key_decisions_json === 'string') {
      try {
        key_decisions = JSON.parse(r.key_decisions_json);
      } catch {
        key_decisions = [];
      }
    }
    if (typeof r.topics_json === 'string') {
      try {
        topics_json = JSON.parse(r.topics_json);
      } catch {
        topics_json = [];
      }
    }

    return MeetingSummarySchema.parse({
      id: r.id,
      meeting_id: r.meeting_id,
      executive_summary: r.executive_summary,
      key_decisions,
      topics_json,
      created_at: r.created_at,
    });
  }

  // ==========================================
  // Cascading Deletion (Guaranteed Delete Path)
  // ==========================================

  async deleteMeetingCascade(id: string): Promise<void> {
    await this.executor.exec('DELETE FROM meeting_transcripts WHERE meeting_id = ?', [id]);
    await this.executor.exec('DELETE FROM meeting_speakers WHERE meeting_id = ?', [id]);
    await this.executor.exec('DELETE FROM meeting_action_items WHERE meeting_id = ?', [id]);
    await this.executor.exec('DELETE FROM meeting_summaries WHERE meeting_id = ?', [id]);
    await this.executor.exec('DELETE FROM meetings WHERE id = ?', [id]);
  }
}
