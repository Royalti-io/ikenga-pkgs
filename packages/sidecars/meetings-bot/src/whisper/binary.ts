import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { acquiredBinaryPath } from './acquire.js';

const execFileAsync = promisify(execFile);

export interface WhisperBinaryResolution {
  available: boolean;
  path?: string;
  source?: 'custom' | 'acquired' | 'user_bin' | 'path';
  version?: string;
  error?: string;
}

/**
 * Resolves and verifies the local whisper.cpp executable.
 */
export async function resolveWhisperBinary(
  customPath?: string
): Promise<WhisperBinaryResolution> {
  const candidates: Array<{ path: string; source: 'custom' | 'acquired' | 'user_bin' | 'path' }> = [];

  // An EXPLICIT path is exclusive, never the head of a fallback chain.
  //
  // Falling through to some other whisper build when the configured one is
  // missing silently ignores the user's choice — they end up transcribing with
  // a different model/binary than they asked for, and the error message they'd
  // otherwise get ("not found at <path>") never appears. Worse, it makes the
  // "is whisper installed" probe unfalsifiable: any bogus path still resolves.
  if (customPath) {
    return resolveSingleCandidate({ path: customPath, source: 'custom' });
  }

  // An acquired toolchain (WP-20) — `~/.ikenga/whisper/<release>/whisper-cli`.
  // Checked before the hand-placed locations below because it is the one this
  // pkg can verify, having downloaded it against a pinned checksum itself.
  candidates.push({ path: acquiredBinaryPath(), source: 'acquired' });

  // Common user directory ~/.ikenga/bin/
  const userBin = path.join(os.homedir(), '.ikenga', 'bin', os.platform() === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
  candidates.push({ path: userBin, source: 'user_bin' });

  // System PATH names
  const binaryNames = os.platform() === 'win32' ? ['whisper-cli.exe', 'main.exe'] : ['whisper-cli', 'whisper', 'main'];
  for (const name of binaryNames) {
    candidates.push({ path: name, source: 'path' });
  }

  for (const candidate of candidates) {
    const resolved = await resolveSingleCandidate(candidate);
    if (resolved.available) return resolved;
  }

  return {
    available: false,
    error:
      'whisper.cpp binary (whisper-cli) not found. Please install whisper-cli or place it in ~/.ikenga/bin/whisper-cli.',
  };
}

/** Probe exactly one candidate path; never falls back to another. */
async function resolveSingleCandidate(candidate: {
  path: string;
  source: 'custom' | 'acquired' | 'user_bin' | 'path';
}): Promise<WhisperBinaryResolution> {
  const notFound: WhisperBinaryResolution = {
    available: false,
    error:
      candidate.source === 'custom'
        ? `whisper.cpp binary (whisper-cli) not found at the configured path ${candidate.path}.`
        : 'whisper.cpp binary (whisper-cli) not found. Please install whisper-cli or place it in ~/.ikenga/bin/whisper-cli.',
  };

  if (candidate.source !== 'path' && !existsSync(candidate.path)) {
    return notFound;
  }

  {
    try {
      const { stdout, stderr } = await execFileAsync(candidate.path, ['-h']);
      const output = stdout || stderr;
      if (output.includes('usage:') || output.includes('whisper') || output.includes('-m')) {
        return {
          available: true,
          path: candidate.path,
          source: candidate.source,
          version: 'whisper.cpp',
        };
      }
    } catch (err: any) {
      // In whisper.cpp, -h often returns 0 or 1 with usage
      if (err?.stdout?.includes('usage:') || err?.stderr?.includes('usage:')) {
        return {
          available: true,
          path: candidate.path,
          source: candidate.source,
          version: 'whisper.cpp',
        };
      }
    }
  }

  return notFound;
}
