/**
 * STT provider abstraction (WP-19, D-17).
 *
 * Three backends behind one choice, made once globally and overridable per
 * meeting:
 *   - 'engine'  — the shell's configured agent, queried by capability
 *                 (`AcpPromptCapabilities.audio`), never hardcoded to a named
 *                 agent. Verified 2026-09-03: no shipped engine (Claude Code,
 *                 OpenCode, Pi) advertises `audio: true` — they all wrap
 *                 text-only CLIs — so this is the forward-looking branch and
 *                 currently always reports unavailable. See
 *                 `getEngineAudioCapability` in `../../bridge.ts`.
 *   - 'openai'  — OpenAI's Whisper API, user-supplied key.
 *   - 'local'   — whisper.cpp on this machine (WP-20 handles acquisition).
 *
 * 'local' is the only backend that keeps the pane's "everything stays on
 * disk" claim true. The other two are cloud paths and MUST surface a
 * disclosure before anything is sent — see `sttProviderIsCloud` below and
 * `SttPicker.tsx`.
 */

export type SttProviderId = 'local' | 'openai' | 'engine';

export const STT_PROVIDER_IDS: SttProviderId[] = ['local', 'openai', 'engine'];

export function isSttProviderId(value: unknown): value is SttProviderId {
  return value === 'local' || value === 'openai' || value === 'engine';
}

export const STT_PROVIDER_LABELS: Record<SttProviderId, string> = {
  local: 'Local whisper',
  openai: 'OpenAI Whisper API',
  engine: "Shell's configured engine",
};

export const STT_PROVIDER_DESCRIPTIONS: Record<SttProviderId, string> = {
  local: 'Runs whisper.cpp on this machine. Nothing leaves the machine.',
  openai: "Sends this meeting's audio to OpenAI's Whisper API using your API key.",
  engine:
    "Sends this meeting's audio to whichever agent the shell is configured with, if that agent accepts audio input.",
};

/** Whether audio or transcript text for this provider is sent off-machine. */
export function sttProviderIsCloud(id: SttProviderId): boolean {
  return id === 'openai' || id === 'engine';
}

export interface SttProviderState {
  id: SttProviderId;
  /** Whether this backend can be selected right now, based on a real check —
   *  never a hardcoded guess. For 'local' and 'openai' this always reports
   *  true: both are legitimate choices before their prerequisites (model
   *  download, API key) are satisfied, which the app prompts for separately.
   *  For 'engine' this reflects a live capability query. */
  available: boolean;
  /** Human-readable reason shown next to a disabled/unready option. */
  reason?: string;
}
