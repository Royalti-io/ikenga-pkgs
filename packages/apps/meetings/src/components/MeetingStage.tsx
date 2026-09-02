import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Meeting, MeetingSpeaker } from '@ikenga/meetings-contract';
import { callSidecar } from '../bridge.js';
import { formatClock, initials, speakerColor, waveformBars } from '../lib/display.js';

export interface MeetingStageProps {
  meeting: Meeting;
  speakers: MeetingSpeaker[];
  /** Current playhead, in ms — lifted so the transcript can follow it. */
  currentMs: number;
  onTimeChange: (ms: number) => void;
  /** Set by the parent when a transcript line is clicked. */
  seekToMs: number | null;
  onSeekHandled: () => void;
}

const RATES = [1, 1.25, 1.5, 2];

/** Decode the sidecar's base64 payload into a blob: URL the <audio> can play. */
function base64ToBlobUrl(base64: string, mime: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export const MeetingStage: React.FC<MeetingStageProps> = ({
  meeting,
  speakers,
  currentMs,
  onTimeChange,
  seekToMs,
  onSeekHandled,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [duration, setDuration] = useState(meeting.duration_seconds || 0);

  const bars = useMemo(() => waveformBars(meeting.id), [meeting.id]);

  // ── Load the audio as bytes ─────────────────────────────────────────────
  //
  // The element cannot be pointed at `meeting.audio_path`: a filesystem path in
  // `src` resolves against the pkg content server's origin, not the disk, so it
  // 404s and every transport control silently does nothing. There is no
  // file-read host verb and no asset URL a pkg pane can reference, so the bytes
  // come over the bridge and become a blob: URL.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setAudioUrl(null);
    setAudioError(null);
    setPlaying(false);
    setDuration(meeting.duration_seconds || 0);

    if (!meeting.audio_path) {
      setAudioError('This meeting has no audio file on disk.');
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const res = await callSidecar<{ base64: string; mime: string; bytes: number }>(
          ['read-audio', '--meeting-id', meeting.id],
          // Generous: the sidecar transcodes on demand for recordings made
          // before the compressed playback copy existed.
          { timeoutSecs: 600 }
        );
        if (cancelled) return;
        if (!res.base64) {
          setAudioError('Audio file is empty.');
          return;
        }
        objectUrl = base64ToBlobUrl(res.base64, res.mime);
        setAudioUrl(objectUrl);
      } catch (err) {
        if (!cancelled) setAudioError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // Revoke or each opened meeting leaks its whole decoded buffer for the
      // life of the pane.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [meeting.id, meeting.audio_path, meeting.duration_seconds]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, audioUrl]);

  // Seek requests arrive from the transcript.
  useEffect(() => {
    if (seekToMs === null || !audioRef.current) return;
    audioRef.current.currentTime = seekToMs / 1000;
    onTimeChange(seekToMs);
    if (audioRef.current.paused) {
      audioRef.current
        .play()
        .then(() => setPlaying(true))
        .catch((err) => setAudioError(`Playback failed: ${err.message}`));
    }
    onSeekHandled();
  }, [seekToMs, onSeekHandled, onTimeChange]);

  const ready = !!audioUrl;
  const progress = duration > 0 ? Math.min(1, currentMs / 1000 / duration) : 0;
  const nowIndex = Math.floor(progress * bars.length);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play()
        .then(() => setPlaying(true))
        .catch((err) => setAudioError(`Playback failed: ${err.message}`));
    }
  };

  const skip = (secs: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(duration, el.currentTime + secs));
    onTimeChange(Math.round(el.currentTime * 1000));
  };

  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const box = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    el.currentTime = ratio * duration;
    onTimeChange(Math.round(ratio * duration * 1000));
  };

  return (
    <section className="mtg-hero">
      <div className="mtg-when">
        {new Date(meeting.start_time).toLocaleString()} · {formatClock(duration)}
      </div>
      <h1 className="mtg-title">{meeting.title}</h1>

      <div className="mtg-faces">
        {speakers.length > 0 ? (
          <>
            {speakers.map((s) => (
              <span
                key={s.id}
                className="mtg-face"
                style={{ background: speakerColor(s.id) }}
                title={s.name}
              >
                {initials(s.name)}
              </span>
            ))}
            <span className="mtg-face-names">{speakers.map((s) => s.name).join(', ')}</span>
          </>
        ) : (
          <span className="mtg-face-names">Speakers not yet identified</span>
        )}
      </div>

      <div
        className="mtg-wave"
        onClick={ready ? scrub : undefined}
        aria-disabled={!ready}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentMs / 1000)}
        tabIndex={ready ? 0 : -1}
      >
        {bars.map((h, i) => (
          <div
            key={i}
            className={
              'mtg-wbar' +
              (i < nowIndex ? ' mtg-wbar--past' : i === nowIndex ? ' mtg-wbar--now' : '')
            }
            style={{ height: h }}
          />
        ))}
      </div>

      <div className="mtg-transport">
        <button className="mtg-skip" onClick={() => skip(-10)} disabled={!ready} title="Back 10s">
          −10
        </button>
        <button
          className="mtg-play"
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="mtg-skip" onClick={() => skip(10)} disabled={!ready} title="Forward 10s">
          +10
        </button>
        {RATES.map((r) => (
          <button
            key={r}
            className="mtg-skip"
            style={{ width: 'auto', padding: '0 8px' }}
            aria-pressed={rate === r}
            onClick={() => setRate(r)}
            disabled={!ready}
          >
            {r}×
          </button>
        ))}
        <span className="mtg-clock">
          {formatClock(currentMs / 1000)} / {formatClock(duration)}
        </span>
      </div>

      {(loading || audioError) && (
        <div
          className="mtg-note"
          style={{
            marginTop: 'var(--space-3)',
            color: audioError ? 'var(--danger)' : 'var(--fg-faint)',
          }}
        >
          {audioError ?? 'Loading audio…'}
        </div>
      )}

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={(e) => onTimeChange(Math.round(e.currentTarget.currentTime * 1000))}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => setAudioError('The browser could not decode this audio.')}
        />
      )}
    </section>
  );
};
