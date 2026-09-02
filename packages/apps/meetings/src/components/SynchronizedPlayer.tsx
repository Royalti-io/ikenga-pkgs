import React, { useState, useRef, useEffect } from 'react';
import { Meeting, TranscriptSegment, MeetingSpeaker } from '@ikenga/meetings-contract';
import { TranscriptView } from './TranscriptView.js';
import { callSidecar } from '../bridge.js';

/** Decode the sidecar's base64 payload into a blob: URL the <audio> can play. */
function base64ToBlobUrl(base64: string, mime: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export interface SynchronizedPlayerProps {
  meeting: Meeting;
  segments: TranscriptSegment[];
  speakers?: MeetingSpeaker[];
  onRenameSpeaker?: (speaker: MeetingSpeaker) => void;
}

export const SynchronizedPlayer: React.FC<SynchronizedPlayerProps> = ({
  meeting,
  segments,
  speakers,
  onRenameSpeaker,
}) => {
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [durationSecs, setDurationSecs] = useState<number>(meeting.duration_seconds || 0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState<boolean>(false);

  // ── Load the audio as bytes ─────────────────────────────────────────────
  //
  // The element cannot be pointed at `meeting.audio_path`: a filesystem path in
  // `src` resolves against the pkg content server's origin, not the disk, so it
  // 404s and every transport control silently does nothing. There is no
  // file-read host verb and no asset URL a pkg pane can reference, so the bytes
  // come over the bridge and become a blob: URL — the same route studio uses
  // for render previews.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setAudioUrl(null);
    setAudioError(null);
    setIsPlaying(false);
    setCurrentTimeMs(0);

    if (!meeting.audio_path) {
      setAudioError('This meeting has no audio file on disk.');
      return;
    }

    setLoadingAudio(true);
    (async () => {
      try {
        const res = await callSidecar<{ base64: string; mime: string; bytes: number }>(
          ['read-audio', '--meeting-id', meeting.id],
          // Generous: the sidecar transcodes on demand for recordings made
          // before the compressed copy existed.
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
        if (!cancelled) setLoadingAudio(false);
      }
    })();

    return () => {
      cancelled = true;
      // Revoke on unmount/switch or each opened meeting leaks its whole
      // decoded buffer for the life of the pane.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [meeting.id, meeting.audio_path]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const handleSeek = (seekMs: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seekMs / 1000;
      setCurrentTimeMs(seekMs);
      if (audioRef.current.paused) {
        audioRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch((err) => setAudioError(`Playback failed: ${err.message}`));
      }
    }
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const ms = Math.round(e.currentTarget.currentTime * 1000);
    setCurrentTimeMs(ms);
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    if (e.currentTarget.duration && !isNaN(e.currentTarget.duration)) {
      setDurationSecs(Math.round(e.currentTarget.duration));
    }
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => setAudioError(`Playback failed: ${err.message}`));
    }
  };

  const skip = (seconds: number) => {
    if (!audioRef.current) return;
    const target = Math.max(0, audioRef.current.currentTime + seconds);
    audioRef.current.currentTime = target;
    setCurrentTimeMs(Math.round(target * 1000));
  };

  const formatTime = (secs: number): string => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = Math.floor(secs % 60);
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  const currentSecs = Math.floor(currentTimeMs / 1000);
  const progressPct = durationSecs > 0 ? (currentSecs / durationSecs) * 100 : 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '400px 1fr',
        gap: '1rem',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Audio Player Card */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--ik-surface, #14141a)',
          borderRadius: '8px',
          border: '1px solid var(--ik-border, #2a2a35)',
          overflow: 'hidden',
          padding: '1.25rem',
          gap: '1.25rem',
        }}
      >
        {/* Title & Metadata */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                backgroundColor: 'var(--ik-surface-badge, #272733)',
                color: '#60a5fa',
                fontWeight: 600,
              }}
            >
              🎙️ Audio Recording
            </span>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {meeting.platform}
            </span>
          </div>

          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: 'var(--ik-text-primary, #fff)' }}>
            {meeting.title}
          </h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--ik-text-secondary, #94a3b8)', marginTop: '0.25rem' }}>
            {new Date(meeting.start_time).toLocaleString()}
          </div>
        </div>

        {/* Hidden Audio Element */}
        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onError={() => setAudioError('The browser could not decode this audio.')}
          />
        )}

        {(loadingAudio || audioError) && (
          <div
            style={{
              fontSize: '0.8rem',
              padding: '0.4rem 0.6rem',
              borderRadius: '4px',
              color: audioError ? '#fca5a5' : 'var(--ik-text-secondary, #9ca3af)',
              backgroundColor: audioError ? 'rgba(127,29,29,0.25)' : 'transparent',
            }}
          >
            {audioError ?? 'Loading audio…'}
          </div>
        )}

        {/* Audio Visualizer & Waveform Mock */}
        <div
          style={{
            height: '80px',
            backgroundColor: '#0a0a0e',
            borderRadius: '6px',
            border: '1px solid #22222c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            padding: '0 1rem',
          }}
        >
          {Array.from({ length: 32 }).map((_, i) => {
            const isPlayed = (i / 32) * 100 <= progressPct;
            const barHeight = 20 + Math.sin(i * 0.6) * 16 + (i % 3) * 10;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${barHeight}px`,
                  backgroundColor: isPlayed ? '#3b82f6' : '#334155',
                  borderRadius: '2px',
                  transition: 'background-color 0.1s',
                }}
              />
            );
          })}
        </div>

        {/* Scrubber & Timestamps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <input
            type="range"
            min={0}
            max={durationSecs || 1}
            value={currentSecs}
            onChange={(e) => {
              const sec = parseFloat(e.target.value);
              handleSeek(sec * 1000);
            }}
            style={{
              width: '100%',
              accentColor: '#3b82f6',
              cursor: 'pointer',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', fontFamily: 'monospace' }}>
            <span>{formatTime(currentSecs)}</span>
            <span>{formatTime(durationSecs)}</span>
          </div>
        </div>

        {/* Playback Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
          <button
            type="button"
            title="Skip back 10 seconds"
            onClick={() => skip(-10)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1rem',
              cursor: 'pointer',
              padding: '0.5rem',
            }}
          >
            ⏪ -10s
          </button>

          <button
            type="button"
            onClick={togglePlayPause}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: '#3b82f6',
              color: '#fff',
              border: 'none',
              fontSize: '1.2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
            }}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          <button
            type="button"
            title="Skip forward 10 seconds"
            onClick={() => skip(10)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1rem',
              cursor: 'pointer',
              padding: '0.5rem',
            }}
          >
            +10s ⏩
          </button>
        </div>

        {/* Speed Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Speed:</span>
          {[1.0, 1.25, 1.5, 2.0].map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => setPlaybackRate(rate)}
              style={{
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: playbackRate === rate ? '#1e3a8a' : '#1e1e28',
                color: playbackRate === rate ? '#93c5fd' : '#94a3b8',
                fontSize: '0.75rem',
                cursor: 'pointer',
                fontWeight: playbackRate === rate ? 600 : 'normal',
              }}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>

      {/* Synchronized Transcript Column */}
      <div style={{ height: '100%', overflow: 'hidden' }}>
        <TranscriptView
          segments={segments}
          currentTimeMs={currentTimeMs}
          onSeek={handleSeek}
          speakers={speakers}
          onRenameSpeaker={onRenameSpeaker}
        />
      </div>
    </div>
  );
};
