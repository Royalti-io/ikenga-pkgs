// com.ikenga.studio · export pre-flight dialog (C-B graft)
//
// "Review what will be written before encoding." A real modal with a focus
// trap + Escape-to-close (closes the C-B a11y graft) that surfaces the silent-
// bed warning (F7) BEFORE the export runs. Never blocks export — the confirm
// button always proceeds ("Export anyway" when silent).

import { useEffect, useRef } from 'react';

export interface PreflightSpec {
  format: string;      // "MP4 · H.264"
  resolution: string;  // "1920 × 1080"
  duration: string;    // "28.0s · 30 fps"
  coverage: string;    // "6 of 6 rendered"
  fullyRendered: boolean;
}

export interface ExportPreflightDialogProps {
  open: boolean;
  spec: PreflightSpec;
  presetLabel: string;
  /** true when the chosen music preset has no bed on disk → silent export. */
  willBeSilent: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const FOCUSABLE = 'button, [href], select, input, [tabindex]:not([tabindex="-1"])';

export function ExportPreflightDialog({
  open,
  spec,
  presetLabel,
  willBeSilent,
  onCancel,
  onConfirm,
}: ExportPreflightDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const t = window.setTimeout(() => confirmRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Tab') {
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      restoreRef.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="comp-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="comp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="comp-dlg-title"
        aria-describedby="comp-dlg-sub"
      >
        <div className="comp-dialog__head">
          <div>
            <h3 id="comp-dlg-title" className="comp-dialog__title">Export composition</h3>
            <p id="comp-dlg-sub" className="comp-dialog__sub">Review what will be written before encoding.</p>
          </div>
        </div>
        <div className="comp-dialog__body">
          <dl className="comp-spec">
            <dt>Format</dt><dd>{spec.format}</dd>
            <dt>Resolution</dt><dd>{spec.resolution}</dd>
            <dt>Duration</dt><dd>{spec.duration}</dd>
            <dt>Cells</dt>
            <dd className={spec.fullyRendered ? undefined : 'comp-spec__warn'}>{spec.coverage}</dd>
          </dl>
          {willBeSilent && (
            <div className="comp-notice" role="status">
              <span aria-hidden="true">⚠</span>
              <span>
                <b>This export will be silent.</b> The “{presetLabel}” preset has no
                audio file on disk, so the video is exported without an audio track.
              </span>
            </div>
          )}
        </div>
        <div className="comp-dialog__foot">
          <button type="button" className="btn btn-sm" onClick={onCancel}>Cancel</button>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn-sm comp-btn-primary"
            onClick={onConfirm}
          >
            {willBeSilent ? 'Export anyway' : 'Export video'}
          </button>
        </div>
      </div>
    </div>
  );
}
