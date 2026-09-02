import React, { useEffect, useState } from 'react';
import { MeetingActionItem, MeetingSummary } from '@ikenga/meetings-contract';

export interface DigestProps {
  summary: MeetingSummary | null;
  actionItems: MeetingActionItem[];
  /** Jump the player to where an item was committed to. */
  onSeek: (ms: number) => void;
  /** User-initiated export. Never fires on its own — see the note below. */
  onExport: (items: MeetingActionItem[]) => Promise<void>;
  busy: boolean;
}

/**
 * "What came out of it" — the meeting's output, placed ABOVE the transcript.
 *
 * This ordering is the whole point of the locked D-01 direction: after a call
 * you want the decisions and the commitments, and only then the evidence. The
 * transcript is the appendix, not the lede.
 *
 * Export is deliberately user-initiated and opt-in per item (D10 / WP-08). An
 * LLM writing straight into the task list content it may have misheard is the
 * wrong default, so nothing leaves this panel without a click.
 */
export const Digest: React.FC<DigestProps> = ({
  summary,
  actionItems,
  onSeek,
  onExport,
  busy,
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Default the selection to everything not already exported, and re-derive
  // when the meeting changes — otherwise a previous meeting's selection leaks
  // into the next one and the export button lies about what it will send.
  useEffect(() => {
    setSelected(
      new Set(actionItems.filter((a) => a.status !== 'synced_to_tasks').map((a) => a.id))
    );
  }, [actionItems]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chosen = actionItems.filter((a) => selected.has(a.id));

  if (!summary && actionItems.length === 0) return null;

  return (
    <section className="mtg-digest">
      <h2>What came out of it</h2>

      {summary?.executive_summary && <p className="mtg-summary">{summary.executive_summary}</p>}

      {summary?.key_decisions && summary.key_decisions.length > 0 && (
        <>
          <h2 style={{ fontSize: 'var(--text-body-sm)', color: 'var(--fg-muted)' }}>Decisions</h2>
          <ul style={{ margin: '0 0 var(--space-5)', paddingLeft: 'var(--space-5)' }}>
            {summary.key_decisions.map((d, i) => (
              <li key={i} style={{ color: 'var(--fg-muted)', marginBottom: 'var(--space-1)' }}>
                {d}
              </li>
            ))}
          </ul>
        </>
      )}

      {actionItems.length > 0 && (
        <>
          <div className="mtg-todo">
            {actionItems.map((item) => {
              const isSynced = item.status === 'synced_to_tasks';
              return (
                <button
                  key={item.id}
                  type="button"
                  className="mtg-item"
                  data-synced={isSynced}
                  onClick={() => !isSynced && toggle(item.id)}
                  disabled={isSynced}
                >
                  <span
                    className="mtg-box"
                    data-checked={isSynced || selected.has(item.id)}
                    aria-hidden="true"
                  >
                    {isSynced ? '✓' : selected.has(item.id) ? '✓' : ''}
                  </span>
                  <span className="mtg-item-text">{item.title}</span>
                  <span className="mtg-item-meta">
                    {item.assignee ? `${item.assignee} · ` : ''}
                    {isSynced ? 'in Tasks' : item.due_date ?? '—'}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            className="mtg-send"
            disabled={busy || chosen.length === 0}
            onClick={() => onExport(chosen)}
          >
            {chosen.length === 0
              ? 'Nothing selected'
              : `Send ${chosen.length} item${chosen.length === 1 ? '' : 's'} to Tasks`}
          </button>
        </>
      )}
    </section>
  );
};
