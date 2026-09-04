/**
 * Calendar feed configuration (WP-15 / D-22).
 *
 * ── On storing the URL here ───────────────────────────────────────────────
 *
 * An ICS feed URL is a bearer credential: anyone holding it can read the
 * calendar. It lives in `localStorage` for the same reason the consent flag and
 * the STT preferences do — no pkg can reach the shell's vault yet (WP-25), and
 * there is no host verb for durable settings at all.
 *
 * That is worse than a vault and better than the alternatives available: it is
 * scoped to this pane's origin, never leaves the machine, and is not written
 * into `ikenga.db` where every other pkg's backend could read it. The settings
 * UI says so plainly rather than implying the URL is protected.
 */

const FEED_KEY = 'ikenga_meetings_calendar_ics_url_v1';
const WINDOW_KEY = 'ikenga_meetings_calendar_window_minutes_v1';
const DISMISSED_KEY = 'ikenga_meetings_calendar_dismissed_v1';

/** How far ahead to look. Five minutes is enough warning to act on without
 *  being early enough to become wallpaper. */
export const DEFAULT_WINDOW_MINUTES = 5;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // A blocked localStorage costs the feature, not correctness — the nudge
    // simply never appears rather than the pane breaking.
  }
}

export function getIcsUrl(): string | null {
  const v = read(FEED_KEY);
  return v && v.trim() ? v.trim() : null;
}

export function setIcsUrl(url: string | null): void {
  write(FEED_KEY, url && url.trim() ? url.trim() : null);
}

export function getWindowMinutes(): number {
  const v = Number.parseInt(read(WINDOW_KEY) ?? '', 10);
  return Number.isFinite(v) && v > 0 && v <= 120 ? v : DEFAULT_WINDOW_MINUTES;
}

export function setWindowMinutes(minutes: number): void {
  write(WINDOW_KEY, String(minutes));
}

/**
 * Dismissals are per event UID, so declining one nudge does not silence the
 * next meeting — and are pruned by age so the list cannot grow without bound.
 */
export function isDismissed(uid: string): boolean {
  return loadDismissed()[uid] !== undefined;
}

export function dismiss(uid: string): void {
  const all = loadDismissed();
  all[uid] = Date.now();
  write(DISMISSED_KEY, JSON.stringify(prune(all)));
}

function loadDismissed(): Record<string, number> {
  try {
    const parsed = JSON.parse(read(DISMISSED_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? prune(parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function prune(all: Record<string, number>): Record<string, number> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const out: Record<string, number> = {};
  for (const [uid, at] of Object.entries(all)) {
    if (typeof at === 'number' && at > cutoff) out[uid] = at;
  }
  return out;
}
