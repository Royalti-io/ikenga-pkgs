import React, { useState, useMemo } from 'react';
import { TranscriptSegment, MeetingSpeaker } from '@ikenga/meetings-contract';
import { SpeakerTagEditor } from './SpeakerTagEditor.js';

export interface TranscriptViewProps {
  segments: TranscriptSegment[];
  currentTimeMs: number;
  onSeek: (timestampMs: number) => void;
  speakers?: MeetingSpeaker[];
  onRenameSpeaker?: (speaker: MeetingSpeaker) => void;
}

export const TranscriptView: React.FC<TranscriptViewProps> = ({
  segments,
  currentTimeMs,
  onSeek,
  speakers = [],
  onRenameSpeaker,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSpeaker, setEditingSpeaker] = useState<MeetingSpeaker | null>(null);

  const filteredSegments = useMemo(() => {
    if (!searchQuery.trim()) return segments;
    const q = searchQuery.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, searchQuery]);

  const formatTime = (ms: number): string => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--ik-surface, #14141a)',
        borderRadius: '6px',
        border: '1px solid var(--ik-border, #2a2a35)',
        overflow: 'hidden',
      }}
    >
      {/* Header / Search Bar */}
      <div
        style={{
          padding: '0.75rem',
          borderBottom: '1px solid var(--ik-border, #2a2a35)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <span style={{ color: 'var(--ik-text-secondary, #888)' }}>🔍</span>
        <input
          type="text"
          placeholder="Search transcript..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            padding: '0.4rem 0.6rem',
            borderRadius: '4px',
            border: '1px solid var(--ik-border, #3a3a48)',
            backgroundColor: 'var(--ik-surface-elevated, #1c1c24)',
            color: 'var(--ik-text-primary, #fff)',
            fontSize: '0.85rem',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Segments List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        {filteredSegments.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#777', padding: '2rem' }}>
            No transcript segments found.
          </div>
        ) : (
          filteredSegments.map((segment) => {
            const isSegmentActive =
              currentTimeMs >= segment.start_ms && currentTimeMs <= segment.end_ms;

            return (
              <div
                key={segment.id}
                style={{
                  padding: '0.6rem 0.8rem',
                  borderRadius: '6px',
                  backgroundColor: isSegmentActive
                    ? 'var(--ik-surface-active, rgba(59, 130, 246, 0.15))'
                    : 'transparent',
                  borderLeft: isSegmentActive
                    ? '3px solid var(--ik-primary, #3b82f6)'
                    : '3px solid transparent',
                  transition: 'background-color 0.15s ease',
                }}
              >
                {/* Speaker & Timestamp Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.35rem',
                    fontSize: '0.8rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span
                      style={{
                        fontWeight: 600,
                        color: 'var(--ik-text-primary, #e2e8f0)',
                      }}
                    >
                      {segment.speaker_name ?? 'Speaker'}
                    </span>
                    {segment.speaker_source && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          padding: '0.1rem 0.35rem',
                          borderRadius: '3px',
                          backgroundColor:
                            segment.speaker_source === 'manual'
                              ? '#1e3a8a'
                              : 'var(--ik-surface-badge, #272733)',
                          color: '#93c5fd',
                        }}
                      >
                        {segment.speaker_source}
                      </span>
                    )}
                    {onRenameSpeaker && (
                      <button
                        title="Rename speaker"
                        onClick={() => {
                          const matched = speakers.find((s) => s.id === segment.speaker_id) ?? {
                            id: segment.speaker_id ?? 'spk-1',
                            meeting_id: segment.meeting_id,
                            name: segment.speaker_name ?? 'Speaker',
                            speaker_source: segment.speaker_source ?? 'dom_cue',
                          };
                          setEditingSpeaker(matched);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#64748b',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          padding: '0 0.2rem',
                        }}
                      >
                        ✎
                      </button>
                    )}
                  </div>

                  <button
                    onClick={() => onSeek(segment.start_ms)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--ik-text-secondary, #94a3b8)',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontFamily: 'monospace',
                    }}
                  >
                    {formatTime(segment.start_ms)}
                  </button>
                </div>

                {/* Spoken Text (Click-to-seek tokens) */}
                <div style={{ fontSize: '0.9rem', lineHeight: 1.5, color: '#f1f5f9' }}>
                  {segment.words && segment.words.length > 0 ? (
                    segment.words.map((w, idx) => {
                      const isWordActive =
                        currentTimeMs >= w.start_ms && currentTimeMs <= w.end_ms;
                      return (
                        <span
                          key={idx}
                          onClick={() => onSeek(w.start_ms)}
                          style={{
                            cursor: 'pointer',
                            padding: '0 0.15rem',
                            borderRadius: '2px',
                            backgroundColor: isWordActive ? '#fbbf24' : 'transparent',
                            color: isWordActive ? '#000000' : 'inherit',
                            fontWeight: isWordActive ? 600 : 'normal',
                          }}
                        >
                          {w.word}{' '}
                        </span>
                      );
                    })
                  ) : (
                    <span
                      onClick={() => onSeek(segment.start_ms)}
                      style={{ cursor: 'pointer' }}
                    >
                      {segment.text}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rename Modal */}
      {editingSpeaker && (
        <SpeakerTagEditor
          speaker={editingSpeaker}
          onSave={(updated) => {
            if (onRenameSpeaker) onRenameSpeaker(updated);
            setEditingSpeaker(null);
          }}
          onClose={() => setEditingSpeaker(null)}
        />
      )}
    </div>
  );
};
