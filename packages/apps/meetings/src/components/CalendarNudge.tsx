import React, { useCallback, useEffect, useState } from 'react';
import { callSidecar } from '../bridge.js';
import { getIcsUrl, getWindowMinutes, isDismissed, dismiss } from '../lib/calendar/store.js';

export interface UpcomingMeeting {
  uid: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  join_url: string | null;
}

export interface CalendarNudgeProps {
  /** Starts a recording with this title. */
  onRecord: (title: string) => void;
  /** True while a recording is running or a transcription is in flight. */
  busy: boolean;
  /** Opens the calendar settings, for the not-configured case. */
  onConfigure: () => void;
}

const POLL_MS = 60_000;

/**
 * WP-15 — the nudge.
 *
 * D-19 made this a prompt, not an automation: it offers a one-click Record with
 * the title filled in, and a person still decides. Auto-recording was rejected
 * because a machine capturing audio with nobody in the loop contradicts the
 * consent gate, where the user attests they will tell the other participants.
 *
 * Deliberately renders NOTHING when no feed is configured — an empty banner
 * saying "no meetings" would be indistinguishable from "no calendar", and
 * silence that means two different things is this feature's main failure mode.
 * The distinction is made in settings, where it can be acted on.
 */
export const CalendarNudge: React.FC<CalendarNudgeProps> = ({ onRecord, busy, onConfigure }) => {
  const [upcoming, setUpcoming] = useState<UpcomingMeeting[]>([]);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    const url = getIcsUrl();
    if (!url) {
      setUpcoming([]);
      return;
    }
    try {
      const res = await callSidecar<{ upcoming: UpcomingMeeting[] }>(
        ['calendar-upcoming', '--ics-url', url, '--window', String(getWindowMinutes())],
        { timeoutSecs: 30 }
      );
      setUpcoming((res.upcoming ?? []).filter((m) => !isDismissed(m.uid)));
      setError(null);
    } catch (err) {
      // A failing feed must not nag on every poll — surface it once, quietly,
      // and keep trying. The user's calendar being briefly unreachable is not
      // an emergency.
      setError((err as Error).message);
      setUpcoming([]);
    }
  }, []);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  if (error) {
    return (
      <div className="mtg-nudge mtg-nudge--muted" role="status">
        <span>Couldn’t read your calendar feed.</span>
        <button className="mtg-btn" onClick={onConfigure}>
          Check settings
        </button>
      </div>
    );
  }

  const next = upcoming[0];
  if (!next) return null;

  const startsIn = Math.round((Date.parse(next.starts_at) - Date.now()) / 60_000);
  const when =
    startsIn > 0 ? `starts in ${startsIn} min` : startsIn === 0 ? 'starting now' : 'under way';

  return (
    <div className="mtg-nudge" role="status">
      <div className="mtg-nudge-text">
        <strong>{next.title}</strong>
        <span className="mtg-nudge-when">{when}</span>
      </div>
      <div className="mtg-nudge-actions">
        <button
          className="mtg-btn mtg-btn--rec"
          disabled={busy}
          onClick={() => onRecord(next.title)}
        >
          <span className="mtg-dot" />
          Record this
        </button>
        <button
          className="mtg-btn"
          onClick={() => {
            dismiss(next.uid);
            setUpcoming((u) => u.filter((m) => m.uid !== next.uid));
          }}
          aria-label={`Dismiss the nudge for ${next.title}`}
        >
          Not now
        </button>
      </div>
    </div>
  );
};
