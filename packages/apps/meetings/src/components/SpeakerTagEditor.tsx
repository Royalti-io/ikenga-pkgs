import React, { useState } from 'react';
import { MeetingSpeaker } from '@ikenga/meetings-contract';

export interface SpeakerTagEditorProps {
  speaker: MeetingSpeaker;
  onSave: (updated: MeetingSpeaker) => void;
  onClose: () => void;
}

export const SpeakerTagEditor: React.FC<SpeakerTagEditorProps> = ({
  speaker,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState(speaker.name);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      ...speaker,
      name: name.trim(),
      speaker_source: 'manual', // Changing name explicitly tags as manual
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          backgroundColor: 'var(--ik-surface-elevated, #1f1f28)',
          border: '1px solid var(--ik-border, #333)',
          borderRadius: '8px',
          padding: '1.25rem',
          width: '320px',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          color: 'var(--ik-text-primary, #fff)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Rename Speaker</h3>
        <div>
          <label style={{ fontSize: '0.8rem', color: 'var(--ik-text-secondary, #aaa)', display: 'block', marginBottom: '0.25rem' }}>
            Speaker Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: '4px',
              border: '1px solid var(--ik-border, #444)',
              backgroundColor: 'var(--ik-surface, #121218)',
              color: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--ik-text-muted, #777)' }}>
          Renaming updates attribution source to <code>manual</code>.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.4rem 0.8rem',
              borderRadius: '4px',
              border: '1px solid var(--ik-border, #444)',
              backgroundColor: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            style={{
              padding: '0.4rem 1rem',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: 'var(--ik-primary, #3b82f6)',
              color: '#fff',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
};
