import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WHISPER_MODELS, resolveModelPath, isModelDownloaded } from './models.js';

describe('Whisper Models Management', () => {
  it('defines valid model configs for all supported models', () => {
    const models = Object.keys(WHISPER_MODELS);
    assert.ok(models.includes('tiny.en'));
    assert.ok(models.includes('small.en'));
    assert.ok(models.includes('medium.en'));
    assert.ok(models.includes('large-v3-q5_0'));

    for (const m of models) {
      const info = WHISPER_MODELS[m as keyof typeof WHISPER_MODELS];
      assert.ok(info.filename.endsWith('.bin'));
      assert.ok(info.downloadUrl.startsWith('https://'));
      assert.ok(info.sizeBytes > 10_000_000);
    }
  });

  it('resolves model path and checks downloaded status', async () => {
    const p = resolveModelPath('small.en', '/custom/models');
    assert.ok(p.includes('ggml-small.en.bin'));

    const downloaded = await isModelDownloaded('small.en', '/non_existent_folder_xyz');
    assert.equal(downloaded, false);
  });
});
