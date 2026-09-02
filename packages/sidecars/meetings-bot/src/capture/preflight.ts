import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);

export interface PreflightCheckResult {
  ok: boolean;
  ffmpeg: {
    available: boolean;
    path?: string;
    version?: string;
  };
  audioSubsystem: {
    available: boolean;
    system: 'pipewire' | 'pulseaudio' | 'coreaudio' | 'wasapi' | 'generic' | 'none';
    details?: string;
  };
  xvfb: {
    available: boolean;
  };
  errors: string[];
}

/**
 * Checks if ffmpeg is executable on the system PATH.
 */
export async function checkFfmpeg(customPath?: string): Promise<{
  available: boolean;
  path?: string;
  version?: string;
}> {
  const binary = customPath ?? 'ffmpeg';
  try {
    const { stdout, stderr } = await execFileAsync(binary, ['-version']);
    const output = stdout || stderr;
    const firstLine = output.split('\n')[0] ?? '';
    return {
      available: true,
      path: binary,
      version: firstLine.trim(),
    };
  } catch {
    return {
      available: false,
    };
  }
}

/**
 * Detects the available host audio recording subsystem.
 */
export async function checkAudioSubsystem(): Promise<{
  available: boolean;
  system: 'pipewire' | 'pulseaudio' | 'coreaudio' | 'wasapi' | 'generic' | 'none';
  details?: string;
}> {
  const platform = os.platform();

  if (platform === 'win32') {
    return {
      available: true,
      system: 'wasapi',
      details: 'Windows directshow/wasapi audio capture',
    };
  }

  if (platform === 'darwin') {
    return {
      available: true,
      system: 'coreaudio',
      details: 'macOS AVFoundation audio capture',
    };
  }

  if (platform === 'linux') {
    // Check pipewire / pactl
    try {
      await execFileAsync('pactl', ['info']);
      return {
        available: true,
        system: 'pulseaudio',
        details: 'PulseAudio / PipeWire Pulse emulation active',
      };
    } catch {
      // pactl missing or failed; check if generic pulse or pipewire is present
      try {
        await execFileAsync('which', ['pipewire']);
        return {
          available: true,
          system: 'pipewire',
          details: 'PipeWire daemon detected (pactl not installed)',
        };
      } catch {
        return {
          available: false,
          system: 'none',
          details: 'Neither pulseaudio-utils (pactl) nor pipewire tools detected',
        };
      }
    }
  }

  return {
    available: true,
    system: 'generic',
    details: 'Generic host audio',
  };
}

/**
 * Checks if Xvfb is available for headless virtual displays (Linux bot mode).
 */
export async function checkXvfb(): Promise<boolean> {
  if (os.platform() !== 'linux') {
    return true; // Not required on non-Linux
  }
  try {
    await execFileAsync('which', ['Xvfb']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs full preflight validation for recording capability.
 */
export async function runCapturePreflight(options?: {
  mode?: 'local_recording' | 'bot';
  customFfmpegPath?: string;
}): Promise<PreflightCheckResult> {
  const mode = options?.mode ?? 'local_recording';
  const errors: string[] = [];

  const ffmpegRes = await checkFfmpeg(options?.customFfmpegPath);
  if (!ffmpegRes.available) {
    errors.push(
      'ffmpeg was not found on PATH. Please install ffmpeg to enable meeting recording and audio extraction.'
    );
  }

  const audioRes = await checkAudioSubsystem();
  if (!audioRes.available) {
    errors.push(
      'No compatible audio recording subsystem detected. On Linux, ensure PipeWire or pulseaudio-utils (pactl) is installed.'
    );
  }

  const xvfbAvailable = await checkXvfb();
  if (mode === 'bot' && os.platform() === 'linux' && !xvfbAvailable) {
    errors.push(
      'Xvfb is required for headless bot capture on Linux. Please install xvfb (e.g. `apt-get install xvfb`).'
    );
  }

  return {
    ok: errors.length === 0,
    ffmpeg: ffmpegRes,
    audioSubsystem: audioRes,
    xvfb: { available: xvfbAvailable },
    errors,
  };
}
