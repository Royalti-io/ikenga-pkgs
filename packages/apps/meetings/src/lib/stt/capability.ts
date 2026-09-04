/**
 * Real (not guessed) availability checks for each STT backend (WP-19).
 *
 * 'local' and 'openai' report `available: true` unconditionally — both are
 * legitimate choices before their prerequisites are satisfied (a downloaded
 * model, an API key), which the picker handles as a follow-up step rather
 * than a reason to hide the option. Their `reason` field still carries the
 * live readiness detail (e.g. "model not downloaded yet") for display.
 *
 * 'engine' is the one the plan calls out explicitly: its availability must
 * come from a real capability query, never a hardcoded guess. See
 * `getEngineAudioCapability` in `../../bridge.ts`.
 */

import { getEngineAudioCapability, sttStatus, type SttStatusResponse } from '../../bridge.js';
import type { SttProviderState } from './types.js';

export async function loadProviderStates(): Promise<SttProviderState[]> {
  const [engine, status] = await Promise.all([
    getEngineAudioCapability(),
    sttStatus().catch(
      (): SttStatusResponse => ({
        ok: false,
        local: { whisper_binary_available: false, model_downloaded: false, reason: undefined },
        openai: { configured: false },
      })
    ),
  ]);

  const localReady = status.local.whisper_binary_available && status.local.model_downloaded;

  return [
    {
      id: 'local',
      available: true,
      reason: localReady
        ? undefined
        : (status.local.reason ??
          (!status.local.whisper_binary_available
            ? 'whisper-cli not installed yet'
            : 'model not downloaded yet')),
    },
    {
      id: 'openai',
      available: true,
      reason: status.openai.configured ? undefined : 'no API key configured yet',
    },
    {
      id: 'engine',
      available: engine.available,
      reason: engine.reason,
    },
  ];
}
