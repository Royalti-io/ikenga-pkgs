import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIcs,
  parseIcsDate,
  unfoldIcs,
  findJoinUrl,
  upcomingMeetings,
} from './ics.js';

/** A feed in the shape Google actually emits, including a folded join URL. */
const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:evt-call@example.com',
  'DTSTART:20260904T140000Z',
  'DTEND:20260904T150000Z',
  'SUMMARY:Q3 distribution sync',
  'DESCRIPTION:Join here: https://meet.google.com/abc-defg-',
  ' hij more text',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:evt-focus@example.com',
  'DTSTART:20260904T160000Z',
  'DTEND:20260904T170000Z',
  'SUMMARY:Focus block',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:evt-allday@example.com',
  'DTSTART;VALUE=DATE:20260905',
  'SUMMARY:Someone\\, birthday',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('ics unfolding', () => {
  it('rejoins folded continuation lines', () => {
    // Join URLs are long and get folded — losing this loses the link entirely.
    const lines = unfoldIcs('DESCRIPTION:https://meet.google.com/abc-\r\n defg');
    assert.equal(lines[0], 'DESCRIPTION:https://meet.google.com/abc-defg');
  });
});

describe('ics dates', () => {
  it('parses UTC date-times', () => {
    assert.equal(parseIcsDate('20260904T140000Z', ''), '2026-09-04T14:00:00.000Z');
  });

  it('parses VALUE=DATE all-day entries', () => {
    assert.equal(parseIcsDate('20260905', 'VALUE=DATE'), '2026-09-05T00:00:00.000Z');
  });

  it('returns null for junk rather than guessing a time', () => {
    // A mis-parsed time nudges at the wrong moment, which teaches distrust.
    assert.equal(parseIcsDate('not-a-date', ''), null);
    assert.equal(parseIcsDate('', ''), null);
  });
});

describe('join links', () => {
  it('finds the major providers', () => {
    for (const u of [
      'https://meet.google.com/abc-defg-hij',
      'https://us02web.zoom.us/j/12345',
      'https://teams.microsoft.com/l/meetup-join/x',
    ]) {
      assert.equal(findJoinUrl(`Join: ${u}`), u, u);
    }
  });

  it('strips trailing punctuation that is not part of the URL', () => {
    assert.equal(
      findJoinUrl('Join at https://meet.google.com/abc-defg-hij.'),
      'https://meet.google.com/abc-defg-hij'
    );
  });

  it('returns null when there is no link', () => {
    assert.equal(findJoinUrl('Focus block', null, undefined), null);
  });
});

describe('parsing a feed', () => {
  const events = parseIcs(FEED);

  it('reads every VEVENT', () => {
    assert.equal(events.length, 3);
  });

  it('recovers a join URL that was folded across lines', () => {
    const call = events.find((e) => e.uid === 'evt-call@example.com');
    assert.equal(call?.joinUrl, 'https://meet.google.com/abc-defg-hij');
  });

  it('leaves non-meetings without a join link', () => {
    assert.equal(events.find((e) => e.uid === 'evt-focus@example.com')?.joinUrl, null);
  });

  it('unescapes text values', () => {
    assert.equal(events.find((e) => e.uid === 'evt-allday@example.com')?.title, 'Someone, birthday');
  });

  it('survives a malformed VEVENT instead of throwing', () => {
    const bad = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:no start\r\nEND:VEVENT\r\nEND:VCALENDAR';
    assert.deepEqual(parseIcs(bad), []);
  });
});

describe('what counts as an upcoming meeting', () => {
  const base = parseIcs(FEED);

  it('only surfaces events with a join link (D-21)', () => {
    const up = upcomingMeetings(base, { now: new Date('2026-09-04T13:58:00Z'), windowMinutes: 5 });
    assert.equal(up.length, 1);
    assert.equal(up[0]?.uid, 'evt-call@example.com');
  });

  it('says nothing when the meeting is still far off', () => {
    assert.equal(
      upcomingMeetings(base, { now: new Date('2026-09-04T10:00:00Z'), windowMinutes: 5 }).length,
      0
    );
  });

  it('still nudges once the meeting has started, for a late join', () => {
    const up = upcomingMeetings(base, { now: new Date('2026-09-04T14:30:00Z'), windowMinutes: 5 });
    assert.equal(up.length, 1);
  });

  it('stops once the meeting has ended', () => {
    assert.equal(
      upcomingMeetings(base, { now: new Date('2026-09-04T15:01:00Z'), windowMinutes: 5 }).length,
      0
    );
  });

  it('skips unexpanded recurring events rather than guessing the next instance', () => {
    const rec = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:r@example.com',
        'DTSTART:20260904T140000Z',
        'DTEND:20260904T150000Z',
        'RRULE:FREQ=WEEKLY',
        'SUMMARY:Weekly standup',
        'DESCRIPTION:https://meet.google.com/xyz-abcd-efg',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')
    );
    assert.equal(rec[0]?.recurring, true);
    assert.equal(
      upcomingMeetings(rec, { now: new Date('2026-09-04T13:58:00Z') }).length,
      0,
      'a nudge for a meeting that may not be happening is worse than none'
    );
  });
});
