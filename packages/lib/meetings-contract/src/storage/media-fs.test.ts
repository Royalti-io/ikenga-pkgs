import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  resolveMeetingMediaDir,
  getMeetingMediaFilePaths,
  ensureMeetingMediaDir,
  deleteMeetingMediaDir,
  hasMediaFiles,
} from './media-fs.js';

describe('Meeting Media Filesystem Storage Helper', () => {
  let tmpBase: string;

  before(async () => {
    tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'ikenga-media-test-'));
  });

  after(async () => {
    if (tmpBase) {
      await fs.rm(tmpBase, { recursive: true, force: true });
    }
  });

  it('resolves meeting directory and file paths correctly', () => {
    const meetingId = '550e8400-e29b-41d4-a716-446655440000';
    const dir = resolveMeetingMediaDir(meetingId, tmpBase);
    assert.equal(dir, path.join(tmpBase, 'meetings', meetingId));

    const paths = getMeetingMediaFilePaths(meetingId, tmpBase);
    assert.equal(paths.videoPath, path.join(dir, 'video.mp4'));
    assert.equal(paths.audioPath, path.join(dir, 'audio.wav'));
  });

  it('creates directory, handles files, and deletes cleanly', async () => {
    const meetingId = '660e8400-e29b-41d4-a716-446655440001';
    const dir = await ensureMeetingMediaDir(meetingId, tmpBase);
    const paths = getMeetingMediaFilePaths(meetingId, tmpBase);

    // Initially no media files
    const checkEmpty = await hasMediaFiles(meetingId, tmpBase);
    assert.equal(checkEmpty.exists, true);
    assert.equal(checkEmpty.hasVideo, false);
    assert.equal(checkEmpty.hasAudio, false);

    // Create dummy video.mp4 and audio.wav
    await fs.writeFile(paths.videoPath, 'fake-video-content', 'utf8');
    await fs.writeFile(paths.audioPath, 'fake-audio-content', 'utf8');

    const checkFilled = await hasMediaFiles(meetingId, tmpBase);
    assert.equal(checkFilled.hasVideo, true);
    assert.equal(checkFilled.hasAudio, true);

    // Delete directory recursively
    const deleted = await deleteMeetingMediaDir(meetingId, tmpBase);
    assert.equal(deleted, true);

    const checkAfter = await hasMediaFiles(meetingId, tmpBase);
    assert.equal(checkAfter.exists, false);
  });
});
