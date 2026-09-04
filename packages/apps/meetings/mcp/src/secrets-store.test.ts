import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// `IKENGA_MEETINGS_STT_STORE_DIR` must be set BEFORE this module is imported
// so its lazily-evaluated `storeDir()` picks up the tmpdir on every call —
// see the "test seam only" note in secrets-store.ts. This test never touches
// this machine's real `~/.ikenga`.
let tmpDir: string;

describe('mcp/src/secrets-store (WP-19)', () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meetings-secrets-store-test-'));
    process.env.IKENGA_MEETINGS_STT_STORE_DIR = tmpDir;
  });

  after(async () => {
    delete process.env.IKENGA_MEETINGS_STT_STORE_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    delete process.env.OPENAI_API_KEY;
    await fs.rm(path.join(tmpDir, 'config.json'), { force: true }).catch(() => {});
  });

  it('reports no key configured initially', async () => {
    const { hasOpenAiKey, getOpenAiKey } = await import('./secrets-store.js');
    assert.equal(await hasOpenAiKey(), false);
    assert.equal(await getOpenAiKey(), undefined);
  });

  it('persists a key to a 0600 file under the store dir, then reads it back', async () => {
    const { setOpenAiKey, getOpenAiKey, hasOpenAiKey } = await import('./secrets-store.js');
    await setOpenAiKey('sk-persisted-test-key');

    assert.equal(await hasOpenAiKey(), true);
    assert.equal(await getOpenAiKey(), 'sk-persisted-test-key');

    const filePath = path.join(tmpDir, 'config.json');
    const stat = await fs.stat(filePath);
    // Mode bits: owner rw only.
    assert.equal(stat.mode & 0o777, 0o600);

    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(onDisk.openai_api_key, 'sk-persisted-test-key');
  });

  it('rejects an empty key', async () => {
    const { setOpenAiKey } = await import('./secrets-store.js');
    await assert.rejects(() => setOpenAiKey('   '), /cannot be empty/);
  });

  it('clears a stored key', async () => {
    const { setOpenAiKey, clearOpenAiKey, hasOpenAiKey } = await import('./secrets-store.js');
    await setOpenAiKey('sk-to-be-cleared');
    assert.equal(await hasOpenAiKey(), true);
    await clearOpenAiKey();
    assert.equal(await hasOpenAiKey(), false);
  });

  it('prefers OPENAI_API_KEY from the environment over the stored value', async () => {
    const { setOpenAiKey, getOpenAiKey } = await import('./secrets-store.js');
    await setOpenAiKey('sk-from-disk');
    process.env.OPENAI_API_KEY = 'sk-from-env-wins';
    assert.equal(await getOpenAiKey(), 'sk-from-env-wins');
  });
});
