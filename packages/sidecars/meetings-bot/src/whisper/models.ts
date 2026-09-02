import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import crypto from 'node:crypto';

export type WhisperModelName =
  | 'tiny.en'
  | 'base.en'
  | 'small.en'
  | 'medium.en'
  | 'large-v3-q5_0';

export interface WhisperModelInfo {
  name: WhisperModelName;
  filename: string;
  sizeBytes: number;
  sha256?: string;
  downloadUrl: string;
}

export const WHISPER_MODELS: Record<WhisperModelName, WhisperModelInfo> = {
  'tiny.en': {
    name: 'tiny.en',
    filename: 'ggml-tiny.en.bin',
    sizeBytes: 77691648,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  },
  'base.en': {
    name: 'base.en',
    filename: 'ggml-base.en.bin',
    sizeBytes: 147964211,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  },
  'small.en': {
    name: 'small.en',
    filename: 'ggml-small.en.bin',
    sizeBytes: 487847424,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  },
  'medium.en': {
    name: 'medium.en',
    filename: 'ggml-medium.en.bin',
    sizeBytes: 1533755456,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
  },
  'large-v3-q5_0': {
    name: 'large-v3-q5_0',
    filename: 'ggml-large-v3-q5_0.bin',
    sizeBytes: 1083981824,
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin',
  },
};

export const DEFAULT_WHISPER_MODEL: WhisperModelName = 'small.en';

export function getModelCacheDir(customDir?: string): string {
  if (customDir) return customDir;
  return path.join(os.homedir(), '.ikenga', 'models', 'whisper');
}

export function resolveModelPath(modelName: WhisperModelName, customDir?: string): string {
  const info = WHISPER_MODELS[modelName];
  if (!info) {
    throw new Error(`Unknown whisper model: ${modelName}`);
  }
  const dir = getModelCacheDir(customDir);
  return path.join(dir, info.filename);
}

export async function isModelDownloaded(
  modelName: WhisperModelName,
  customDir?: string
): Promise<boolean> {
  const filePath = resolveModelPath(modelName, customDir);
  return existsSync(filePath);
}

export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}
