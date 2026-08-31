import React, { useState, useRef } from 'react';
import { Meeting, TranscriptSegment, MeetingSpeaker } from '@ikenga/meetings-contract';
import { TranscriptView } from './TranscriptView.js';

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
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  const handleSeek = (seekMs: number) => {
    if (mediaRef.current) {
      mediaRef.current.currentTime = seekMs / 1000;
      setCurrentTimeMs(seekMs);
      if (mediaRef.current.paused) {
        mediaRef.current.play().catch(() => {});
      }
    }
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLMediaElement>) => {
    const ms = Math.round(e.currentTarget.currentTime * 1000);
    setCurrentTimeMs(ms);
  };

  const hasVideo = Boolean(meeting.video_path);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr',
        gap: '1rem',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Media Player Column */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--ik-surface, #14141a)',
          borderRadius: '6px',
          border: '1px solid var(--ik-border, #2a2a35)',
          overflow: 'hidden',
          padding: '1rem',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--ik-text-primary, #fff)' }}>
            {meeting.title}
          </h2>
          <span
            style={{
              fontSize: '0.75rem',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              backgroundColor: 'var(--ik-surface-badge, #272733)',
              color: 'var(--ik-text-secondary, #94a3b8)',
            }}
          >
            {meeting.platform}
          </span>
        </div>

        {/* Video / Audio viewport */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000000',
            borderRadius: '4px',
            minHeight: '260px',
            overflow: 'hidden',
          }}
        >
          {hasVideo ? (
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={meeting.video_path}
              controls
              onTimeUpdate={handleTimeUpdate}
              style={{ width: '100%', maxHeight: '420px', outline: 'none' }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '3rem' }}>🎧</span>
              <audio
                ref={mediaRef as React.RefObject<HTMLAudioElement>}
                src={meeting.audio_path}
                controls
                onTimeUpdate={handleTimeUpdate}
                style={{ width: '280px' }}
              />
            </div>
          )}
        </div>

        {/* Meeting metadata summary */}
        <div style={{ fontSize: '0.8rem', color: 'var(--ik-text-secondary, #888)', display: 'flex', gap: '1.5rem' }}>
          <span>Duration: {Math.round(meeting.duration_seconds / 60)} mins</span>
          <span>Date: {new Date(meeting.start_time).toLocaleDateString()}</span>
          <span>Status: {meeting.status}</span>
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
