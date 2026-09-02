import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Meeting,
  TranscriptSegment,
  MeetingSpeaker,
  MeetingsDbClient,
} from '@ikenga/meetings-contract';
import { RecorderBar } from './components/RecorderBar.js';
import { MeetingList } from './components/MeetingList.js';
import { SynchronizedPlayer } from './components/SynchronizedPlayer.js';
import { ConsentGate } from './components/ConsentGate.js';
import { connectBridge, hostSqlExecutor, callSidecar, isStandalone } from './bridge.js';

// Single db client over the host's SQL bridge. Every read and write in this
// file goes through it, so the pane's contents are whatever ikenga.db holds —
// state does not live in React and does not die with a reload.
const db = new MeetingsDbClient(hostSqlExecutor);

/** Budget for `sidecar transcribe`. Whisper runs at roughly 1× realtime on CPU
 *  for `small.en`, so an hour of meeting needs an hour of headroom; the host
 *  aborts the call at this limit and the run is lost, which is worse than
 *  waiting. Two hours covers any meeting this app is meant to record. */
const TRANSCRIBE_TIMEOUT_SECS = 7200;

type Phase = 'connecting' | 'ready' | 'unavailable';

export const App: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [speakers, setSpeakers] = useState<MeetingSpeaker[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConsentModal, setShowConsentModal] = useState<boolean>(false);
  const [hasConsent, setHasConsent] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ikenga_meetings_consent_acknowledged_v1') === 'true';
    } catch {
      return false;
    }
  });

  // Id of the meeting currently being captured. Held in a ref as well as in
  // the row, because the stop handler must reach it from inside a timer
  // callback that closed over an older render.
  const recordingIdRef = useRef<string | null>(null);

  // Track parent theme (pkgs own their theme by mirroring the shell's <html>).
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

  const refreshMeetings = useCallback(async () => {
    const rows = await db.listMeetings();
    setMeetings(rows);
    return rows;
  }, []);

  // ── Boot ────────────────────────────────────────────────────────────────
  //
  // Connect, then reconcile against reality before painting: a recording is a
  // detached ffmpeg process that survives this iframe being closed, reloaded,
  // or crashed. If one is still running we must re-attach to it rather than
  // show an idle recorder over a live microphone.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const conn = await connectBridge();
        if (cancelled) return;

        if (conn.mode === 'standalone') {
          setPhase('unavailable');
          return;
        }

        const rows = await refreshMeetings();
        if (cancelled) return;

        const inFlight = rows.find((m) => m.status === 'recording');
        if (inFlight) {
          const status = await callSidecar<{ state: string; elapsed_seconds: number }>([
            'status',
            '--meeting-id',
            inFlight.id,
          ]);
          if (cancelled) return;

          if (status.state === 'recording') {
            recordingIdRef.current = inFlight.id;
            setIsRecording(true);
            setElapsedSeconds(status.elapsed_seconds);
            setSelectedMeeting(inFlight);
          } else {
            // The row says "recording" but no recorder is alive — the app was
            // killed mid-session. Mark it failed so the list stops lying, and
            // leave the partial audio on disk for the user to transcribe.
            await db.updateMeetingStatus(inFlight.id, 'failed');
            await refreshMeetings();
          }
        }

        setPhase('ready');
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setPhase('unavailable');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshMeetings]);

  // Elapsed-time ticker. Derived from the recorder's own clock at boot and
  // then advanced locally; the sidecar remains the authority on whether a
  // recording is actually live.
  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => setElapsedSeconds((prev) => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  // Load a meeting's transcript when it is selected.
  useEffect(() => {
    let cancelled = false;
    if (!selectedMeeting) {
      setSegments([]);
      setSpeakers([]);
      return;
    }
    (async () => {
      try {
        const [segs, spk] = await Promise.all([
          db.listTranscriptSegments(selectedMeeting.id),
          db.listSpeakers(selectedMeeting.id),
        ]);
        if (cancelled) return;
        setSegments(segs);
        setSpeakers(spk);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMeeting?.id]);

  /**
   * Transcribe a finished recording and persist its segments.
   *
   * Separate from `handleStopRecording` because the audio outlives a failed
   * transcription: whisper can be abandoned by an MCP timeout, a shell reload,
   * or a crash, and in every one of those cases the WAV is still on disk and
   * fully recoverable. Stranding a 40-minute meeting because the STT step
   * failed once would be the worst possible outcome for this app, so the same
   * path is reachable again from the meeting list.
   */
  const runTranscription = useCallback(
    async (meetingId: string) => {
      setBusy('Transcribing (this runs locally and can take a while)…');
      await db.updateMeetingStatus(meetingId, 'transcribing');

      const result = await callSidecar<{ segments: TranscriptSegment[] }>(
        ['transcribe', '--meeting-id', meetingId],
        { timeoutSecs: TRANSCRIBE_TIMEOUT_SECS }
      );

      // Clear any partial run before inserting, so a retry cannot double up
      // the transcript.
      await db.deleteTranscriptSegments(meetingId);
      for (const segment of result.segments) {
        await db.insertTranscriptSegment(segment);
      }

      await db.updateMeetingStatus(meetingId, 'completed');
      const rows = await refreshMeetings();
      setSelectedMeeting(rows.find((m) => m.id === meetingId) ?? null);
      setSegments(await db.listTranscriptSegments(meetingId));
    },
    [refreshMeetings]
  );

  const handleRetryTranscription = async (meetingId: string) => {
    setError(null);
    try {
      await runTranscription(meetingId);
    } catch (err) {
      setError((err as Error).message);
      try {
        await db.updateMeetingStatus(meetingId, 'failed');
        await refreshMeetings();
      } catch {
        /* surfaced above */
      }
    } finally {
      setBusy(null);
    }
  };

  const handleStartRecording = async (title: string) => {
    if (!hasConsent) {
      setShowConsentModal(true);
      return;
    }
    setError(null);
    setBusy('Starting recorder…');

    const meetingId = crypto.randomUUID();
    const now = new Date().toISOString();
    const meeting: Meeting = {
      id: meetingId,
      title,
      platform: 'local_recording',
      status: 'recording',
      start_time: now,
      duration_seconds: 0,
      created_at: now,
      updated_at: now,
    };

    try {
      // Start the recorder BEFORE writing the row. If capture cannot start
      // (no audio device, ffmpeg missing) we must not leave a "recording" row
      // behind that no process backs — the boot reconciler would then have to
      // clean up a meeting that never existed.
      const started = await callSidecar<{ audio_path: string }>([
        'start',
        '--meeting-id',
        meetingId,
      ]);

      await db.insertMeeting({ ...meeting, audio_path: started.audio_path });
      recordingIdRef.current = meetingId;
      setElapsedSeconds(0);
      setIsRecording(true);
      setSelectedMeeting({ ...meeting, audio_path: started.audio_path });
      setSegments([]);
      setSpeakers([]);
      await refreshMeetings();
    } catch (err) {
      setError(`Could not start recording: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleStopRecording = async () => {
    const meetingId = recordingIdRef.current;
    if (!meetingId) return;

    setError(null);
    setBusy('Finalizing recording…');
    setIsRecording(false);

    try {
      const stopped = await callSidecar<{ duration_seconds: number; audio_path: string }>([
        'stop',
        '--meeting-id',
        meetingId,
      ]);
      recordingIdRef.current = null;

      await db.updateMeetingStatus(meetingId, 'transcribing', {
        end_time: new Date().toISOString(),
        duration_seconds: stopped.duration_seconds,
        audio_path: stopped.audio_path,
      });
      await refreshMeetings();

      await runTranscription(meetingId);
    } catch (err) {
      // The audio is already safely on disk at this point, so a transcription
      // failure marks the meeting failed rather than discarding the recording.
      setError(`${(err as Error).message}`);
      try {
        await db.updateMeetingStatus(meetingId, 'failed');
        await refreshMeetings();
      } catch {
        /* surfaced above */
      }
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    setError(null);
    try {
      await db.deleteMeetingCascade(meetingId);
      if (selectedMeeting?.id === meetingId) {
        setSelectedMeeting(null);
        setSegments([]);
        setSpeakers([]);
      }
      await refreshMeetings();
    } catch (err) {
      setError((err as Error).message);
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

  const acceptConsent = () => {
    try {
      localStorage.setItem('ikenga_meetings_consent_acknowledged_v1', 'true');
    } catch {
      // A blocked localStorage costs the user a re-acknowledgement per session,
      // which is acceptable; failing the gate open is not.
    }
    setHasConsent(true);
    setShowConsentModal(false);
  };

  if (phase !== 'ready') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          height: '100vh',
          backgroundColor: 'var(--ik-background, #0d0d12)',
          color: 'var(--ik-text-secondary, #9ca3af)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        {phase === 'connecting' ? (
          <span>Connecting to Ikenga…</span>
        ) : (
          <>
            <strong style={{ color: 'var(--ik-text-primary, #fff)' }}>
              {isStandalone() ? 'Open Meetings inside Ikenga' : 'Meetings is unavailable'}
            </strong>
            <span style={{ maxWidth: '38rem' }}>
              {error ??
                'This app records and transcribes on your machine, so it needs the Ikenga shell for database and recorder access.'}
            </span>
          </>
        )}
      </div>
    );
  }

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
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>🎙️ Ikenga Meetings</h1>
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
          busy={busy}
        />

        {error && (
          <div
            role="alert"
            style={{
              padding: '0.6rem 0.9rem',
              borderRadius: '6px',
              border: '1px solid #7f1d1d',
              backgroundColor: 'rgba(127, 29, 29, 0.25)',
              color: '#fca5a5',
              fontSize: '0.85rem',
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
            }}
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontWeight: 700,
              }}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: selectedMeeting ? '360px 1fr' : '1fr',
          gap: '1rem',
          overflow: 'hidden',
        }}
      >
        <MeetingList
          meetings={meetings}
          selectedMeetingId={selectedMeeting?.id}
          onSelectMeeting={(m) => setSelectedMeeting(m)}
          onDeleteMeeting={handleDeleteMeeting}
          onRetryTranscription={handleRetryTranscription}
          busy={busy !== null}
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
          onAccept={acceptConsent}
          onCancel={() => setShowConsentModal(false)}
        />
      )}
    </div>
  );
};
