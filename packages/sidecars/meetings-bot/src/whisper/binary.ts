import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';

const execFileAsync = promisify(execFile);

export interface WhisperBinaryResolution {
  available: boolean;
  path?: string;
  source?: 'custom' | 'user_bin' | 'path';
  version?: string;
  error?: string;
}

/**
 * Resolves and verifies the local whisper.cpp executable.
 */
export async function resolveWhisperBinary(
  customPath?: string
): Promise<WhisperBinaryResolution> {
  const candidates: Array<{ path: string; source: 'custom' | 'user_bin' | 'path' }> = [];

  if (customPath) {
    candidates.push({ path: customPath, source: 'custom' });
  }

  // Common user directory ~/.ikenga/bin/
  const userBin = path.join(os.homedir(), '.ikenga', 'bin', os.platform() === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
  candidates.push({ path: userBin, source: 'user_bin' });

  // System PATH names
  const binaryNames = os.platform() === 'win32' ? ['whisper-cli.exe', 'main.exe'] : ['whisper-cli', 'whisper', 'main'];
  for (const name of binaryNames) {
    candidates.push({ path: name, source: 'path' });
  }

  for (const candidate of candidates) {
    if (candidate.source !== 'path' && !existsSync(candidate.path)) {
      continue;
    }
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

  return {
    available: false,
    error:
      'whisper.cpp binary (whisper-cli) not found. Please install whisper-cli or place it in ~/.ikenga/bin/whisper-cli.',
  };
}
