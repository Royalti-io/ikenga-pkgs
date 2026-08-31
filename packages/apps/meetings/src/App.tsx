import React, { useState, useEffect } from 'react';
import {
  Meeting,
  TranscriptSegment,
  MeetingSpeaker,
} from '@ikenga/meetings-contract';
import { RecorderBar } from './components/RecorderBar.js';
import { MeetingList } from './components/MeetingList.js';
import { SynchronizedPlayer } from './components/SynchronizedPlayer.js';
import { ConsentGate } from './components/ConsentGate.js';

export const App: React.FC = () => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [speakers, setSpeakers] = useState<MeetingSpeaker[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [showConsentModal, setShowConsentModal] = useState<boolean>(false);
  const [hasConsent, setHasConsent] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ikenga_meetings_consent_acknowledged_v1') === 'true';
    } catch {
      return false;
    }
  });

  // Track parent theme
  useEffect(() => {
    const syncTheme = () => {
      try {
        const parentHtml = window.parent?.document?.documentElement;
        if (parentHtml) {
          const theme = parentHtml.getAttribute('data-theme');
          const mode = parentHtml.getAttribute('data-mode');
          if (theme) document.documentElement.setAttribute('data-theme', theme);
          if (mode) document.documentElement.setAttribute('data-mode', mode);
        }
      } catch {
        // cross-origin iframe fallback
      }
    };
    syncTheme();
    const interval = setInterval(syncTheme, 1000);
    return () => clearInterval(interval);
  }, []);

  // Timer loop when recording
  useEffect(() => {
    let timer: any;
    if (isRecording) {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => clearInterval(timer);
  }, [isRecording]);

  const handleStartRecording = (title: string) => {
    if (!hasConsent) {
      setShowConsentModal(true);
      return;
    }

    const newMeetingId = crypto.randomUUID();
    const newMeeting: Meeting = {
      id: newMeetingId,
      title,
      platform: 'local_recording',
      status: 'recording',
      start_time: new Date().toISOString(),
      duration_seconds: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setMeetings((prev) => [newMeeting, ...prev]);
    setSelectedMeeting(newMeeting);
    setSegments([]);
    setSpeakers([]);
    setIsRecording(true);
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    if (selectedMeeting) {
      const updated: Meeting = {
        ...selectedMeeting,
        status: 'completed',
        duration_seconds: elapsedSeconds,
        end_time: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setSelectedMeeting(updated);
      setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    }
  };

  const handleDeleteMeeting = (meetingId: string) => {
    setMeetings((prev) => prev.filter((m) => m.id !== meetingId));
    if (selectedMeeting?.id === meetingId) {
      setSelectedMeeting(null);
      setSegments([]);
      setSpeakers([]);
    }
  };

  const handleRenameSpeaker = (updated: MeetingSpeaker) => {
    setSpeakers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setSegments((prev) =>
      prev.map((seg) =>
        seg.speaker_id === updated.id
          ? { ...seg, speaker_name: updated.name, speaker_source: 'manual' }
          : seg
      )
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        backgroundColor: 'var(--ik-background, #0d0d12)',
        color: 'var(--ik-text-primary, #ffffff)',
        boxSizing: 'border-box',
        padding: '1rem',
        gap: '1rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Top Bar: Title & Recorder Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>
            🎙️ Ikenga Meetings
          </h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--ik-text-secondary, #9ca3af)' }}>
            Zero-Cloud Local Notetaker
          </span>
        </div>

        <RecorderBar
          isRecording={isRecording}
          elapsedSeconds={elapsedSeconds}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          hasConsent={hasConsent}
          onRequestConsent={() => setShowConsentModal(true)}
        />
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: selectedMeeting ? '360px 1fr' : '1fr', gap: '1rem', overflow: 'hidden' }}>
        <MeetingList
          meetings={meetings}
          selectedMeetingId={selectedMeeting?.id}
          onSelectMeeting={(m) => setSelectedMeeting(m)}
          onDeleteMeeting={handleDeleteMeeting}
        />

        {selectedMeeting && (
          <SynchronizedPlayer
            meeting={selectedMeeting}
            segments={segments}
            speakers={speakers}
            onRenameSpeaker={handleRenameSpeaker}
          />
        )}
      </div>

      {/* Consent Gate Modal */}
      {showConsentModal && (
        <ConsentGate
          hasAcknowledged={false}
          onAccept={() => {
            setHasConsent(true);
            setShowConsentModal(false);
          }}
          onCancel={() => setShowConsentModal(false)}
        />
      )}
    </div>
  );
};
