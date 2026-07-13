// com.ikenga.studio · render-records truth surface (C-C graft)
//
// Makes render-poll freshness EXPLICIT (closes `composition-render-poll-lag`):
// a "Synced Ns ago" stamp + a manual Refresh, over a per-cell records table
// (engine / frames / length / finished-at / output path). One row per timeline
// cell, joined to its latest render record. Horizontally scrollable so it
// survives a narrow (v-split) pane.

import { useEffect, useState } from 'react';

import type { RenderRecord } from '../../mcp-types';
import type { TimelineClip } from '../../__mocks__/composition';
import {
  fmtClockTime,
  fmtRelative,
  fmtSeconds,
  engineLabel,
  baseName,
  copyText,
} from './format';

export interface RecordsPanelProps {
  clips: TimelineClip[];
  recordByUid: Record<string, RenderRecord>;
  lastSyncedAt: number | null;
  fps: number;
  refreshing: boolean;
  onRefresh: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  done: 'Rendered',
  running: 'Rendering',
  queued: 'Queued',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function RecordsPanel({
  clips,
  recordByUid,
  lastSyncedAt,
  fps,
  refreshing,
  onRefresh,
}: RecordsPanelProps) {
  // Tick once a second so the "Synced Ns ago" stamp stays live between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const [copied, setCopied] = useState<string | null>(null);
  const doCopy = async (path: string, key: string) => {
    if (await copyText(path)) {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
    }
  };

  const syncText = lastSyncedAt === null ? 'Not synced yet' : `Synced ${fmtRelative(lastSyncedAt, now)}`;

  return (
    <section className="comp-records" aria-label="Render records">
      <div className="comp-records__head">
        <span className="kicker">Render records</span>
        <span className="comp-sync" title="Render records refresh live while a render is in flight">
          <span className="comp-sync__dot" aria-hidden="true" />
          <span className="comp-sync__text" aria-live="polite">{syncText}</span>
        </span>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
          aria-label="Refresh render records now"
        >
          ↻ {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="comp-records__scroll">
        <table className="comp-qtable">
          <thead>
            <tr>
              <th scope="col">Cell</th>
              <th scope="col">Status</th>
              <th scope="col">Engine</th>
              <th scope="col" className="num" title="Derived: duration × 30 fps (durations are frame-quantized, so this is exact)">Frames</th>
              <th scope="col" className="num">Length</th>
              <th scope="col">Finished</th>
              <th scope="col">Output</th>
            </tr>
          </thead>
          <tbody>
            {clips.map((c) => {
              const rec = recordByUid[c.uid];
              const status = rec?.status ?? c.status;
              const frames = Math.round((c.duration_ms / 1000) * fps);
              const outPath = rec?.output?.uri;
              const key = `${c.uid}`;
              return (
                <tr key={c.uid} data-status={status ?? 'pending'}>
                  <th scope="row" className="comp-qtable__cell">
                    <span className="comp-swatch" data-accent={c.accent} aria-hidden="true" />
                    {c.beat}
                  </th>
                  <td>
                    <span className={`comp-qstatus is-${status ?? 'pending'}`}>
                      {status ? STATUS_LABEL[status] ?? status : 'Pending'}
                    </span>
                  </td>
                  <td>{rec ? engineLabel(rec.engine) : '—'}</td>
                  <td className="num">{status === 'done' ? frames : '—'}</td>
                  <td className="num">{fmtSeconds(c.duration_ms)}</td>
                  <td className="mono-cell">{fmtClockTime(rec?.finished_at)}</td>
                  <td className="comp-qtable__out">
                    {outPath ? (
                      <button
                        type="button"
                        className="comp-pathchip"
                        title={`Copy path — ${outPath}`}
                        aria-label={`Copy output path for ${c.beat}`}
                        onClick={() => doCopy(outPath, key)}
                      >
                        <code>{baseName(outPath)}</code>
                        <span className="comp-pathchip__ico" aria-hidden="true">
                          {copied === key ? '✓' : '⧉'}
                        </span>
                      </button>
                    ) : (
                      <span className="comp-dim">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
