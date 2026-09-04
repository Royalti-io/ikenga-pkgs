import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TranscriptSegment } from '@ikenga/meetings-contract';
import { resolveWhisperBinary } from './binary.js';
import { resolveModelPath, WhisperModelName, DEFAULT_WHISPER_MODEL } from './models.js';

export interface TranscribeOptions {
  audioWavPath: string;
  meetingId: string;
  model?: WhisperModelName;
  language?: string;
  whisperBinaryPath?: string;
  modelDir?: string;
  onSpawn?: (pid: number) => void | Promise<void>;
  /**
   * Stamped onto every resulting segment's `speaker_id` (free-form — the
   * contract schema has no enum for it). Used for channel-split
   * transcription: when `audioWavPath` is one extracted leg of the stereo
   * master (see `capture/channel-extract.ts`) rather than the full mix, the
   * caller already knows which speaker that leg is and passes it through
   * here instead of leaving every segment unattributed.
   */
  speakerId?: string;
}

export interface WhisperRawWord {
  word: string;
  start_ms: number;
  end_ms: number;
  confidence?: number;
}

export interface WhisperRawSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  words?: WhisperRawWord[];
}

/**
 * Calculates Word Error Rate (WER) between hypothesis and reference transcripts.
 */
export function calculateWer(reference: string, hypothesis: string): number {
  const refWords = reference.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hypWords = hypothesis.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (refWords.length === 0) {
    return hypWords.length === 0 ? 0 : 1;
  }

  const d: number[][] = [];
  for (let i = 0; i <= refWords.length; i++) {
    d[i] = [i];
  }
  for (let j = 0; j <= hypWords.length; j++) {
    if (d[0]) d[0][j] = j;
  }

  for (let i = 1; i <= refWords.length; i++) {
    for (let j = 1; j <= hypWords.length; j++) {
      const cost = refWords[i - 1] === hypWords[j - 1] ? 0 : 1;
      const prevRow = d[i - 1];
      const curRow = d[i];
      if (prevRow && curRow) {
        curRow[j] = Math.min(
          prevRow[j]! + 1, // deletion
          curRow[j - 1]! + 1, // insertion
          prevRow[j - 1]! + cost // substitution
        );
      }
    }
  }

  const edits = d[refWords.length]?.[hypWords.length] ?? 0;
  return Number((edits / refWords.length).toFixed(4));
}

/**
 * Parses whisper.cpp JSON export output format into TranscriptSegment structures.
 */
export function parseWhisperCppJson(
  jsonData: any,
  meetingId: string,
  options?: { speakerId?: string }
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  const rawSegments = jsonData.transcription || jsonData.segments || [];
  for (const seg of rawSegments) {
    // whisper.cpp formats timestamps in seconds or ms
    // whisper.cpp emits BOTH a numeric `offsets` block (already milliseconds)
    // and a display `timestamps` block. Prefer offsets: it needs no parsing and
    // cannot lose precision.
    const startMs = typeof seg.offsets?.from === 'number'
      ? seg.offsets.from
      : typeof seg.timestamps?.from === 'string'
        ? parseTimestampMs(seg.timestamps.from)
        : Math.round((seg.from ?? seg.start ?? 0) * 1000);

    const endMs = typeof seg.offsets?.to === 'number'
      ? seg.offsets.to
      : typeof seg.timestamps?.to === 'string'
        ? parseTimestampMs(seg.timestamps.to)
        : Math.round((seg.to ?? seg.end ?? 0) * 1000);

    const text = (seg.text ?? '').trim();
    if (!text) continue;

    const words: Array<{ word: string; start_ms: number; end_ms: number; confidence: number }> = [];
    if (Array.isArray(seg.words)) {
      for (const w of seg.words) {
        const wStart = typeof w.offsets?.from === 'number'
          ? w.offsets.from
          : typeof w.timestamps?.from === 'string'
            ? parseTimestampMs(w.timestamps.from)
            : Math.round((w.from ?? w.start ?? 0) * 1000);
        const wEnd = typeof w.offsets?.to === 'number'
          ? w.offsets.to
          : typeof w.timestamps?.to === 'string'
            ? parseTimestampMs(w.timestamps.to)
            : Math.round((w.to ?? w.end ?? 0) * 1000);

        words.push({
          word: (w.word ?? w.text ?? '').trim(),
          start_ms: Math.max(0, wStart),
          end_ms: Math.max(wStart, wEnd),
          confidence: w.confidence ?? 1.0,
        });
      }
    }

    segments.push({
      id: crypto.randomUUID(),
      meeting_id: meetingId,
      speaker_id: options?.speakerId,
      speaker_source: 'dom_cue',
      start_ms: Math.max(0, startMs),
      end_ms: Math.max(startMs, endMs),
      text,
      confidence: seg.confidence ?? 1.0,
      words: words.length > 0 ? words : undefined,
    });
  }

  return segments;
}

function parseTimestampMs(timeStr: string): number {
  // HH:MM:SS,mmm or HH:MM:SS.mmm (also MM:SS forms).
  //
  // whisper.cpp writes SRT-style timestamps with a COMMA as the decimal
  // separator ("00:00:00,220"). `parseFloat('00,220')` is 0, so parsing these
  // as-is silently discarded the milliseconds on every segment and quantised
  // the whole transcript to whole seconds — every player seek landed up to a
  // second away from the word it was supposed to hit.
  const normalized = timeStr.replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0] ?? '0');
    const mins = parseFloat(parts[1] ?? '0');
    const secs = parseFloat(parts[2] ?? '0');
    return Math.round((hours * 3600 + mins * 60 + secs) * 1000);
  } else if (parts.length === 2) {
    const mins = parseFloat(parts[0] ?? '0');
    const secs = parseFloat(parts[1] ?? '0');
    return Math.round((mins * 60 + secs) * 1000);
  }
  return Math.round(parseFloat(normalized) * 1000);
}

export class LocalWhisperEngine {
  async transcribe(options: TranscribeOptions): Promise<TranscriptSegment[]> {
    const binaryRes = await resolveWhisperBinary(options.whisperBinaryPath);
    if (!binaryRes.available || !binaryRes.path) {
      throw new Error(binaryRes.error ?? 'whisper.cpp binary not available.');
    }

    const modelName = options.model ?? DEFAULT_WHISPER_MODEL;
    const modelPath = resolveModelPath(modelName, options.modelDir);
    if (!existsSync(modelPath)) {
      throw new Error(
        `Whisper model ${modelName} not found at ${modelPath}. Please download model weights first.`
      );
    }

    const outJsonPrefix = options.audioWavPath.replace(/\.wav$/i, '') + '.transcript';
    const args = [
      '-m', modelPath,
      '-f', options.audioWavPath,
      '-oj', // output JSON
      '-of', outJsonPrefix,
      '-l', options.language ?? 'en',
    ];

    // NOTE: `-ml 1` is deliberately NOT passed. It sets whisper.cpp's max line
    // length to ONE CHARACTER, which splits the transcript into a separate
    // segment per token — "And" / "so" / "my" / "fellow" as four rows. It was
    // added under the comment "word-level token timestamps", but that is not
    // what the flag does. Default segmentation yields the sentence-level lines
    // the transcript view and the player's seek behaviour are built around.

    const child = spawn(binaryRes.path, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    if (typeof child.pid === 'number' && options.onSpawn) {
      await options.onSpawn(child.pid);
    }

    await new Promise<void>((resolve, reject) => {
      let stderr = '';
      child.stderr?.on('data', (d) => {
        stderr = (stderr + d.toString()).slice(-4096);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`whisper.cpp exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
        }
      });
    });

    const jsonPath = outJsonPrefix + '.json';
    if (!existsSync(jsonPath)) {
      throw new Error(`whisper.cpp did not produce expected JSON output at ${jsonPath}`);
    }

    const rawContent = await fs.readFile(jsonPath, 'utf8');
    const parsedJson = JSON.parse(rawContent);

    return parseWhisperCppJson(parsedJson, options.meetingId, { speakerId: options.speakerId });
  }
}
