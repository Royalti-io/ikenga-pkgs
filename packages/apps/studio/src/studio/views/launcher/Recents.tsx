// com.ikenga.studio · Launcher — recent projects panel
//
// Sourced from the REAL project.list() seam (audit: launcher-recents-static-
// fixture). Honesty rule: project.list returns a ProjectSummary (name / path /
// last-opened) with NO archetype / aspect / cell-count / render-coverage /
// exported-status for a project that isn't open, so those decorations are
// DROPPED here rather than faked — the archetype chip + cell/aspect meta render
// only when the row actually carries them (standalone/mock full-Project rows).
//
// States (audit: launcher-no-loading-skeleton + launcher-no-empty-state +
// launcher-create-open-no-error-handling): loading skeleton (aria-busy), empty
// with two teaching entry paths, error banner with Retry, ready rows.

import { useState } from 'react';

import { presentationFor } from '../../__mocks__/launcher';
import { Icon } from './icons';
import { accentStyle, formatAgo, type RecentRow } from './presentation';

/** Rows visible before the "Show all (N)" expander kicks in. */
const RECENTS_CAP = 8;

// A recent whose folder is gone from disk. Rendered dimmed + non-interactive
// with a "missing" chip — NO Open affordance, because opening a dead path just
// throws. There's no forget/delete-row seam in the sidecar (project.list is
// read-only; no project.forget), so "Remove from recents" is DEFERRED — the row
// simply dims + notes rather than offering a remove action.
function MissingRow({ row }: { row: RecentRow }) {
  return (
    <div
      aria-label={`${row.name} (folder missing)`}
      className="flex w-full items-center gap-3 px-4 py-3 text-left opacity-55"
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-soft text-fg-faint"
        style={{ background: 'var(--bg-raised)' }}
      >
        <Icon name="folder" size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-fg-muted line-through decoration-fg-faint/50">
            {row.name}
          </span>
          <span
            className="inline-flex flex-none items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px]"
            style={{ color: 'var(--danger)', background: 'var(--danger-soft)', borderColor: 'color-mix(in srgb, var(--danger) 40%, var(--border))' }}
          >
            missing
          </span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11.5px] text-fg-faint">
          {row.path && <span className="truncate">{row.path}</span>}
          <span>folder not found on disk</span>
        </span>
      </span>
    </div>
  );
}

function Row({ row, first, onOpen }: { row: RecentRow; first: boolean; onOpen: () => void }) {
  if (!row.exists) return <MissingRow row={row} />;

  const pres = row.archetype_id ? presentationFor(row.archetype_id) : null;
  const ago = formatAgo(row.lastOpened);
  const meta: string[] = [];
  if (typeof row.cellCount === 'number') meta.push(`${row.cellCount} cells`);
  if (row.aspect) meta.push(row.aspect);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${row.name}`}
      className={
        'group relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised ' +
        (first ? 'bg-[color-mix(in_srgb,var(--primary-soft)_38%,var(--bg-surface))]' : '')
      }
    >
      {first && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r"
          style={{ background: 'var(--ember)' }}
        />
      )}
      <span
        aria-hidden="true"
        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border"
        style={pres ? accentStyle(pres.accent) : { borderColor: 'var(--border)', color: 'var(--fg-muted)', background: 'var(--bg-raised)' }}
      >
        <Icon name={pres?.icon ?? 'folder'} size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-fg">{row.name}</span>
          {pres && (
            <span
              className="inline-flex flex-none items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px]"
              style={accentStyle(pres.accent)}
            >
              <Icon name={pres.icon} size={10} />
              {row.archetype_id}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11.5px] text-fg-muted">
          {meta.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
          {row.path && <span className="truncate text-fg-faint">{row.path}</span>}
        </span>
      </span>
      <span className="flex flex-none flex-col items-end gap-1.5 text-right">
        {ago && <span className="whitespace-nowrap font-mono text-[11px] text-fg-faint">{ago}</span>}
        <span
          className={
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-semibold ' +
            (first
              ? 'text-[var(--primary-fg)]'
              : 'border-soft text-fg-muted group-hover:text-fg')
          }
          style={first ? { background: 'var(--primary)', borderColor: 'color-mix(in srgb, var(--primary) 70%, transparent)' } : undefined}
        >
          <Icon name="play" size={12} filled /> Open
        </span>
      </span>
    </button>
  );
}

export function Recents({
  loading,
  error,
  rows,
  onOpen,
  onOpenFolder,
  onNew,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  rows: RecentRow[];
  onOpen: (row: RecentRow) => void;
  onOpenFolder: () => void;
  onNew: () => void;
  onRetry: () => void;
}) {
  const count = loading ? '· …' : error ? '· —' : `· ${rows.length}`;

  return (
    <section
      className="overflow-hidden rounded-xl border border-soft bg-surface shadow-md"
      aria-labelledby="recents-heading"
    >
      <div className="flex items-center justify-between gap-3 border-b border-soft px-4 py-3">
        <h2
          id="recents-heading"
          className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-muted"
        >
          <Icon name="clock" size={13} />
          Recent projects
          <span className="text-fg-faint">{count}</span>
        </h2>
      </div>

      {loading ? (
        <div aria-busy="true" aria-live="polite">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b border-soft px-4 py-3 last:border-b-0">
              <div className="launcher-sk h-9 w-9 rounded-lg" />
              <div className="flex-1">
                <div className="launcher-sk h-3.5 w-1/2" />
                <div className="launcher-sk mt-2 h-2.5 w-3/4" />
              </div>
              <div className="launcher-sk h-6 w-16" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="flex items-start gap-3 p-4">
          <span
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border"
            style={{ color: 'var(--danger)', background: 'var(--danger-soft)', borderColor: 'color-mix(in srgb, var(--danger) 44%, var(--border))' }}
          >
            <Icon name="alert" size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg">Couldn&rsquo;t load recent projects</div>
            <p className="mt-0.5 text-xs text-fg-muted">
              The Studio engine didn&rsquo;t respond. Your projects are safe on disk — this is just the list.{' '}
              <span className="font-mono text-fg-faint">{error}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="flex flex-none items-center gap-1.5 rounded-md border border-soft px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg"
          >
            <Icon name="refresh" size={13} /> Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-9 text-center">
          <div
            className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-lg border border-soft text-fg-muted"
            style={{ background: 'var(--bg-raised)' }}
          >
            <Icon name="inbox" size={22} />
          </div>
          <h3 className="text-base font-semibold text-fg">No recent projects yet</h3>
          <p className="mx-auto mt-1.5 max-w-[40ch] text-sm text-fg-muted">
            Nothing has been opened on this desk. There are two ways to get a project going:
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={onOpenFolder}
              className="max-w-[230px] flex-1 rounded-lg border border-soft bg-raised p-3.5 text-left transition-transform hover:-translate-y-0.5 hover:border-[var(--chip-carve)]"
            >
              <span
                className="mb-2 flex h-8 w-8 items-center justify-center rounded-md border"
                style={{ color: 'var(--primary-fg)', background: 'var(--primary-soft)', borderColor: 'color-mix(in srgb, var(--primary) 40%, var(--border))' }}
              >
                <Icon name="folder" size={16} />
              </span>
              <span className="block text-[13.5px] font-semibold text-fg">Open a folder</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Point Studio at an existing project folder on disk.
              </span>
            </button>
            <button
              type="button"
              onClick={onNew}
              className="max-w-[230px] flex-1 rounded-lg border border-soft bg-raised p-3.5 text-left transition-transform hover:-translate-y-0.5 hover:border-[var(--chip-carve)]"
            >
              <span
                className="mb-2 flex h-8 w-8 items-center justify-center rounded-md border"
                style={{ color: 'var(--primary-fg)', background: 'var(--primary-soft)', borderColor: 'color-mix(in srgb, var(--primary) 40%, var(--border))' }}
              >
                <Icon name="plus" size={16} />
              </span>
              <span className="block text-[13.5px] font-semibold text-fg">New from a template</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                Seed beats &amp; cells from an archetype below.
              </span>
            </button>
          </div>
        </div>
      ) : (
        <RecentList rows={rows} onOpen={onOpen} />
      )}
    </section>
  );
}

/** The ready-state list: caps at RECENTS_CAP rows behind a "Show all (N)"
 *  expander, and highlights the first OPENABLE (exists) row for Resume rather
 *  than blindly index 0 (which could be a missing row). */
function RecentList({ rows, onOpen }: { rows: RecentRow[]; onOpen: (row: RecentRow) => void }) {
  const [expanded, setExpanded] = useState(false);
  const firstOpenableIdx = rows.findIndex((r) => r.exists);
  const visible = expanded ? rows : rows.slice(0, RECENTS_CAP);
  const hidden = rows.length - visible.length;

  return (
    <div>
      {visible.map((r, i) => (
        <div key={r.id} className="border-b border-soft last:border-b-0">
          <Row row={r} first={i === firstOpenableIdx} onOpen={() => onOpen(r)} />
        </div>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-center gap-1.5 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-muted hover:bg-raised hover:text-fg"
        >
          <Icon name="chevron" size={13} /> Show all ({rows.length})
        </button>
      )}
    </div>
  );
}
