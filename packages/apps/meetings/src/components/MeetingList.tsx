import React, { useState, useMemo } from 'react';
import { Meeting, MeetingPlatform } from '@ikenga/meetings-contract';

export interface MeetingListProps {
  meetings: Meeting[];
  selectedMeetingId?: string;
  onSelectMeeting: (meeting: Meeting) => void;
  onDeleteMeeting?: (meetingId: string) => void;
  /** Re-run STT for a recording whose transcription did not finish. The audio
   *  survives a failed transcribe, so this must stay reachable. */
  onRetryTranscription?: (meetingId: string) => void;
  busy?: boolean;
}

export const MeetingList: React.FC<MeetingListProps> = ({
  meetings,
  selectedMeetingId,
  onSelectMeeting,
  onDeleteMeeting,
  onRetryTranscription,
  busy = false,
}) => {
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  const filtered = useMemo(() => {
    return meetings.filter((m) => {
      if (platformFilter !== 'all' && m.platform !== platformFilter) {
        return false;
      }
      if (search.trim() && !m.title.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [meetings, platformFilter, search]);

  const formatDuration = (sec: number): string => {
    if (!sec) return '< 1 min';
    const mins = Math.round(sec / 60);
    return `${mins} min${mins === 1 ? '' : 's'}`;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--ik-surface, #14141a)',
        borderRadius: '8px',
        border: '1px solid var(--ik-border, #282834)',
        overflow: 'hidden',
      }}
    >
      {/* Controls Bar */}
      <div
        style={{
          padding: '0.75rem',
          borderBottom: '1px solid var(--ik-border, #282834)',
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          placeholder="Filter meetings..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            padding: '0.4rem 0.6rem',
            borderRadius: '4px',
            border: '1px solid var(--ik-border, #3b3b4d)',
            backgroundColor: 'var(--ik-surface-elevated, #1c1c24)',
            color: '#fff',
            fontSize: '0.85rem',
          }}
        />
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          style={{
            padding: '0.4rem 0.5rem',
            borderRadius: '4px',
            border: '1px solid var(--ik-border, #3b3b4d)',
            backgroundColor: 'var(--ik-surface-elevated, #1c1c24)',
            color: '#fff',
            fontSize: '0.85rem',
          }}
        >
          <option value="all">All Sources</option>
          <option value="local_recording">Local Screen/Mic</option>
          <option value="google_meet">Google Meet</option>
          <option value="zoom">Zoom</option>
          <option value="microsoft_teams">Teams</option>
        </select>
      </div>

      {/* List items */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280', fontSize: '0.9rem' }}>
            No recorded meetings found.
          </div>
        ) : (
          filtered.map((m) => {
            const isSelected = m.id === selectedMeetingId;
            return (
              <div
                key={m.id}
                onClick={() => onSelectMeeting(m)}
                style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid var(--ik-border, #22222d)',
                  backgroundColor: isSelected
                    ? 'var(--ik-surface-selected, #262636)'
                    : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'background-color 0.1s',
                }}
              >
                <div>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: '0.95rem',
                      color: isSelected ? 'var(--ik-primary, #60a5fa)' : '#f3f4f6',
                      marginBottom: '0.25rem',
                    }}
                  >
                    {m.title}
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--ik-text-secondary, #9ca3af)',
                      display: 'flex',
                      gap: '0.75rem',
                    }}
                  >
                    <span>{new Date(m.start_time).toLocaleDateString()}</span>
                    <span>•</span>
                    <span>{formatDuration(m.duration_seconds)}</span>
                    <span>•</span>
                    <span>{m.platform}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '4px',
                      backgroundColor:
                        m.status === 'completed'
                          ? '#064e3b'
                          : m.status === 'failed'
                            ? '#7f1d1d'
                            : '#374151',
                      color:
                        m.status === 'completed'
                          ? '#34d399'
                          : m.status === 'failed'
                            ? '#fca5a5'
                            : '#d1d5db',
                    }}
                  >
                    {m.status}
                  </span>
                  {onRetryTranscription && m.status === 'failed' && m.audio_path && (
                    <button
                      title="Transcribe this recording again"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRetryTranscription(m.id);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: busy ? '#6b7280' : '#60a5fa',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        padding: '0.2rem 0.4rem',
                        fontSize: '0.7rem',
                      }}
                    >
                      ↻ Transcribe
                    </button>
                  )}
                  {onDeleteMeeting && (
                    <button
                      title="Delete recording and transcripts"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete recording "${m.title}" and remove all local media files?`)) {
                          onDeleteMeeting(m.id);
                        }
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '0.2rem 0.4rem',
                      }}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
