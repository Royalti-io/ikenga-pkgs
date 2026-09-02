import React, { useState, useEffect } from 'react';

export interface ConsentGateProps {
  /** Callback fired when user acknowledges and accepts the consent requirements */
  onAccept: () => void;
  /** Callback fired when user declines or cancels */
  onCancel?: () => void;
  /** Whether consent has already been acknowledged (persisted in local settings) */
  hasAcknowledged?: boolean;
  /** Child component rendered when consent is satisfied */
  children?: React.ReactNode;
}

const STORAGE_KEY = 'ikenga_meetings_consent_acknowledged_v1';

export const ConsentGate: React.FC<ConsentGateProps> = ({
  onAccept,
  onCancel,
  hasAcknowledged: propHasAcknowledged,
  children,
}) => {
  const [acknowledged, setAcknowledged] = useState<boolean>(() => {
    if (propHasAcknowledged !== undefined) return propHasAcknowledged;
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [checkedDisclosure, setCheckedDisclosure] = useState<boolean>(false);
  const [checkedJurisdiction, setCheckedJurisdiction] = useState<boolean>(false);

  useEffect(() => {
    if (propHasAcknowledged !== undefined) {
      setAcknowledged(propHasAcknowledged);
    }
  }, [propHasAcknowledged]);

  const handleConfirm = () => {
    if (checkedDisclosure && checkedJurisdiction) {
      try {
        localStorage.setItem(STORAGE_KEY, 'true');
        localStorage.setItem(
          'ikenga_meetings_consent_timestamp',
          new Date().toISOString()
        );
      } catch (err) {
        console.warn('Unable to persist consent flag in localStorage', err);
      }
      setAcknowledged(true);
      onAccept();
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
  };

  if (acknowledged) {
    return <>{children}</>;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-gate-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--ik-surface-elevated, #1e1e24)',
          color: 'var(--ik-text-primary, #ffffff)',
          borderRadius: '8px',
          maxWidth: '560px',
          width: '100%',
          padding: '1.5rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          border: '1px solid var(--ik-border, #33333e)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <span style={{ fontSize: '1.5rem' }}>🎙️</span>
          <h2 id="consent-gate-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
            Recording Consent & Disclosure Acknowledgment
          </h2>
        </div>

        <p style={{ fontSize: '0.9rem', color: 'var(--ik-text-secondary, #b3b3c2)', lineHeight: 1.5, margin: '0 0 1.25rem 0' }}>
          Ikenga Meetings records audio, video, and transcripts 100% locally on your machine.
          Before recording internal or external calls, you must comply with applicable wiretap,
          consent, and privacy laws.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
            <input
              type="checkbox"
              checked={checkedDisclosure}
              onChange={(e) => setCheckedDisclosure(e.target.checked)}
              style={{ marginTop: '0.2rem' }}
            />
            <span>
              <strong>In-Call Notice:</strong> I agree to verbally announce recording or ensure the AI notetaker bot displays its presence and posts notice in chat.
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
            <input
              type="checkbox"
              checked={checkedJurisdiction}
              onChange={(e) => setCheckedJurisdiction(e.target.checked)}
              style={{ marginTop: '0.2rem' }}
            />
            <span>
              <strong>All-Party Consent Compliance:</strong> I understand that several jurisdictions (e.g. California, Florida, UK/EU GDPR) require consent of all participants before recording.
            </span>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          {onCancel && (
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '4px',
                border: '1px solid var(--ik-border, #444)',
                backgroundColor: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={!checkedDisclosure || !checkedJurisdiction}
            onClick={handleConfirm}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: checkedDisclosure && checkedJurisdiction ? 'var(--ik-primary, #3b82f6)' : '#555',
              color: '#ffffff',
              fontWeight: 500,
              cursor: checkedDisclosure && checkedJurisdiction ? 'pointer' : 'not-allowed',
            }}
          >
            I Acknowledge & Enable Recording
          </button>
        </div>
      </div>
    </div>
  );
};
