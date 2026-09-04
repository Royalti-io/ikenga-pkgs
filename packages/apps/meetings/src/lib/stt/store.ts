/**
 * Client-side persistence for the STT provider choice (WP-19).
 *
 * Why localStorage and not `pkg_settings` / the shell vault: the MCP Apps
 * host bridge this iframe talks to (`src/bridge.ts`) exposes exactly three
 * verbs — `host.dbQuery`, `host.dbExec`, `host.pkgSidecarCall` — plus
 * whatever tools our own supervised MCP server names. There is no `host.*`
 * verb for `pkg_settings_get/set` or the Stronghold `secrets_*` commands;
 * those are plain Tauri commands the shell's own React app calls directly,
 * never bridged to a pkg iframe. So a value set through the pane cannot be
 * durably written to either store from here today — this is a real,
 * shell-side gap (see `manifest.json`'s `settings.schema` entries for the
 * fuller writeup), not a shortcut taken for convenience.
 *
 * localStorage is exactly what `CONSENT_KEY` in `App.tsx` already uses for
 * the same reason, and it is durable across reloads for this iframe's own
 * origin — good enough for a preference that is neither secret nor shared
 * across pkgs. The OpenAI API key itself never touches this file; see
 * `bridge.ts`'s `setOpenAiApiKey` / `mcp/src/secrets-store.ts`.
 */

import { isSttProviderId, type SttProviderId } from './types.js';

const DEFAULT_KEY = 'ikenga_meetings_stt_default_v1';
const OVERRIDE_PREFIX = 'ikenga_meetings_stt_override_v1:';
/** Separate from `CONSENT_KEY` — recording consent and disclosure of a cloud
 *  STT choice are different acknowledgements with different triggers. */
const CLOUD_DISCLOSURE_KEY_PREFIX = 'ikenga_meetings_stt_cloud_ack_v1:';

export function getDefaultProvider(): SttProviderId | null {
  try {
    const v = localStorage.getItem(DEFAULT_KEY);
    return isSttProviderId(v) ? v : null;
  } catch {
    return null;
  }
}

export function setDefaultProvider(id: SttProviderId): void {
  try {
    localStorage.setItem(DEFAULT_KEY, id);
  } catch {
    // Best-effort — a blocked store just means re-prompting on next launch,
    // not a broken app.
  }
}

export function getOverride(meetingId: string): SttProviderId | null {
  try {
    const v = localStorage.getItem(OVERRIDE_PREFIX + meetingId);
    return isSttProviderId(v) ? v : null;
  } catch {
    return null;
  }
}

export function setOverride(meetingId: string, id: SttProviderId | null): void {
  try {
    if (id === null) localStorage.removeItem(OVERRIDE_PREFIX + meetingId);
    else localStorage.setItem(OVERRIDE_PREFIX + meetingId, id);
  } catch {
    // Best-effort.
  }
}

/**
 * Resolve the effective provider for a meeting: its own override, else the
 * global default, else 'local'. 'local' as the fallback (rather than
 * treating "unset" as an error) is deliberate: it is the only backend that
 * keeps the "everything stays on disk" claim true, so an unconfigured app
 * degrades to the honest default rather than to a guess.
 */
export function resolveProvider(meetingId: string | null): SttProviderId {
  if (meetingId) {
    const override = getOverride(meetingId);
    if (override) return override;
  }
  return getDefaultProvider() ?? 'local';
}

/** Has the user acknowledged the "leaves this machine" disclosure for this
 *  provider before? Cloud providers require this to be true, freshly set,
 *  every time the resolved provider for a recording is cloud — see
 *  `SttPicker.tsx`'s confirm flow, which is the only writer. */
export function hasAcknowledgedCloudDisclosure(id: SttProviderId): boolean {
  try {
    return localStorage.getItem(CLOUD_DISCLOSURE_KEY_PREFIX + id) === 'true';
  } catch {
    return false;
  }
}

export function acknowledgeCloudDisclosure(id: SttProviderId): void {
  try {
    localStorage.setItem(CLOUD_DISCLOSURE_KEY_PREFIX + id, 'true');
  } catch {
    // Best-effort.
  }
}
