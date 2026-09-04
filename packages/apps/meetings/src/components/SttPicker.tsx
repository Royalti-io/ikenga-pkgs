import React, { useEffect, useState } from 'react';
import {
  STT_PROVIDER_DESCRIPTIONS,
  STT_PROVIDER_IDS,
  STT_PROVIDER_LABELS,
  sttProviderIsCloud,
  type SttProviderId,
  type SttProviderState,
} from '../lib/stt/types.js';
import { loadProviderStates } from '../lib/stt/capability.js';
import {
  acknowledgeCloudDisclosure,
  getDefaultProvider,
  getOverride,
  hasAcknowledgedCloudDisclosure,
  setDefaultProvider,
  setOverride,
} from '../lib/stt/store.js';
import { setOpenAiApiKey } from '../bridge.js';

export type SttPickerScope = 'default' | { meetingId: string };

export interface SttPickerProps {
  scope: SttPickerScope;
  onClose: () => void;
  /** First-run mode: no dismiss without choosing, different framing copy. */
  firstRun?: boolean;
}

const USE_DEFAULT = '__use_default__' as const;

/**
 * The STT backend picker (WP-19, D-17).
 *
 * Shown two ways: inline in the pane's empty state before a first-time
 * user's first recording (`firstRun`), and from a small header control at any
 * later point — either to change the global default (`scope: 'default'`) or
 * to override a single meeting (`scope: { meetingId }`).
 *
 * The disclosure requirement (D-16/D-17) is enforced here, not left to copy
 * elsewhere: selecting a cloud provider (`openai` or `engine`) requires an
 * explicit acknowledgement checkbox before Confirm is enabled, and that
 * acknowledgement is what `App.tsx` checks before it will stop calling
 * everything "local."
 */
export const SttPicker: React.FC<SttPickerProps> = ({ scope, onClose, firstRun = false }) => {
  const [states, setStates] = useState<SttProviderState[] | null>(null);
  const [selected, setSelected] = useState<SttProviderId | typeof USE_DEFAULT>(() => {
    if (scope !== 'default') {
      return getOverride(scope.meetingId) ?? USE_DEFAULT;
    }
    return getDefaultProvider() ?? 'local';
  });
  const [ackCloud, setAckCloud] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadProviderStates().then((s) => {
      if (!cancelled) setStates(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveId: SttProviderId =
    selected === USE_DEFAULT ? (getDefaultProvider() ?? 'local') : selected;
  const isCloud = sttProviderIsCloud(effectiveId);
  const needsAck = isCloud && !hasAcknowledgedCloudDisclosure(effectiveId);
  const openaiState = states?.find((s) => s.id === 'openai');
  const showKeyField = effectiveId === 'openai' && openaiState && Boolean(openaiState.reason);

  const canConfirm = !needsAck || ackCloud;

  const handleSaveKey = async () => {
    setKeyError(null);
    setSavingKey(true);
    try {
      await setOpenAiApiKey(apiKeyInput);
      setApiKeyInput('');
      const fresh = await loadProviderStates();
      setStates(fresh);
    } catch (err) {
      setKeyError((err as Error).message);
    } finally {
      setSavingKey(false);
    }
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    if (isCloud) acknowledgeCloudDisclosure(effectiveId);

    if (scope === 'default') {
      setDefaultProvider(selected === USE_DEFAULT ? 'local' : selected);
    } else {
      setOverride(scope.meetingId, selected === USE_DEFAULT ? null : selected);
    }
    onClose();
  };

  return (
    <div className="mtg-stt-overlay" role="dialog" aria-modal="true" aria-labelledby="stt-picker-title">
      <div className="mtg-stt-card">
        <h2 id="stt-picker-title" className="mtg-stt-title">
          {firstRun ? 'Choose how meetings get transcribed' : 'Transcription backend'}
        </h2>
        <p className="mtg-stt-intro">
          {firstRun
            ? 'Pick a default before your first recording. You can change it any time, and override it per meeting.'
            : scope === 'default'
              ? 'This is the default for new meetings. Any meeting can override it.'
              : 'Just for this meeting. Leave it on the default unless this one needs to stay local, or needs a specific backend.'}
        </p>

        <div className="mtg-stt-options">
          {scope !== 'default' && (
            <label className="mtg-stt-option">
              <input
                type="radio"
                name="stt-provider"
                checked={selected === USE_DEFAULT}
                onChange={() => setSelected(USE_DEFAULT)}
              />
              <div>
                <div className="mtg-stt-option-label">
                  Use default ({STT_PROVIDER_LABELS[getDefaultProvider() ?? 'local']})
                </div>
              </div>
            </label>
          )}

          {STT_PROVIDER_IDS.map((id) => {
            const state = states?.find((s) => s.id === id);
            const disabled = state ? !state.available : id === 'engine';
            return (
              <label
                key={id}
                className="mtg-stt-option"
                data-disabled={disabled || undefined}
              >
                <input
                  type="radio"
                  name="stt-provider"
                  checked={selected === id}
                  disabled={disabled}
                  onChange={() => setSelected(id)}
                />
                <div>
                  <div className="mtg-stt-option-label">
                    {STT_PROVIDER_LABELS[id]}
                    {sttProviderIsCloud(id) && <span className="mtg-chip mtg-chip--bad">cloud</span>}
                    {!sttProviderIsCloud(id) && <span className="mtg-chip mtg-chip--ok">local</span>}
                  </div>
                  <div className="mtg-stt-option-desc">{STT_PROVIDER_DESCRIPTIONS[id]}</div>
                  {state?.reason && <div className="mtg-stt-option-reason">{state.reason}</div>}
                </div>
              </label>
            );
          })}
        </div>

        {showKeyField && (
          <div className="mtg-stt-key">
            <label htmlFor="stt-openai-key">OpenAI API key</label>
            <div className="mtg-stt-key-row">
              <input
                id="stt-openai-key"
                type="password"
                autoComplete="off"
                placeholder="sk-..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
              <button
                type="button"
                className="mtg-btn"
                disabled={!apiKeyInput.trim() || savingKey}
                onClick={handleSaveKey}
              >
                {savingKey ? 'Saving…' : 'Save key'}
              </button>
            </div>
            {keyError && <div className="mtg-stt-key-error">{keyError}</div>}
            <p className="mtg-note">
              Saved unencrypted in a file readable only by your user account
              (<code>~/.ikenga/media/.meetings-stt/config.json</code>, mode 0600), because
              Ikenga has no vault a pkg can reach yet. It is sent only to OpenAI, only in
              the transcription request. If that is not good enough for your key, set{' '}
              <code>OPENAI_API_KEY</code> in the environment instead — it takes precedence
              and nothing is written to disk.
            </p>
          </div>
        )}

        {isCloud && (
          <label className="mtg-stt-ack">
            <input
              type="checkbox"
              checked={ackCloud || !needsAck}
              disabled={!needsAck}
              onChange={(e) => setAckCloud(e.target.checked)}
            />
            <span>
              I understand this meeting&apos;s audio and transcript will be sent to{' '}
              <strong>{STT_PROVIDER_LABELS[effectiveId]}</strong> — it does not stay on this
              machine.
            </span>
          </label>
        )}

        <div className="mtg-stt-actions">
          {!firstRun && (
            <button type="button" className="mtg-btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="mtg-btn mtg-btn--primary"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {firstRun ? 'Start recording' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};
