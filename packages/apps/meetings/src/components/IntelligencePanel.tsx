import React, { useState } from 'react';
import { MeetingSummary, MeetingActionItem } from '@ikenga/meetings-contract';

export interface IntelligencePanelProps {
  summary?: MeetingSummary | null;
  actionItems: MeetingActionItem[];
  onSyncToTasks?: (selectedItems: MeetingActionItem[]) => Promise<void>;
}

export const IntelligencePanel: React.FC<IntelligencePanelProps> = ({
  summary,
  actionItems,
  onSyncToTasks,
}) => {
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => {
    return new Set(actionItems.filter((a) => a.status === 'pending').map((a) => a.id));
  });
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncedSuccess, setSyncedSuccess] = useState<boolean>(false);

  const toggleItem = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = async () => {
    if (!onSyncToTasks) return;
    const selected = actionItems.filter((a) => selectedItemIds.has(a.id));
    if (selected.length === 0) return;

    setSyncing(true);
    try {
      await onSyncToTasks(selected);
      setSyncedSuccess(true);
      setTimeout(() => setSyncedSuccess(false), 3000);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        backgroundColor: 'var(--ik-surface, #14141a)',
        borderRadius: '8px',
        border: '1px solid var(--ik-border, #282834)',
        padding: '1.25rem',
      }}
    >
      {/* Executive Summary */}
      <div>
        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 600, color: '#f3f4f6' }}>
          📋 Executive Summary
        </h3>
        <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5, color: '#d1d5db' }}>
          {summary?.executive_summary ?? 'Summary will be generated once transcription completes.'}
        </p>
      </div>

      {/* Key Decisions */}
      {summary?.key_decisions && summary.key_decisions.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '0.9rem', fontWeight: 600, color: '#93c5fd' }}>
            🔒 Key Decisions
          </h4>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.85rem', color: '#e2e8f0', lineHeight: 1.4 }}>
            {summary.key_decisions.map((dec, i) => (
              <li key={i}>{dec}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Items & Task Export */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f3f4f6' }}>
            ✅ Action Items
          </h3>
          {onSyncToTasks && (
            <button
              type="button"
              disabled={syncing || selectedItemIds.size === 0}
              onClick={handleExport}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: selectedItemIds.size > 0 ? '#2563eb' : '#374151',
                color: '#fff',
                fontSize: '0.8rem',
                fontWeight: 500,
                cursor: selectedItemIds.size > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              {syncing ? 'Syncing...' : `Export to Tasks (${selectedItemIds.size})`}
            </button>
          )}
        </div>

        {syncedSuccess && (
          <div style={{ fontSize: '0.8rem', color: '#34d399', marginBottom: '0.5rem' }}>
            ✓ Successfully synced to Tasks!
          </div>
        )}

        {actionItems.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>No action items identified.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {actionItems.map((item) => (
              <label
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.4rem 0.6rem',
                  borderRadius: '4px',
                  backgroundColor: '#1c1c24',
                  fontSize: '0.85rem',
                  color: '#e5e7eb',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedItemIds.has(item.id)}
                  onChange={() => toggleItem(item.id)}
                  disabled={item.status === 'synced_to_tasks'}
                />
                <span style={{ flex: 1 }}>{item.title}</span>
                {item.assignee && (
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>@{item.assignee}</span>
                )}
                <span
                  style={{
                    fontSize: '0.7rem',
                    padding: '0.1rem 0.35rem',
                    borderRadius: '3px',
                    backgroundColor: item.status === 'synced_to_tasks' ? '#064e3b' : '#374151',
                    color: item.status === 'synced_to_tasks' ? '#34d399' : '#9ca3af',
                  }}
                >
                  {item.status}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
