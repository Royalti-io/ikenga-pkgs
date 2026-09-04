import { MeetingSpeaker, TranscriptSegment } from '@ikenga/meetings-contract';

/** Semantic token roles used to colour speakers. Deliberately drawn from the
 *  token palette rather than invented hues, so speaker colours stay legible in
 *  both modes and shift with the active theme. */
const SPEAKER_ROLES = [
  'var(--primary)',
  'var(--systemic)',
  'var(--agent)',
  'var(--info)',
  'var(--achievement)',
];

/** Stable colour for a speaker — same speaker keeps the same colour across
 *  renders and reloads, because it is derived from the id, not from position
 *  in a list that reorders. */
export function speakerColor(speakerId: string | undefined): string {
  if (!speakerId) return 'var(--fg-faint)';
  // Channel identities are fixed roles, not arbitrary speakers — keep them
  // visually stable so "You" never changes colour between meetings.
  const channel = CHANNEL_SPEAKERS[speakerId];
  if (channel) return channel.color;
  let hash = 0;
  for (let i = 0; i < speakerId.length; i++) {
    hash = (hash * 31 + speakerId.charCodeAt(i)) >>> 0;
  }
  return SPEAKER_ROLES[hash % SPEAKER_ROLES.length]!;
}


/**
 * Channel-derived speaker identities (WP-21 / D-15).
 *
 * v1 ships no speaker model, so these are the only two identities that exist:
 * capture keeps the system-output monitor and the microphone as separate stereo
 * channels, and transcription stamps each segment `remote` or `local`. That is
 * exact for a two-party call and reads as "me vs everyone else" on a group
 * call — worth saying plainly rather than implying per-person diarization the
 * app cannot do.
 */
export const CHANNEL_SPEAKERS: Record<string, { label: string; short: string; color: string }> = {
  remote: { label: 'Them', short: 'TH', color: 'var(--info)' },
  local: { label: 'You', short: 'YO', color: 'var(--primary)' },
};

/** Display name for a segment's speaker, preferring a real name when one exists. */
export function speakerLabel(
  speakerId: string | undefined,
  speakerName: string | undefined
): string {
  if (speakerName) return speakerName;
  if (speakerId && CHANNEL_SPEAKERS[speakerId]) return CHANNEL_SPEAKERS[speakerId]!.label;
  return 'Speaker';
}

export function initials(name: string | undefined): string {
  // "You" / "Them" would initial to a single letter and read as noise; the
  // channel identities carry their own two-letter form.
  for (const c of Object.values(CHANNEL_SPEAKERS)) {
    if (name === c.label) return c.short;
  }
  if (!name) return '··';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface SpeakerTurn {
  key: string;
  speakerId?: string;
  speakerName: string;
  startMs: number;
  segments: TranscriptSegment[];
}

/**
 * Collapse consecutive segments by the same speaker into one turn.
 *
 * Whisper emits sentence-level segments, so an unfolded transcript renders one
 * avatar and one name per sentence — the reason the flat list reads as noise.
 * Grouping is what makes the Stage transcript legible as a conversation.
 */
/** Break a turn when speech pauses for longer than this. */
const TURN_GAP_MS = 2000;
/** …or when it has grown past roughly a readable paragraph. */
const TURN_MAX_CHARS = 420;

export function groupIntoTurns(
  segments: TranscriptSegment[],
  speakers: MeetingSpeaker[]
): SpeakerTurn[] {
  const nameById = new Map(speakers.map((s) => [s.id, s.name]));
  const turns: SpeakerTurn[] = [];

  for (const seg of segments) {
    const name =
      seg.speaker_name ??
      (seg.speaker_id ? nameById.get(seg.speaker_id) : undefined) ??
      speakerLabel(seg.speaker_id, undefined);
    const last = turns[turns.length - 1];
    const prev = last?.segments[last.segments.length - 1];

    // Same speaker is necessary but NOT sufficient to keep appending.
    //
    // v1 ships without diarization (D9), so every segment comes back with no
    // speaker at all and they all compare equal — grouping on speaker alone
    // collapsed an entire meeting into ONE block with a single seek point at
    // 00:00, which is strictly worse than the flat list it replaced. So a turn
    // also breaks on a real pause in the audio, and before it outgrows a
    // paragraph. That keeps seek points spread through the meeting and the
    // text readable whether or not speakers are ever identified.
    const sameSpeaker = last?.speakerId === seg.speaker_id && last?.speakerName === name;
    const gapOk = prev ? seg.start_ms - prev.end_ms <= TURN_GAP_MS : true;
    const roomLeft =
      (last?.segments.reduce((n, x) => n + x.text.length, 0) ?? 0) < TURN_MAX_CHARS;

    if (last && sameSpeaker && gapOk && roomLeft) {
      last.segments.push(seg);
    } else {
      turns.push({
        key: seg.id,
        speakerId: seg.speaker_id,
        speakerName: name,
        startMs: seg.start_ms,
        segments: [seg],
      });
    }
  }
  return turns;
}

/**
 * Deterministic bar heights for the waveform.
 *
 * The real amplitude envelope is not available in the iframe — the audio
 * arrives as an opaque encoded blob and decoding a whole meeting to draw peaks
 * would cost more than the feature is worth. Rather than fake randomness that
 * reshuffles on every render (which reads as broken), heights are derived from
 * the meeting id, so a given meeting always draws the same shape.
 *
 * This is an honest placeholder: it conveys position and progress, and makes
 * no claim to represent the actual signal.
 */
export function waveformBars(seed: string, count = 90): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5;  h >>>= 0;
    const n = (h % 1000) / 1000;
    bars.push(8 + Math.round(n * 34 + Math.abs(Math.sin(i * 0.4)) * 10));
  }
  return bars;
}
