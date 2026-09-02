import React from 'react';
import { MeetingSpeaker, TranscriptSegment } from '@ikenga/meetings-contract';
import { formatClock, initials, speakerColor, groupIntoTurns } from '../lib/display.js';

export interface TranscriptProps {
  segments: TranscriptSegment[];
  speakers: MeetingSpeaker[];
  currentMs: number;
  onSeek: (ms: number) => void;
}

/**
 * The transcript as a conversation, not a log.
 *
 * Consecutive segments from one speaker are collapsed into a single turn.
 * Whisper emits sentence-level segments, so rendering them flat gives one
 * avatar and one name per sentence — which is what made the previous list read
 * as noise rather than as people talking.
 */
export const Transcript: React.FC<TranscriptProps> = ({
  segments,
  speakers,
  currentMs,
  onSeek,
}) => {
  if (segments.length === 0) {
    return (
      <p className="mtg-note" style={{ padding: 'var(--space-4) 0' }}>
        No transcript for this meeting yet.
      </p>
    );
  }

  const turns = groupIntoTurns(segments, speakers);

  return (
    <section aria-label="Transcript">
      {turns.map((turn) => {
        const last = turn.segments[turn.segments.length - 1]!;
        const active = currentMs >= turn.startMs && currentMs < last.end_ms;
        const color = speakerColor(turn.speakerId ?? turn.speakerName);
        return (
          <article key={turn.key} className="mtg-block" data-active={active}>
            <span className="mtg-face" style={{ background: color }} aria-hidden="true">
              {initials(turn.speakerName)}
            </span>
            <div>
              <div className="mtg-name" style={{ color }}>
                {turn.speakerName}
                <button
                  className="mtg-at"
                  onClick={() => onSeek(turn.startMs)}
                  title="Jump to this moment"
                >
                  {formatClock(turn.startMs / 1000)}
                </button>
              </div>
              <div className="mtg-said">
                {turn.segments.map((s) => s.text.trim()).join(' ')}
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
};
