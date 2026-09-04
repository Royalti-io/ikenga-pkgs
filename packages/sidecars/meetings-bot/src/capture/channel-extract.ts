// Pulls one leg back out of the stereo master (see D-15 / `ffmpeg-graph.ts`)
// as its own mono 16kHz PCM file, so whisper can transcribe it in isolation
// and the resulting segments can be attributed to one speaker.
//
// This is deliberately NOT part of `buildFfmpegArgs`: it runs later, on
// demand, against a file that already exists on disk — a second short-lived
// ffmpeg invocation, not part of the live capture graph.
export type StereoChannel = 'left' | 'right';

/**
 * Builds the ffmpeg args to extract one channel of a stereo file into its own
 * mono 16kHz PCM wav.
 *
 * `pan=mono|c0=cN` rather than `-map_channel`: `-map_channel` is deprecated
 * upstream in favour of the `channelmap`/`pan` filters, and `pan` is what the
 * rest of this file's filter graphs already use (see `ffmpeg-graph.ts`), so
 * there is one idiom for channel manipulation across the sidecar instead of
 * two.
 */
export function buildChannelExtractArgs(
  stereoPath: string,
  outputMonoPath: string,
  channel: StereoChannel
): string[] {
  const channelIndex = channel === 'left' ? 'c0' : 'c1';
  return [
    '-y',
    '-i', stereoPath,
    '-af', `pan=mono|c0=${channelIndex}`,
    '-vn',
    '-c:a', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    outputMonoPath,
  ];
}

/**
 * Path of the per-channel extraction next to the stereo master, e.g.
 * `.../audio.stereo.wav` -> `.../audio.channel-left.wav`.
 */
export function deriveChannelPath(stereoPath: string, channel: StereoChannel): string {
  return stereoPath.replace(/\.stereo\.wav$/i, `.channel-${channel}.wav`);
}
