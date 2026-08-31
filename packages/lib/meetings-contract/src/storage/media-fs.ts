import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MEETING_MEDIA_FILES } from '../retention.js';

/**
 * Resolves the default base media directory: `~/.ikenga/media`
 */
export function getDefaultMediaBaseDir(): string {
  return path.join(os.homedir(), '.ikenga', 'media');
}

/**
 * Resolves the full path to a specific meeting's media directory.
 */
export function resolveMeetingMediaDir(meetingId: string, customBaseDir?: string): string {
  const base = customBaseDir ?? getDefaultMediaBaseDir();
  return path.join(base, 'meetings', meetingId);
}

export interface MeetingMediaPaths {
  dir: string;
  videoPath: string;
  audioPath: string;
  metaPath: string;
  transcriptRawPath: string;
}

/**
 * Returns structured file paths for all media assets belonging to a meeting.
 */
export function getMeetingMediaFilePaths(
  meetingId: string,
  customBaseDir?: string
): MeetingMediaPaths {
  const dir = resolveMeetingMediaDir(meetingId, customBaseDir);
  return {
    dir,
    videoPath: path.join(dir, MEETING_MEDIA_FILES.VIDEO),
    audioPath: path.join(dir, MEETING_MEDIA_FILES.AUDIO),
    metaPath: path.join(dir, MEETING_MEDIA_FILES.METADATA),
    transcriptRawPath: path.join(dir, MEETING_MEDIA_FILES.TRANSCRIPT_RAW),
  };
}

/**
 * Ensures that the meeting's media directory exists on disk, creating parent folders if needed.
 */
export async function ensureMeetingMediaDir(
  meetingId: string,
  customBaseDir?: string
): Promise<string> {
  const dir = resolveMeetingMediaDir(meetingId, customBaseDir);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Deletes a meeting's media directory and all contained files recursively.
 * Returns true if directory existed and was deleted, false if it did not exist.
 */
export async function deleteMeetingMediaDir(
  meetingId: string,
  customBaseDir?: string
): Promise<boolean> {
  const dir = resolveMeetingMediaDir(meetingId, customBaseDir);
  if (!existsSync(dir)) {
    return false;
  }
  await fs.rm(dir, { recursive: true, force: true });
  return true;
}

/**
 * Checks which media files exist for a given meeting.
 */
export async function hasMediaFiles(
  meetingId: string,
  customBaseDir?: string
): Promise<{ exists: boolean; hasVideo: boolean; hasAudio: boolean }> {
  const paths = getMeetingMediaFilePaths(meetingId, customBaseDir);
  const exists = existsSync(paths.dir);
  if (!exists) {
    return { exists: false, hasVideo: false, hasAudio: false };
  }
  return {
    exists: true,
    hasVideo: existsSync(paths.videoPath),
    hasAudio: existsSync(paths.audioPath),
  };
}
