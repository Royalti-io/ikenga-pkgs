import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TranscriptSegment } from '@ikenga/meetings-contract';
import { resolveWhisperBinary } from './binary.js';
import { resolveModelPath, WhisperModelName, DEFAULT_WHISPER_MODEL } from './models.js';

const execFileAsync = promisify(execFile);

export interface TranscribeOptions {
  audioWavPath: string;
  meetingId: string;
  model?: WhisperModelName;
  language?: string;
  whisperBinaryPath?: string;
  modelDir?: string;
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
  meetingId: string
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  const rawSegments = jsonData.transcription || jsonData.segments || [];
  for (const seg of rawSegments) {
    // whisper.cpp formats timestamps in seconds or ms
    const startMs = typeof seg.timestamps?.from === 'string'
      ? parseTimestampMs(seg.timestamps.from)
      : Math.round((seg.from ?? seg.start ?? 0) * 1000);

    const endMs = typeof seg.timestamps?.to === 'string'
      ? parseTimestampMs(seg.timestamps.to)
      : Math.round((seg.to ?? seg.end ?? 0) * 1000);

    const text = (seg.text ?? '').trim();
    if (!text) continue;

    const words: Array<{ word: string; start_ms: number; end_ms: number; confidence: number }> = [];
    if (Array.isArray(seg.words)) {
      for (const w of seg.words) {
        const wStart = typeof w.timestamps?.from === 'string'
          ? parseTimestampMs(w.timestamps.from)
          : Math.round((w.from ?? w.start ?? 0) * 1000);
        const wEnd = typeof w.timestamps?.to === 'string'
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
  // HH:MM:SS.mmm or MM:SS.mmm
  const parts = timeStr.split(':');
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
  return Math.round(parseFloat(timeStr) * 1000);
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
      '-ml', '1', // word-level token timestamps
    ];

    await execFileAsync(binaryRes.path, args);

    const jsonPath = outJsonPrefix + '.json';
    if (!existsSync(jsonPath)) {
      throw new Error(`whisper.cpp did not produce expected JSON output at ${jsonPath}`);
    }

    const rawContent = await fs.readFile(jsonPath, 'utf8');
    const parsedJson = JSON.parse(rawContent);

    return parseWhisperCppJson(parsedJson, options.meetingId);
  }
}
