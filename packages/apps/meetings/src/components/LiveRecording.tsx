import React from 'react';
import { formatClock } from '../lib/display.js';

export interface LiveRecordingProps {
  title: string;
  elapsedSeconds: number;
  onStop: () => void;
  busy: string | null;
}

/**
 * The state the pane is in WHILE recording.
 *
 * D-01's argument for a dedicated screen: this is the moment the app is most
 * visible and least forgiving. A user who cannot tell at a glance that it is
 * still capturing — and what it is capturing — will not trust it with a real
 * meeting. So the pane shows one thing and shows it large: that it is
 * listening, to which sources, and for how long.
 *
 * The source list is not decoration. Capture mixes the system output monitor
 * with the microphone, and saying so is what tells the user the far side of
 * the call is being recorded too.
 */
export const LiveRecording: React.FC<LiveRecordingProps> = ({
  title,
  elapsedSeconds,
  onStop,
  busy,
}) => (
  <div className="mtg-live">
    <div className="mtg-live-card">
      <div className="mtg-pulse">
        <div className="mtg-pulse-core" />
      </div>

      <div className="mtg-elapsed">{formatClock(elapsedSeconds)}</div>
      <div className="mtg-hint">{title}</div>

      <div className="mtg-levels" aria-hidden="true">
        {Array.from({ length: 22 }, (_, i) => (
          <div key={i} className="mtg-lv" style={{ animationDelay: `${i * 74}ms` }} />
        ))}
      </div>

      <div className="mtg-sources">
        <span><span className="mtg-tick" />System audio</span>
        <span><span className="mtg-tick" />Microphone</span>
        <span style={{ color: 'var(--fg-faint)' }}>
          <span className="mtg-tick" style={{ background: 'var(--fg-faint)' }} />
          Transcribes on stop
        </span>
      </div>

      <button className="mtg-stop" onClick={onStop} disabled={busy !== null}>
        {busy ?? 'Stop and transcribe'}
      </button>
    </div>
  </div>
);
