import React, { useState } from 'react';

export interface RecorderBarProps {
  isRecording: boolean;
  elapsedSeconds: number;
  onStartRecording: (title: string) => void;
  onStopRecording: () => void;
  hasConsent: boolean;
  onRequestConsent: () => void;
}

export const RecorderBar: React.FC<RecorderBarProps> = ({
  isRecording,
  elapsedSeconds,
  onStartRecording,
  onStopRecording,
  hasConsent,
  onRequestConsent,
}) => {
  const [meetingTitle, setMeetingTitle] = useState('');

  const formatElapsed = (sec: number): string => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStart = () => {
    if (!hasConsent) {
      onRequestConsent();
      return;
    }
    const title = meetingTitle.trim() || `Local Recording - ${new Date().toLocaleTimeString()}`;
    onStartRecording(title);
    setMeetingTitle('');
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1.25rem',
        backgroundColor: 'var(--ik-surface-elevated, #1a1a22)',
        borderRadius: '8px',
        border: '1px solid var(--ik-border, #2d2d3a)',
        gap: '1rem',
      }}
    >
      {isRecording ? (
        <>
          {/* Active Recording State */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span
              style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: '#ef4444',
                boxShadow: '0 0 10px #ef4444',
              }}
            />
            <span style={{ fontWeight: 600, color: '#f87171' }}>REC</span>
            <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', color: '#fff' }}>
              {formatElapsed(elapsedSeconds)}
            </span>
            <span style={{ fontSize: '0.85rem', color: 'var(--ik-text-secondary, #9ca3af)' }}>
              Capturing system audio & screen (100% local)
            </span>
          </div>

          <button
            type="button"
            onClick={onStopRecording}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ⏹ Stop Recording
          </button>
        </>
      ) : (
        <>
          {/* Idle Start State */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
            <input
              type="text"
              placeholder="Meeting or Session Title..."
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              style={{
                flex: 1,
                maxWidth: '400px',
                padding: '0.45rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid var(--ik-border, #3b3b4d)',
                backgroundColor: 'var(--ik-surface, #121218)',
                color: 'var(--ik-text-primary, #fff)',
                fontSize: '0.875rem',
              }}
            />
            <span style={{ fontSize: '0.8rem', color: 'var(--ik-text-secondary, #888)' }}>
              Local Own-Machine Capture
            </span>
          </div>

          <button
            type="button"
            onClick={handleStart}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: 'var(--ik-primary, #3b82f6)',
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>🎙️</span>
            <span>Start Local Recording</span>
          </button>
        </>
      )}
    </div>
  );
};
