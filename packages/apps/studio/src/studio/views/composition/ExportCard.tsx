// com.ikenga.studio · export card (C-A rail)
//
// idle → (pre-flight dialog) → running → done | error. Closes:
//  • `composition-export-output-path-hover-only` — the output path renders as
//    VISIBLE aria-live text with a Copy affordance (not a title tooltip).
//  • the fake-percentage smell — the real sidecar export reports no numeric
//    progress, so "running" is an honest INDETERMINATE bar, never a fabricated %.
//  • F7 — the done state repeats the silent-bed note when the export went out
//    video-only.
// No "Reveal in folder": there is no real host reveal-path seam (host.openFolder
// is a picker, not a reveal), so we surface Copy + the full path instead of
// faking a reveal — deferred to a future host.revealPath verb.

import { useState } from 'react';

import { baseName, copyText } from './format';

export type ExportUiState = 'idle' | 'running' | 'done' | 'error';

export interface ExportCardProps {
  state: ExportUiState;
  exportPath: string | null;
  wasSilent: boolean;
  errorMessage: string | null;
  metaLine: string; // "1920×1080 · 28.00s · H.264"
  composedAvailable: boolean;
  onExportClick: () => void;   // opens the pre-flight dialog
  onCancel: () => void;
  onExportAgain: () => void;
  onRetry: () => void;
  onPlayComposed: () => void;
}

export function ExportCard({
  state,
  exportPath,
  wasSilent,
  errorMessage,
  metaLine,
  composedAvailable,
  onExportClick,
  onCancel,
  onExportAgain,
  onRetry,
  onPlayComposed,
}: ExportCardProps) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    if (exportPath && (await copyText(exportPath))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <div className="comp-card">
      <header className="comp-card__head">
        <span className="kicker">Export</span>
        <span className="comp-card__meta">H.264</span>
      </header>
      <div className="comp-card__body">
        {state === 'idle' && (
          <>
            <button type="button" className="btn btn-sm comp-btn-primary comp-block" onClick={onExportClick}>
              ⤓ Export video
            </button>
            <div className="comp-export-meta">{metaLine}</div>
          </>
        )}

        {state === 'running' && (
          <div className="comp-progress">
            <div className="comp-progress__head">
              <span>Composing…</span>
              <span className="comp-dim">this can take a moment</span>
            </div>
            <div className="comp-ptrack comp-ptrack--indeterminate" role="progressbar" aria-label="Composing export" aria-valuetext="in progress">
              <i />
            </div>
            <button type="button" className="btn btn-sm btn-ghost comp-block" onClick={onCancel}>Cancel</button>
          </div>
        )}

        {state === 'done' && (
          <>
            <div className="comp-done-head">
              <span className="comp-check" aria-hidden="true">✓</span>
              <strong>Output ready</strong>
            </div>
            <div className="comp-pathbox" aria-live="polite">
              <code title={exportPath ?? ''}>{exportPath ? baseName(exportPath) : '—'}</code>
              <button
                type="button"
                className="btn btn-sm btn-ghost comp-pathbox__copy"
                onClick={doCopy}
                disabled={!exportPath}
                aria-label="Copy export path"
              >
                {copied ? '✓ Copied' : '⧉ Copy path'}
              </button>
            </div>
            {exportPath && <div className="comp-pathfull mono">{exportPath}</div>}
            {wasSilent && (
              <p className="comp-silent-note">
                <span aria-hidden="true">⚠</span>
                <span>Video-only — no audio bed was found for this preset.</span>
              </p>
            )}
            <div className="comp-export-actions">
              {composedAvailable && (
                <button type="button" className="btn btn-sm comp-btn-primary" onClick={onPlayComposed}>
                  ▶ Watch composed
                </button>
              )}
              <button type="button" className="btn btn-sm btn-ghost" onClick={onExportAgain}>Export again</button>
            </div>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="comp-errbox" role="alert">
              <strong>Export failed</strong>
              <span>{errorMessage ?? 'The render engine stopped before finishing. Nothing was written to disk.'}</span>
            </div>
            <button type="button" className="btn btn-sm comp-btn-primary comp-block" onClick={onRetry}>↻ Try again</button>
          </>
        )}
      </div>
    </div>
  );
}
