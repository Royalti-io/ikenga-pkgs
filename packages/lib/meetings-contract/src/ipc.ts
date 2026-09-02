import { z } from 'zod';
import {
  MeetingPlatformSchema,
  SpeakerSourceSchema,
  TranscriptSegmentSchema,
} from './schema.js';

export const IKENGA_MEETINGS_IPC_VERSION = 1 as const;

// ==========================================
// Capture Configs (Discriminated Union)
// ==========================================

export const LocalRecordingConfigSchema = z.object({
  backend: z.literal('local_recording'),
  meeting_id: z.string().uuid(),
  title: z.string(),
  video_source: z.enum(['screen', 'window']).default('screen'),
  audio_source: z.enum(['default', 'monitor_and_mic', 'mic_only']).default('monitor_and_mic'),
  output_dir: z.string().optional(),
});
export type LocalRecordingConfig = z.infer<typeof LocalRecordingConfigSchema>;

export const BotRecordingConfigSchema = z.object({
  backend: z.literal('bot'),
  meeting_id: z.string().uuid(),
  title: z.string(),
  platform: MeetingPlatformSchema,
  meeting_url: z.string().url(),
  bot_name: z.string().default('Ikenga Notetaker (Local Bot)'),
  passcode: z.string().optional(),
  output_dir: z.string().optional(),
});
export type BotRecordingConfig = z.infer<typeof BotRecordingConfigSchema>;

export const RecordingConfigSchema = z.discriminatedUnion('backend', [
  LocalRecordingConfigSchema,
  BotRecordingConfigSchema,
]);
export type RecordingConfig = z.infer<typeof RecordingConfigSchema>;

// ==========================================
// Recorder States
// ==========================================

export const RecorderStateSchema = z.enum([
  'idle',
  'starting',
  'recording',
  'paused',
  'stopping',
  'stopped',
  'failed',
]);
export type RecorderState = z.infer<typeof RecorderStateSchema>;

// ==========================================
// JSON-RPC Request / Method Schemas
// ==========================================

export const JsonRpcIdSchema = z.union([z.string(), z.number()]);

export const StartRecordingRequestSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  id: JsonRpcIdSchema,
  method: z.literal('recorder.start'),
  params: RecordingConfigSchema,
});
export type StartRecordingRequest = z.infer<typeof StartRecordingRequestSchema>;

export const StopRecordingRequestSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  id: JsonRpcIdSchema,
  method: z.literal('recorder.stop'),
  params: z.object({
    meeting_id: z.string().uuid(),
  }),
});
export type StopRecordingRequest = z.infer<typeof StopRecordingRequestSchema>;

export const PauseRecordingRequestSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  id: JsonRpcIdSchema,
  method: z.literal('recorder.pause'),
  params: z.object({
    meeting_id: z.string().uuid(),
  }),
});
export type PauseRecordingRequest = z.infer<typeof PauseRecordingRequestSchema>;

export const ResumeRecordingRequestSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  id: JsonRpcIdSchema,
  method: z.literal('recorder.resume'),
  params: z.object({
    meeting_id: z.string().uuid(),
  }),
});
export type ResumeRecordingRequest = z.infer<typeof ResumeRecordingRequestSchema>;

export const GetRecordingStatusRequestSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  id: JsonRpcIdSchema,
  method: z.literal('recorder.status'),
  params: z.object({
    meeting_id: z.string().uuid().optional(),
  }).default({}),
});
export type GetRecordingStatusRequest = z.infer<typeof GetRecordingStatusRequestSchema>;

export const PingRequestSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  id: JsonRpcIdSchema,
  method: z.literal('ping'),
  params: z.record(z.unknown()).optional(),
});
export type PingRequest = z.infer<typeof PingRequestSchema>;

export const RecorderControlRequestSchema = z.discriminatedUnion('method', [
  StartRecordingRequestSchema,
  StopRecordingRequestSchema,
  PauseRecordingRequestSchema,
  ResumeRecordingRequestSchema,
  GetRecordingStatusRequestSchema,
  PingRequestSchema,
]);
export type RecorderControlRequest = z.infer<typeof RecorderControlRequestSchema>;

// ==========================================
// Notifications & Events
// ==========================================

export const RecordingStatusNotificationSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  method: z.literal('recorder.onStatus'),
  params: z.object({
    meeting_id: z.string().uuid(),
    state: RecorderStateSchema,
    elapsed_seconds: z.number().int().nonnegative(),
    audio_rms_db: z.number().optional(),
    video_path: z.string().optional(),
    audio_path: z.string().optional(),
    error: z.string().optional(),
  }),
});
export type RecordingStatusNotification = z.infer<typeof RecordingStatusNotificationSchema>;

export const SpeakerDetectedNotificationSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  method: z.literal('recorder.onSpeaker'),
  params: z.object({
    meeting_id: z.string().uuid(),
    speaker_name: z.string(),
    speaker_source: SpeakerSourceSchema,
    timestamp_ms: z.number().int().nonnegative(),
  }),
});
export type SpeakerDetectedNotification = z.infer<typeof SpeakerDetectedNotificationSchema>;

export const TranscriptChunkNotificationSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  method: z.literal('recorder.onTranscriptChunk'),
  params: TranscriptSegmentSchema,
});
export type TranscriptChunkNotification = z.infer<typeof TranscriptChunkNotificationSchema>;

export const ParticipantObjectionNotificationSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  method: z.literal('recorder.onParticipantObjection'),
  params: z.object({
    meeting_id: z.string().uuid(),
    participant_name: z.string().optional(),
    message: z.string(),
    action_taken: z.enum(['stopped_recording', 'left_call']),
  }),
});
export type ParticipantObjectionNotification = z.infer<typeof ParticipantObjectionNotificationSchema>;

export const RecorderNotificationSchema = z.discriminatedUnion('method', [
  RecordingStatusNotificationSchema,
  SpeakerDetectedNotificationSchema,
  TranscriptChunkNotificationSchema,
  ParticipantObjectionNotificationSchema,
]);
export type RecorderNotification = z.infer<typeof RecorderNotificationSchema>;
