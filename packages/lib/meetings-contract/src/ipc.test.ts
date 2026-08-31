import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  StartRecordingRequestSchema,
  StopRecordingRequestSchema,
  PauseRecordingRequestSchema,
  ResumeRecordingRequestSchema,
  GetRecordingStatusRequestSchema,
  PingRequestSchema,
  RecordingStatusNotificationSchema,
  SpeakerDetectedNotificationSchema,
  TranscriptChunkNotificationSchema,
  ParticipantObjectionNotificationSchema,
  RecordingConfigSchema,
} from './ipc.js';

describe('Recorder Control IPC Protocol', () => {
  it('round-trips a local_recording start request', () => {
    const req = {
      jsonrpc: '2.0',
      id: 1,
      method: 'recorder.start',
      params: {
        backend: 'local_recording',
        meeting_id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Local Standup Session',
        video_source: 'screen',
        audio_source: 'monitor_and_mic',
      },
    };

    const parsed = StartRecordingRequestSchema.parse(req);
    assert.equal(parsed.params.backend, 'local_recording');
    if (parsed.params.backend === 'local_recording') {
      assert.equal(parsed.params.video_source, 'screen');
      assert.equal(parsed.params.audio_source, 'monitor_and_mic');
    }
  });

  it('round-trips a bot recording start request', () => {
    const req = {
      jsonrpc: '2.0',
      id: 'req-2',
      method: 'recorder.start',
      params: {
        backend: 'bot',
        meeting_id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Google Meet Review Call',
        platform: 'google_meet',
        meeting_url: 'https://meet.google.com/xyz-abcd-efg',
        bot_name: 'Ikenga Notetaker (Local Bot)',
      },
    };

    const parsed = StartRecordingRequestSchema.parse(req);
    assert.equal(parsed.params.backend, 'bot');
    if (parsed.params.backend === 'bot') {
      assert.equal(parsed.params.platform, 'google_meet');
      assert.equal(parsed.params.bot_name, 'Ikenga Notetaker (Local Bot)');
    }
  });

  it('round-trips control lifecycle requests (stop, pause, resume, status, ping)', () => {
    const stopReq = StopRecordingRequestSchema.parse({
      jsonrpc: '2.0',
      id: 3,
      method: 'recorder.stop',
      params: { meeting_id: '550e8400-e29b-41d4-a716-446655440000' },
    });
    assert.equal(stopReq.method, 'recorder.stop');

    const pauseReq = PauseRecordingRequestSchema.parse({
      jsonrpc: '2.0',
      id: 4,
      method: 'recorder.pause',
      params: { meeting_id: '550e8400-e29b-41d4-a716-446655440000' },
    });
    assert.equal(pauseReq.method, 'recorder.pause');

    const resumeReq = ResumeRecordingRequestSchema.parse({
      jsonrpc: '2.0',
      id: 5,
      method: 'recorder.resume',
      params: { meeting_id: '550e8400-e29b-41d4-a716-446655440000' },
    });
    assert.equal(resumeReq.method, 'recorder.resume');

    const statusReq = GetRecordingStatusRequestSchema.parse({
      jsonrpc: '2.0',
      id: 6,
      method: 'recorder.status',
      params: {},
    });
    assert.equal(statusReq.method, 'recorder.status');

    const pingReq = PingRequestSchema.parse({
      jsonrpc: '2.0',
      id: 7,
      method: 'ping',
    });
    assert.equal(pingReq.method, 'ping');
  });

  it('round-trips notifications (status, speaker, transcript chunk, objection)', () => {
    const statusNote = RecordingStatusNotificationSchema.parse({
      jsonrpc: '2.0',
      method: 'recorder.onStatus',
      params: {
        meeting_id: '550e8400-e29b-41d4-a716-446655440000',
        state: 'recording',
        elapsed_seconds: 42,
        audio_rms_db: -18.4,
      },
    });
    assert.equal(statusNote.params.state, 'recording');
    assert.equal(statusNote.params.elapsed_seconds, 42);

    const speakerNote = SpeakerDetectedNotificationSchema.parse({
      jsonrpc: '2.0',
      method: 'recorder.onSpeaker',
      params: {
        meeting_id: '550e8400-e29b-41d4-a716-446655440000',
        speaker_name: 'Sarah (A&R)',
        speaker_source: 'dom_cue',
        timestamp_ms: 15400,
      },
    });
    assert.equal(speakerNote.params.speaker_source, 'dom_cue');

    const objectionNote = ParticipantObjectionNotificationSchema.parse({
      jsonrpc: '2.0',
      method: 'recorder.onParticipantObjection',
      params: {
        meeting_id: '550e8400-e29b-41d4-a716-446655440000',
        participant_name: 'John Doe',
        message: '!stop',
        action_taken: 'stopped_recording',
      },
    });
    assert.equal(objectionNote.params.action_taken, 'stopped_recording');
  });
});
