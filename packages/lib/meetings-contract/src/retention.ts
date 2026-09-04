import { z } from 'zod';

// ==========================================
// Retention Policy Schemas
// ==========================================

export const RetentionWindowOptionSchema = z.enum([
  '30_days',
  '60_days',
  '90_days',
  '180_days',
  '365_days',
  'indefinite',
]);
export type RetentionWindowOption = z.infer<typeof RetentionWindowOptionSchema>;

export const RetentionPolicySchema = z.object({
  /** Whether automatic retention expiration is enabled. */
  enabled: z.boolean().default(true),
  /** Number of days before recordings are eligible for purge. Null means indefinite retention. */
  retention_days: z.number().int().positive().nullable().default(90),
  /** If true, purges raw media files (mp4/wav) while keeping text transcript and summary rows. */
  purge_media_only: z.boolean().default(false),
  /** User acknowledged consent to disclosure & recording requirements. */
  consent_acknowledged: z.boolean().default(false),
  /** Timestamp when consent was first acknowledged. */
  consent_acknowledged_at: z.string().datetime().optional(),
});
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  enabled: true,
  retention_days: 90,
  purge_media_only: false,
  consent_acknowledged: false,
};

// ==========================================
// Retention Utilities
// ==========================================

/**
 * Calculates the expiration Date for a given creation timestamp and retention window in days.
 */
export function calculateExpirationDate(createdAt: string | Date, retentionDays: number): Date {
  const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const expiry = new Date(created.getTime());
  expiry.setDate(expiry.getDate() + retentionDays);
  return expiry;
}

/**
 * Checks whether a meeting created at `createdAt` has expired based on `retentionDays`.
 */
export function isMeetingExpired(
  createdAt: string | Date,
  retentionDays: number | null,
  now: Date = new Date()
): boolean {
  if (retentionDays === null || retentionDays <= 0) {
    return false;
  }
  const expiry = calculateExpirationDate(createdAt, retentionDays);
  return now.getTime() >= expiry.getTime();
}

/**
 * Returns standard relative path for meeting media storage inside `~/.ikenga/media/`.
 */
export function getMeetingMediaRelativeDir(meetingId: string): string {
  return `meetings/${meetingId}`;
}

/**
 * Standard filenames inside a meeting's media directory.
 */
export const MEETING_MEDIA_FILES = {
  VIDEO: 'video.mp4',
  AUDIO: 'audio.wav',
  /** Compressed playback copy. The canonical `audio.wav` is 16 kHz mono PCM
   *  because that is whisper's native input — but it is ~115 MB/hour, and the
   *  iframe can only receive media as base64 over the MCP bridge (there is no
   *  file-read host verb and no asset URL a pkg pane can point an <audio> at).
   *  A 32 kbps mono AAC copy is ~14 MB/hour, which is the difference between a
   *  player that loads and one that cannot. */
  AUDIO_COMPRESSED: 'audio.m4a',
  /** Stereo diarization master: left = remote (system output monitor), right =
   *  local (microphone). v1 ships no speaker model — pyannote is gated and
   *  cannot live in a pkg — so two-way attribution comes from the fact that
   *  capture already opens those two sources separately before mixing them
   *  (D-15). Roughly double the mono master's size, and additive: the mono
   *  `AUDIO` remains whisper's input and `AUDIO_COMPRESSED` remains playback. */
  AUDIO_STEREO: 'audio.stereo.wav',
  METADATA: 'meta.json',
  TRANSCRIPT_RAW: 'transcript.raw.json',
} as const;
