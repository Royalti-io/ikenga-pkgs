/**
 * WP-15 — read a calendar from a private `.ics` feed (D-22).
 *
 * ── Why a feed URL and not OAuth ──────────────────────────────────────────
 *
 * The workspace already has a `calendar_events` table, but it is filled by a
 * cron in a different monorepo. For anyone installing this pkg from the
 * registry it would be empty forever — a feature dead for every external user.
 * Nearly every calendar system (Google, Outlook, Fastmail, Nextcloud) exposes a
 * secret ICS URL, so this generalises with no OAuth flow and no refresh token to
 * store badly while the vault gap (WP-25) is open.
 *
 * ── Why this lives in the sidecar ─────────────────────────────────────────
 *
 * `host.fetch` enforces the manifest's `permissions.net` allowlist Rust-side in
 * `pkg_fetch`, and a user's calendar host cannot be known at build time. Per
 * D-23 that allowlist is iframe-mediated by design, so fetching from a backend
 * process is the intended shape rather than a way around it.
 *
 * ── Why a hand-rolled parser ──────────────────────────────────────────────
 *
 * We need four fields from VEVENTs — start, end, summary, and any join link.
 * A full RFC 5545 implementation (recurrence expansion, timezone databases,
 * alarms) is a large dependency for that, and this pkg ships its dependencies
 * to strangers. Recurring events are handled by the fact that most feeds
 * publish expanded instances; a RRULE we cannot expand is skipped rather than
 * guessed at, because a nudge for a meeting that is not happening is worse than
 * no nudge.
 */

export interface CalendarEvent {
  uid: string;
  title: string;
  /** ISO-8601. */
  startsAt: string;
  endsAt: string | null;
  /** First Meet/Zoom/Teams URL found in the event, if any. */
  joinUrl: string | null;
  /** True when the event has an unexpanded RRULE we deliberately skipped. */
  recurring: boolean;
}

/** Providers whose presence marks an event as a real call (D-21). */
const JOIN_URL_PATTERN =
  /https?:\/\/(?:[\w-]+\.)*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|whereby\.com|meet\.jit\.si)\/[^\s<>"']+/i;

export function findJoinUrl(...fields: Array<string | null | undefined>): string | null {
  for (const f of fields) {
    if (!f) continue;
    const m = f.match(JOIN_URL_PATTERN);
    if (m) return m[0].replace(/[.,;)\]]+$/, '');
  }
  return null;
}

/**
 * Undo RFC 5545 line folding.
 *
 * Long values are split across lines with a leading space or tab on
 * continuations. Join links are exactly the kind of long value that gets
 * folded, so skipping this step loses the thing we are looking for.
 */
export function unfoldIcs(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

/** Unescape the text escapes RFC 5545 defines for property values. */
export function unescapeIcsText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Parse an ICS date-time to ISO-8601.
 *
 * Handles the three forms feeds actually emit: UTC (`...Z`), floating local
 * time, and `VALUE=DATE` all-day. Returns null for anything else rather than
 * guessing — a mis-parsed time produces a nudge at the wrong moment, which
 * trains the user to distrust it.
 */
export function parseIcsDate(value: string, params: string): string | null {
  const v = value.trim();

  if (/^\d{8}$/.test(v) || /VALUE=DATE(?![-\w])/i.test(params)) {
    const d = v.slice(0, 8);
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00.000Z`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }

  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  // A floating time is interpreted in this machine's zone, which is what the
  // user means by "my calendar".
  const iso = z
    ? `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).toISOString();
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Parse a whole feed into events. Malformed VEVENTs are skipped, not thrown on. */
export function parseIcs(text: string): CalendarEvent[] {
  const lines = unfoldIcs(text);
  const events: CalendarEvent[] = [];

  let cur: Record<string, { value: string; params: string }> | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (t === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (t === 'END:VEVENT') {
      if (cur) {
        const ev = toEvent(cur);
        if (ev) events.push(ev);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const semi = left.indexOf(';');
    const name = (semi < 0 ? left : left.slice(0, semi)).toUpperCase();
    const params = semi < 0 ? '' : left.slice(semi + 1);
    cur[name] = { value, params };
  }

  return events;
}

function toEvent(
  props: Record<string, { value: string; params: string }>
): CalendarEvent | null {
  const start = props.DTSTART;
  if (!start) return null;
  const startsAt = parseIcsDate(start.value, start.params);
  if (!startsAt) return null;

  const end = props.DTEND;
  const endsAt = end ? parseIcsDate(end.value, end.params) : null;

  const title = unescapeIcsText(props.SUMMARY?.value ?? '').trim() || 'Untitled event';

  return {
    uid: props.UID?.value?.trim() || `${startsAt}-${title}`,
    title,
    startsAt,
    endsAt,
    joinUrl: findJoinUrl(
      props.SUMMARY?.value,
      unescapeIcsText(props.DESCRIPTION?.value ?? ''),
      props.LOCATION?.value,
      props['X-GOOGLE-CONFERENCE']?.value
    ),
    recurring: Boolean(props.RRULE),
  };
}

/**
 * Events that are worth nudging about, inside a window.
 *
 * D-21: a join link is what makes an event a meeting. On the reference calendar
 * only 3 of 102 entries qualified — the rest were tasks, reminders and focus
 * blocks, and nudging on those would teach the user to ignore the nudge.
 *
 * Unexpanded recurring events are excluded: we cannot know when the next
 * instance is without an RRULE engine, and a nudge for a meeting that is not
 * happening is worse than none.
 */
export function upcomingMeetings(
  events: CalendarEvent[],
  opts: { now?: Date; windowMinutes?: number } = {}
): CalendarEvent[] {
  const now = opts.now ?? new Date();
  const windowMs = (opts.windowMinutes ?? 5) * 60_000;

  return events
    .filter((e) => e.joinUrl && !e.recurring)
    .filter((e) => {
      const start = Date.parse(e.startsAt);
      if (Number.isNaN(start)) return false;
      const end = e.endsAt ? Date.parse(e.endsAt) : start + 60 * 60_000;
      // In the lead-up, or already under way — a late join still deserves the
      // nudge, which is the case a start-time-only trigger misses.
      return start - now.getTime() <= windowMs && now.getTime() < end;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
