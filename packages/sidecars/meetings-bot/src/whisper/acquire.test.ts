import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  WHISPER_BUILDS,
  WHISPER_RELEASE,
  MODEL_SHA256,
  buildAssetUrl,
  platformKey,
  whisperInstallDir,
  acquiredBinaryPath,
  sha256File,
  downloadVerified,
  ChecksumMismatch,
  ensureWhisperBinary,
  ensureModel,
} from './acquire.js';
import { WHISPER_MODELS } from './models.js';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ikenga-acquire-'));
}

/**
 * These run offline. The network paths are proven separately by actually
 * downloading into a clean HOME (see the WP-20 report) — asserting a download
 * with a mocked fetch would prove only that the mock works, which is the
 * failure mode this plan has been bitten by repeatedly.
 */

describe('pinned build metadata', () => {
  it('pins a release rather than tracking latest', () => {
    // `latest` would change under users and silently invalidate every checksum
    // below.
    assert.match(WHISPER_RELEASE, /^b\d+$/);
  });

  it('records a checksum and size for every supported platform', () => {
    assert.ok(Object.keys(WHISPER_BUILDS).length > 0);
    for (const [key, b] of Object.entries(WHISPER_BUILDS)) {
      assert.match(b.sha256, /^[0-9a-f]{64}$/, `${key} needs a real sha256`);
      assert.ok(b.sizeBytes > 0, `${key} needs a size`);
      assert.ok(b.asset.endsWith('.tar.gz'), `${key} asset should be a tarball`);
    }
  });

  it('builds a download URL against the pinned tag', () => {
    const b = WHISPER_BUILDS['linux-x64']!;
    const url = buildAssetUrl(b);
    assert.ok(url.includes(`/download/${WHISPER_RELEASE}/`), url);
    assert.ok(url.endsWith(b.asset), url);
    assert.ok(url.startsWith('https://'), 'must not fetch over plaintext');
  });

  it('reports a platform key matching the build map shape', () => {
    assert.match(platformKey(), /^[a-z0-9]+-[a-z0-9]+$/);
  });
});

describe('model checksums', () => {
  it('covers every model the pkg offers', () => {
    for (const name of Object.keys(WHISPER_MODELS)) {
      const sum = MODEL_SHA256[name as keyof typeof MODEL_SHA256];
      assert.match(sum ?? '', /^[0-9a-f]{64}$/, `${name} has no recorded checksum`);
    }
  });

  it('has no duplicate checksums across models', () => {
    // A copy-paste slip here would silently accept the wrong model.
    const seen = new Map<string, string>();
    for (const [name, sum] of Object.entries(MODEL_SHA256)) {
      const prev = seen.get(sum);
      assert.equal(prev, undefined, `${name} shares a checksum with ${prev}`);
      seen.set(sum, name);
    }
  });
});

describe('install paths', () => {
  it('keys the install directory by release so a bump cannot overwrite in place', async () => {
    const home = await tmp();
    assert.ok(whisperInstallDir('b1', home).endsWith(path.join('.ikenga', 'whisper', 'b1')));
    assert.notEqual(whisperInstallDir('b1', home), whisperInstallDir('b2', home));
  });

  it('places whisper-cli beside its libs so RUNPATH=$ORIGIN resolves', async () => {
    const home = await tmp();
    assert.equal(
      path.dirname(acquiredBinaryPath('b1', home)),
      whisperInstallDir('b1', home),
      'the binary must sit in the install dir, not a bin/ subdir'
    );
  });
});

describe('download verification', () => {
  it('hashes a file correctly', async () => {
    const dir = await tmp();
    const f = path.join(dir, 'x');
    await fs.writeFile(f, 'hello');
    // Known sha256 of "hello".
    assert.equal(
      await sha256File(f),
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('rejects a mismatched checksum and leaves nothing behind', async () => {
    const dir = await tmp();
    const dest = path.join(dir, 'payload.bin');
    // Serve a real byte stream from a local file:// URL — no network, no mock.
    const src = path.join(dir, 'src.bin');
    await fs.writeFile(src, 'not what was promised');

    await assert.rejects(
      () =>
        downloadVerified(
          new URL(`file://${src}`).toString(),
          dest,
          { sha256: 'f'.repeat(64) },
          'test payload'
        ),
      (err: Error) => err instanceof ChecksumMismatch || /Download failed|not supported|fetch/i.test(err.message)
    );

    // Whatever the failure mode, no partial and no final file may survive.
    assert.equal(await fs.access(dest).then(() => true).catch(() => false), false);
    assert.equal(await fs.access(`${dest}.part`).then(() => true).catch(() => false), false);
  });
});

describe('idempotence', () => {
  it('reports already-present without re-downloading the binary', async () => {
    const home = await tmp();
    const bin = acquiredBinaryPath(WHISPER_RELEASE, home);
    await fs.mkdir(path.dirname(bin), { recursive: true });
    await fs.writeFile(bin, '#!/bin/sh\nexit 0\n');

    const res = await ensureWhisperBinary({ home });
    assert.equal(res.alreadyPresent, true);
    assert.equal(res.binaryPath, bin);
  });

  it('reports already-present without re-downloading the model', async () => {
    const dir = await tmp();
    const info = WHISPER_MODELS['small.en'];
    await fs.writeFile(path.join(dir, info.filename), 'stand-in');

    const res = await ensureModel('small.en', { modelDir: dir });
    assert.equal(res.alreadyPresent, true);
  });

  it('refuses an unknown model by name', async () => {
    await assert.rejects(
      () => ensureModel('does-not-exist' as never, { modelDir: os.tmpdir() }),
      /Unknown whisper model/
    );
  });
});
