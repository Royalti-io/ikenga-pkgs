import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Meeting,
  MeetingActionItem,
  MeetingSummary,
  MeetingSpeaker,
  MeetingsDbClient,
  TranscriptSegment,
} from '@ikenga/meetings-contract';
import { ConsentGate } from './components/ConsentGate.js';
import { CommandPalette } from './components/CommandPalette.js';
import { Digest } from './components/Digest.js';
import { LiveRecording } from './components/LiveRecording.js';
import { MeetingStage } from './components/MeetingStage.js';
import { Transcript } from './components/Transcript.js';
import { summarizeMeetingTranscript } from './intelligence/summarizer.js';
import { syncActionItemsToTasks } from './intelligence/task-sync.js';
import {
  callSidecar,
  connectBridge,
  hostSqlExecutor,
  isStandalone,
  transcribeMeeting,
} from './bridge.js';

const db = new MeetingsDbClient(hostSqlExecutor);

/** Budget for supervised MCP transcribe tool. Whisper runs at roughly 1× realtime on CPU
 *  for `small.en`, so an hour of meeting needs an hour of headroom. Two hours
 *  covers any meeting this app is meant to record. */
const TRANSCRIBE_TIMEOUT_SECS = 7200;

const CONSENT_KEY = 'ikenga_meetings_consent_acknowledged_v1';

type Phase = 'connecting' | 'ready' | 'unavailable';

export const App: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [speakers, setSpeakers] = useState<MeetingSpeaker[]>([]);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [actionItems, setActionItems] = useState<MeetingActionItem[]>([]);

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [seekToMs, setSeekToMs] = useState<number | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [hasConsent, setHasConsent] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CONSENT_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const recordingIdRef = useRef<string | null>(null);

  // Pkgs own their theme by mirroring the shell's <html> attributes.
  useEffect(() => {
    const sync = () => {
      try {
        const parent = window.parent?.document?.documentElement;
        if (!parent) return;
        for (const attr of ['data-theme', 'data-mode', 'data-density']) {
          const v = parent.getAttribute(attr);
          if (v) document.documentElement.setAttribute(attr, v);
        }
      } catch {
        /* cross-origin fallback — keep our own defaults */
      }
    };
    sync();
    const t = setInterval(sync, 1000);
    return () => clearInterval(t);
  }, []);

  // ⌘K / Ctrl-K opens the archive. Stage has no permanent list, so this is the
  // only way to reach an older meeting — it has to be always live.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const refresh = useCallback(async () => {
    const rows = await db.listMeetings();
    setMeetings(rows);
    return rows;
  }, []);

  // ── Boot ────────────────────────────────────────────────────────────────
  //
  // Reconcile before painting: a recording is a detached ffmpeg process that
  // outlives this iframe. If one is still running we re-attach rather than show
  // an idle recorder over a hot microphone.
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

        const rows = await refresh();
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
            setRecording(true);
            setElapsed(status.elapsed_seconds);
            setSelected(inFlight);
          } else {
            // Row claims "recording" but nothing is alive — the app was killed
            // mid-session. Mark it failed so the list stops lying; the partial
            // audio stays on disk and stays transcribable.
            await db.updateMeetingStatus(inFlight.id, 'failed');
            await refresh();
          }
        } else if (rows.length > 0) {
          setSelected(rows[0]!);
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
  }, [refresh]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  /**
   * Derive and persist the meeting's intelligence (WP-08).
   *
   * Run once, after a transcript lands, rather than on every open: the
   * summariser is deterministic over the same segments, so recomputing on each
   * render would only burn cycles and churn rows.
   */
  const buildDigest = useCallback(async (meetingId: string, segs: TranscriptSegment[]) => {
    if (segs.length === 0) return;
    const existing = await db.getSummary(meetingId);
    if (existing) return;

    const { summary: sum, actionItems: acts } = summarizeMeetingTranscript(meetingId, segs);
    await db.insertSummary(sum);
    for (const a of acts) await db.insertActionItem(a);
    setSummary(sum);
    setActionItems(acts);
  }, []);

  // Load everything attached to the selected meeting.
  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setSegments([]); setSpeakers([]); setSummary(null); setActionItems([]);
      return;
    }
    (async () => {
      try {
        const [segs, spk, sum, acts] = await Promise.all([
          db.listTranscriptSegments(selected.id),
          db.listSpeakers(selected.id),
          db.getSummary(selected.id),
          db.listActionItems(selected.id),
        ]);
        if (cancelled) return;
        setSegments(segs);
        setSpeakers(spk);
        setSummary(sum);
        setActionItems(acts);
        setCurrentMs(0);

        // Backfill the digest for a transcript that predates WP-08, or whose
        // summarisation was interrupted. Without this, every meeting recorded
        // before the intelligence layer existed would show no summary and no
        // action items forever — the digest would only ever appear for
        // meetings transcribed after this shipped.
        if (!sum && segs.length > 0) {
          await buildDigest(selected.id, segs);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [selected?.id, buildDigest]);

  const runTranscription = useCallback(
    async (meetingId: string) => {
      setBusy('Transcribing locally…');
      await db.updateMeetingStatus(meetingId, 'transcribing');

      const result = await transcribeMeeting(meetingId, TRANSCRIBE_TIMEOUT_SECS);

      // Clear any partial run first so a retry replaces the transcript rather
      // than appending a second copy of every line.
      await db.deleteTranscriptSegments(meetingId);
      for (const seg of result.segments) await db.insertTranscriptSegment(seg);

      await db.updateMeetingStatus(meetingId, 'completed');
      const rows = await refresh();
      const updated = rows.find((m) => m.id === meetingId) ?? null;
      setSelected(updated);

      const segs = await db.listTranscriptSegments(meetingId);
      setSegments(segs);
      await buildDigest(meetingId, segs);
    },
    [refresh, buildDigest]
  );

  const startRecording = async () => {
    if (!hasConsent) { setConsentOpen(true); return; }
    setError(null);
    setBusy('Starting…');

    const meetingId = crypto.randomUUID();
    const now = new Date().toISOString();
    const title = `Recording — ${new Date().toLocaleString()}`;

    try {
      // Start the recorder BEFORE writing the row, so a capture failure never
      // leaves a "recording" row behind that no process backs.
      const started = await callSidecar<{ audio_path: string }>([
        'start', '--meeting-id', meetingId,
      ]);

      const meeting: Meeting = {
        id: meetingId, title, platform: 'local_recording', status: 'recording',
        start_time: now, duration_seconds: 0, created_at: now, updated_at: now,
        audio_path: started.audio_path,
      };
      await db.insertMeeting(meeting);
      recordingIdRef.current = meetingId;
      setElapsed(0);
      setRecording(true);
      setSelected(meeting);
      setSegments([]); setSpeakers([]); setSummary(null); setActionItems([]);
      await refresh();
    } catch (err) {
      setError(`Could not start recording: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const stopRecording = async () => {
    const meetingId = recordingIdRef.current;
    if (!meetingId) return;
    setError(null);
    setBusy('Finalizing…');
    setRecording(false);

    try {
      const stopped = await callSidecar<{ duration_seconds: number; audio_path: string }>([
        'stop', '--meeting-id', meetingId,
      ]);
      recordingIdRef.current = null;

      await db.updateMeetingStatus(meetingId, 'transcribing', {
        end_time: new Date().toISOString(),
        duration_seconds: stopped.duration_seconds,
        audio_path: stopped.audio_path,
      });
      await refresh();
      await runTranscription(meetingId);
    } catch (err) {
      // The audio is already safely on disk, so a transcription failure marks
      // the meeting failed rather than discarding the recording.
      setError((err as Error).message);
      try {
        await db.updateMeetingStatus(meetingId, 'failed');
        await refresh();
      } catch { /* surfaced above */ }
    } finally {
      setBusy(null);
    }
  };

  const retryTranscription = async (meeting: Meeting) => {
    setError(null);
    setSelected(meeting);
    try {
      await runTranscription(meeting.id);
    } catch (err) {
      setError((err as Error).message);
      try {
        await db.updateMeetingStatus(meeting.id, 'failed');
        await refresh();
      } catch { /* surfaced above */ }
    } finally {
      setBusy(null);
    }
  };

  const deleteMeeting = async (meeting: Meeting) => {
    setError(null);
    try {
      await db.deleteMeetingCascade(meeting.id);
      const rows = await refresh();
      if (selected?.id === meeting.id) setSelected(rows[0] ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const exportToTasks = async (items: MeetingActionItem[]) => {
    setError(null);
    setBusy('Sending to Tasks…');
    try {
      await syncActionItemsToTasks(items, hostSqlExecutor);
      for (const item of items) {
        await db.updateActionItemStatus(item.id, 'synced_to_tasks');
      }
      if (selected) setActionItems(await db.listActionItems(selected.id));
    } catch (err) {
      setError(`Could not export to Tasks: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const acceptConsent = () => {
    try {
      localStorage.setItem(CONSENT_KEY, 'true');
    } catch {
      // Blocked storage costs a re-acknowledgement per session, which is
      // acceptable; failing the gate open is not.
    }
    setHasConsent(true);
    setConsentOpen(false);
  };

  if (phase !== 'ready') {
    return (
      <div className="mtg-shell">
        <div className="mtg-centre">
          {phase === 'connecting' ? (
            <span>Connecting to Ikenga…</span>
          ) : (
            <div>
              <strong>
                {isStandalone() ? 'Open Meetings inside Ikenga' : 'Meetings is unavailable'}
              </strong>
              <p>
                {error ??
                  'This app records and transcribes on your machine, so it needs the Ikenga shell for database and recorder access.'}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mtg-shell">
      <header className="mtg-bar">
        <button className="mtg-search" onClick={() => setPaletteOpen(true)}>
          Search meetings <kbd>⌘K</kbd>
        </button>
        <div className="mtg-spacer" />
        {!recording && (
          <button
            className="mtg-btn mtg-btn--rec"
            onClick={startRecording}
            disabled={busy !== null}
          >
            <span className="mtg-dot" />
            {busy ?? 'Record'}
          </button>
        )}
      </header>

      {error && (
        <div className="mtg-alert" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {recording ? (
        <LiveRecording
          title={selected?.title ?? 'Recording'}
          elapsedSeconds={elapsed}
          onStop={stopRecording}
          busy={busy}
        />
      ) : selected ? (
        <main className="mtg-stage">
          <div className="mtg-inner">
            <MeetingStage
              meeting={selected}
              speakers={speakers}
              currentMs={currentMs}
              onTimeChange={setCurrentMs}
              seekToMs={seekToMs}
              onSeekHandled={() => setSeekToMs(null)}
            />
            <Digest
              summary={summary}
              actionItems={actionItems}
              onSeek={setSeekToMs}
              onExport={exportToTasks}
              busy={busy !== null}
            />
            <Transcript
              segments={segments}
              speakers={speakers}
              currentMs={currentMs}
              onSeek={setSeekToMs}
            />
          </div>
        </main>
      ) : (
        <div className="mtg-centre">
          <div>
            <strong>No meetings yet</strong>
            <p>
              Record starts capturing this machine — system audio and microphone
              together, so both sides of a call land in the tape. Everything stays
              on disk here; nothing is uploaded.
            </p>
          </div>
        </div>
      )}

      <CommandPalette
        meetings={meetings}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={setSelected}
        onRetry={retryTranscription}
        onDelete={deleteMeeting}
      />

      {consentOpen && (
        <ConsentGate
          hasAcknowledged={false}
          onAccept={acceptConsent}
          onCancel={() => setConsentOpen(false)}
        />
      )}
    </div>
  );
};
