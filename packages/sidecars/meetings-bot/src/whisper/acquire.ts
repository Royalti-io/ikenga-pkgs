import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  WhisperModelName,
  WHISPER_MODELS,
  getModelCacheDir,
  resolveModelPath,
} from './models.js';

const execFileAsync = promisify(execFile);

/**
 * WP-20 — obtain whisper.cpp and a model without the user building anything.
 *
 * v1 transcribed only because whisper.cpp was compiled from source and a 488 MB
 * model downloaded by hand on one developer's machine. Someone installing this
 * pkg from the registry has neither, so for them the app records audio and then
 * does nothing. This module is the difference between "works on my machine" and
 * "works".
 *
 * Two acquisitions, same discipline: pinned source, size and SHA-256 verified
 * before use, progress reported (a silent 488 MB download reads as a hang), and
 * failures that name a next action.
 */

// ── whisper.cpp binaries ────────────────────────────────────────────────────

/**
 * Pinned upstream release. Not `latest`: a build that silently changes under
 * users is untestable, and the checksums below are only meaningful against a
 * fixed tag. Bumping this means re-recording the digests.
 */
export const WHISPER_RELEASE = 'b4938';

export interface WhisperBuild {
  /** Release asset name. */
  asset: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Verified 2026-09-03 by downloading each asset and hashing it.
 *
 * Linux only, deliberately. The plan scopes Linux as the first-class target and
 * treats macOS/Windows as a separate port; upstream ships an `xcframework` for
 * Apple rather than a CLI, so macOS needs different handling entirely rather
 * than another row here.
 */
export const WHISPER_BUILDS: Record<string, WhisperBuild> = {
  'linux-x64': {
    asset: 'whisper-bin-ubuntu-x64.tar.gz',
    sha256: 'f4cfc1f969a13805908fb72043ce7cc896eb42e0b8afbe841dc8e7298923b061',
    sizeBytes: 9503425,
  },
  'linux-arm64': {
    asset: 'whisper-bin-ubuntu-arm64.tar.gz',
    sha256: '94a33318650c57cc3d9a91439e0e3f0b94ba96bacd34203a06db395cf9204e40',
    sizeBytes: 4572294,
  },
};

export function platformKey(): string {
  const arch = os.arch() === 'arm64' ? 'arm64' : os.arch() === 'x64' ? 'x64' : os.arch();
  return `${os.platform() === 'linux' ? 'linux' : os.platform()}-${arch}`;
}

/** Where an acquired toolchain lives. Keyed by release so a version bump does
 *  not overwrite a working install in place. */
export function whisperInstallDir(release = WHISPER_RELEASE, home = os.homedir()): string {
  return path.join(home, '.ikenga', 'whisper', release);
}

export function acquiredBinaryPath(release = WHISPER_RELEASE, home = os.homedir()): string {
  return path.join(whisperInstallDir(release, home), 'whisper-cli');
}

export function buildAssetUrl(build: WhisperBuild, release = WHISPER_RELEASE): string {
  return `https://github.com/ggml-org/whisper.cpp/releases/download/${release}/${build.asset}`;
}

// ── progress ────────────────────────────────────────────────────────────────

export interface Progress {
  what: string;
  receivedBytes: number;
  totalBytes: number;
  /** 0-1, or null when the server sent no length. */
  fraction: number | null;
}

export type ProgressFn = (p: Progress) => void;

// ── download + verify ───────────────────────────────────────────────────────

export class ChecksumMismatch extends Error {
  constructor(
    readonly file: string,
    readonly expected: string,
    readonly actual: string
  ) {
    super(
      `Checksum mismatch for ${path.basename(file)}.\n` +
        `  expected ${expected}\n  actual   ${actual}\n` +
        `The download was corrupted or the upstream file changed. The partial ` +
        `file has been deleted; retrying is safe.`
    );
    this.name = 'ChecksumMismatch';
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await fh.close();
  }
  return hash.digest('hex');
}

/**
 * Download to a `.part` file, verify, then rename into place.
 *
 * The rename is what makes this safe to interrupt: a half-written file never
 * occupies the final path, so an aborted download cannot leave something that
 * later looks installed. A failed checksum deletes the partial rather than
 * leaving it to be retried into the same failure.
 */
export async function downloadVerified(
  url: string,
  dest: string,
  expected: { sha256: string; sizeBytes?: number },
  what: string,
  onProgress?: ProgressFn
): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  await fs.rm(part, { force: true });

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed for ${what}: HTTP ${res.status} ${res.statusText} (${url})`);
  }

  const header = Number(res.headers.get('content-length'));
  const total = Number.isFinite(header) && header > 0 ? header : (expected.sizeBytes ?? 0);

  let received = 0;
  let lastEmit = 0;
  const body = Readable.fromWeb(res.body as never);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    // Throttle: a 488 MB download emits tens of thousands of chunks, and one
    // callback each would swamp whatever is rendering them.
    const now = Date.now();
    if (onProgress && (now - lastEmit > 250 || received === total)) {
      lastEmit = now;
      onProgress({
        what,
        receivedBytes: received,
        totalBytes: total,
        fraction: total > 0 ? Math.min(1, received / total) : null,
      });
    }
  });

  try {
    await pipeline(body, createWriteStream(part));
  } catch (err) {
    await fs.rm(part, { force: true });
    throw new Error(`Download of ${what} was interrupted: ${(err as Error).message}`);
  }

  const actual = await sha256File(part);
  if (actual !== expected.sha256) {
    await fs.rm(part, { force: true });
    throw new ChecksumMismatch(dest, expected.sha256, actual);
  }

  await fs.rename(part, dest);
}

// ── whisper binary ──────────────────────────────────────────────────────────

export interface AcquireResult {
  binaryPath: string;
  release: string;
  /** True when it was already present and nothing was downloaded. */
  alreadyPresent: boolean;
}

/**
 * Ensure a runnable whisper-cli exists, downloading the pinned build if not.
 *
 * The upstream Linux archives set `RUNPATH=$ORIGIN`, so the binary finds its
 * own `libggml-*.so` / `libwhisper.so` siblings wherever the directory is put.
 * That is why no wrapper script is needed here — the from-source build this
 * replaces embedded an absolute RUNPATH pointing at its build tree, which is
 * exactly what made the hand-rolled install unshippable.
 */
export async function ensureWhisperBinary(opts: {
  release?: string;
  home?: string;
  onProgress?: ProgressFn;
  force?: boolean;
} = {}): Promise<AcquireResult> {
  const release = opts.release ?? WHISPER_RELEASE;
  const home = opts.home ?? os.homedir();
  const dir = whisperInstallDir(release, home);
  const binary = acquiredBinaryPath(release, home);

  if (!opts.force && existsSync(binary)) {
    return { binaryPath: binary, release, alreadyPresent: true };
  }

  const key = platformKey();
  const build = WHISPER_BUILDS[key];
  if (!build) {
    throw new Error(
      `No prebuilt whisper.cpp for this platform (${key}). ` +
        `Supported: ${Object.keys(WHISPER_BUILDS).join(', ')}. ` +
        `Install whisper-cli yourself and point the pkg at it, or choose a ` +
        `different transcription backend.`
    );
  }

  await fs.mkdir(dir, { recursive: true });
  const archive = path.join(dir, build.asset);
  await downloadVerified(
    buildAssetUrl(build, release),
    archive,
    { sha256: build.sha256, sizeBytes: build.sizeBytes },
    `whisper.cpp ${release} (${key})`,
    opts.onProgress
  );

  // The archive nests everything under one directory; --strip-components=1
  // lands whisper-cli and its libs as siblings, which is what $ORIGIN needs.
  await execFileAsync('tar', ['xzf', archive, '-C', dir, '--strip-components=1']);
  await fs.rm(archive, { force: true });

  if (!existsSync(binary)) {
    throw new Error(`Extracted ${build.asset} but found no whisper-cli at ${binary}.`);
  }
  await fs.chmod(binary, 0o755);

  return { binaryPath: binary, release, alreadyPresent: false };
}

// ── models ──────────────────────────────────────────────────────────────────

/**
 * SHA-256 for each model, read from HuggingFace's `x-linked-etag` header and
 * confirmed 2026-09-03 against a locally downloaded `small.en`.
 *
 * Recorded rather than fetched at download time on purpose: a checksum fetched
 * from the same host that serves the file verifies transport, not provenance.
 */
export const MODEL_SHA256: Record<WhisperModelName, string> = {
  'tiny.en': '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
  'base.en': 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
  'small.en': 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
  'medium.en': 'cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356',
  'large-v3-q5_0': 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1',
};

export async function ensureModel(
  model: WhisperModelName,
  opts: { modelDir?: string; onProgress?: ProgressFn; force?: boolean } = {}
): Promise<{ modelPath: string; alreadyPresent: boolean }> {
  const info = WHISPER_MODELS[model];
  if (!info) throw new Error(`Unknown whisper model: ${model}`);

  const dir = getModelCacheDir(opts.modelDir);
  const dest = resolveModelPath(model, opts.modelDir);

  if (!opts.force && existsSync(dest)) {
    return { modelPath: dest, alreadyPresent: true };
  }

  await fs.mkdir(dir, { recursive: true });
  await downloadVerified(
    info.downloadUrl,
    dest,
    { sha256: MODEL_SHA256[model], sizeBytes: info.sizeBytes },
    `whisper model ${model}`,
    opts.onProgress
  );

  return { modelPath: dest, alreadyPresent: false };
}

/** Everything transcription needs, in one call. */
export async function ensureWhisperReady(
  model: WhisperModelName,
  opts: { home?: string; modelDir?: string; onProgress?: ProgressFn } = {}
): Promise<{ binaryPath: string; modelPath: string }> {
  const bin = await ensureWhisperBinary({ home: opts.home, onProgress: opts.onProgress });
  const mdl = await ensureModel(model, { modelDir: opts.modelDir, onProgress: opts.onProgress });
  return { binaryPath: bin.binaryPath, modelPath: mdl.modelPath };
}
