import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Meeting } from '@ikenga/meetings-contract';
import { formatClock } from '../lib/display.js';

export interface CommandPaletteProps {
  meetings: Meeting[];
  open: boolean;
  onClose: () => void;
  onPick: (meeting: Meeting) => void;
  onRetry: (meeting: Meeting) => void;
  onDelete: (meeting: Meeting) => void;
}

const STATUS_LABEL: Record<string, string> = {
  completed: 'done',
  recording: 'recording',
  transcribing: 'transcribing',
  failed: 'needs transcribing',
};

/**
 * The archive, behind ⌘K.
 *
 * D-01 removes the permanent meeting list on the argument that you open a
 * notetaker to deal with the call you just had, not to browse. That argument
 * only holds if reaching an older meeting is genuinely fast — so this has to
 * be a real search surface with keyboard navigation, not a dressed-up dropdown.
 * If it is slow or fiddly, the direction is wrong and the list should come back.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  meetings,
  open,
  onClose,
  onPick,
  onRetry,
  onDelete,
}) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // Focus after paint or the input is not in the document yet.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (STATUS_LABEL[m.status] ?? m.status).includes(q) ||
        m.platform.toLowerCase().includes(q)
    );
  }, [meetings, query]);

  useEffect(() => {
    if (cursor >= results.length) setCursor(Math.max(0, results.length - 1));
  }, [results.length, cursor]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[cursor];
      if (picked) {
        // A failed meeting has audio but no transcript, so the useful default
        // for Enter is "make this readable", not "open an empty page".
        if (picked.status === 'failed') onRetry(picked);
        else onPick(picked);
        onClose();
      }
    }
  };

  return (
    <div
      className="mtg-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Search meetings"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mtg-palette" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          placeholder="Search meetings…"
          aria-label="Search meetings"
        />

        <div className="mtg-results">
          {results.length === 0 ? (
            <div className="mtg-empty">
              {meetings.length === 0
                ? 'No meetings recorded yet.'
                : `Nothing matches “${query}”.`}
            </div>
          ) : (
            results.map((m, i) => (
              <button
                key={m.id}
                className="mtg-result"
                data-cursor={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  if (m.status === 'failed') onRetry(m);
                  else onPick(m);
                  onClose();
                }}
              >
                <span>
                  {m.title}
                  <span className="mtg-result-sub">
                    {new Date(m.start_time).toLocaleDateString()} ·{' '}
                    {formatClock(m.duration_seconds)} · {m.platform}
                  </span>
                </span>
                <span
                  className={
                    'mtg-chip ' +
                    (m.status === 'completed'
                      ? 'mtg-chip--ok'
                      : m.status === 'failed'
                        ? 'mtg-chip--bad'
                        : 'mtg-chip--busy')
                  }
                >
                  {STATUS_LABEL[m.status] ?? m.status}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
