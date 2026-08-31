import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCapturePreflight, checkFfmpeg, checkAudioSubsystem, checkXvfb } from './preflight.js';

describe('Capture Preflight Validation', () => {
  it('checks audio subsystem and platform details', async () => {
    const audio = await checkAudioSubsystem();
    assert.ok(typeof audio.available === 'boolean');
    assert.ok(audio.system);
  });

  it('checks ffmpeg presence with fallback handling', async () => {
    const nonExistent = await checkFfmpeg('non_existent_ffmpeg_binary_path_123');
    assert.equal(nonExistent.available, false);
  });

  it('fails preflight with actionable message when ffmpeg missing', async () => {
    const res = await runCapturePreflight({
      customFfmpegPath: 'non_existent_ffmpeg_xyz',
    });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('ffmpeg was not found on PATH')));
  });
});
