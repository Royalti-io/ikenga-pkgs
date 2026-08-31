import { z } from 'zod';

// ==========================================
// Enums & Primitive Schemas
// ==========================================

export const MeetingPlatformSchema = z.enum([
  'google_meet',
  'zoom',
  'microsoft_teams',
  'local_recording',
  'other',
]);
export type MeetingPlatform = z.infer<typeof MeetingPlatformSchema>;

export const MeetingStatusSchema = z.enum([
  'scheduled',
  'joining',
  'recording',
  'transcribing',
  'completed',
  'failed',
]);
export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;

/**
 * Speaker attribution source discriminator:
 * - 'dom_cue': Detected from meeting DOM visual cues (active speaker box/aria labels).
 * - 'audio_embedding': Extracted via voice cluster/audio embedding diarization.
 * - 'manual': Explicitly labeled or renamed by user in the UI.
 */
export const SpeakerSourceSchema = z.enum([
  'dom_cue',
  'audio_embedding',
  'manual',
]);
export type SpeakerSource = z.infer<typeof SpeakerSourceSchema>;

export const MeetingActionItemStatusSchema = z.enum([
  'pending',
  'synced_to_tasks',
  'completed',
]);
export type MeetingActionItemStatus = z.infer<typeof MeetingActionItemStatusSchema>;

// ==========================================
// Word & Transcript Schemas
// ==========================================

export const WordTimestampSchema = z.object({
  word: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1).default(1.0),
});
export type WordTimestamp = z.infer<typeof WordTimestampSchema>;

export const TranscriptSegmentSchema = z.object({
  id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  speaker_id: z.string().optional(),
  speaker_name: z.string().optional(),
  speaker_source: SpeakerSourceSchema.optional(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  text: z.string(),
  confidence: z.number().min(0).max(1).default(1.0),
  words: z.array(WordTimestampSchema).optional(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

// ==========================================
// Speaker & Summary Schemas
// ==========================================

export const MeetingSpeakerSchema = z.object({
  id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  name: z.string(),
  avatar_url: z.string().optional(),
  contact_id: z.string().optional(),
  speaker_source: SpeakerSourceSchema.default('dom_cue'),
});
export type MeetingSpeaker = z.infer<typeof MeetingSpeakerSchema>;

export const MeetingActionItemSchema = z.object({
  id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  title: z.string(),
  assignee: z.string().optional(),
  due_date: z.string().optional(),
  status: MeetingActionItemStatusSchema.default('pending'),
  task_id: z.string().optional(),
});
export type MeetingActionItem = z.infer<typeof MeetingActionItemSchema>;

export const MeetingSummarySchema = z.object({
  id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  executive_summary: z.string(),
  key_decisions: z.array(z.string()).default([]),
  topics_json: z.array(z.string()).default([]),
  created_at: z.string().datetime().optional(),
});
export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;

// ==========================================
// Main Meeting Schema
// ==========================================

export const MeetingSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  platform: MeetingPlatformSchema,
  url: z.string().url().optional(),
  status: MeetingStatusSchema,
  start_time: z.string().datetime(),
  end_time: z.string().datetime().optional(),
  duration_seconds: z.number().int().nonnegative().default(0),
  video_path: z.string().optional(),
  audio_path: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Meeting = z.infer<typeof MeetingSchema>;
