// com.ikenga.studio · real per-cell video preview
//
// Closes `composition-no-real-playback-ever` for the per-cell path. The probe
// proved a `file://` render path is unloadable from a null-origin srcdoc pane
// (WebKitGTK, error 4) and the pkg-content HTTP route only serves `dist/`, so
// the one seam that plays real pixels+audio in-pane is bytes-over-the-bridge →
// Blob → `blob:` URL (`blob:` is the single media scheme in the studio CSP
// media-src that survives the sandboxed srcdoc). We fetch the finished render's
// bytes via `render.read_bytes` (a new studio-MCP tool, Wave-2 scope — no shell
// change), build an object URL, and drive a real `<video>`.
//
// The transport's mock clock stays the timeline authority (it sequences all N
// cells for the scrubber/ruler/filmstrip); this element mirrors it — currentTime
// tracks (playheadMs − clipStartMs), play/pause + mute follow the transport.
// Honest limit: each cell is its own mp4, so audio restarts at cell boundaries
// and this is a per-cell preview, not a single continuous composed stream (use
// "Composed" playback of the export for that).

import { useEffect, useRef, useState } from 'react';

import { getMcpClient, renderApi } from '../../mcp-client';
import { base64ToBlob } from './format';

export type CellVideoAvailability = 'loading' | 'ready' | 'unavailable' | 'error';

export interface CellVideoProps {
  /** The finished render's record id, or null when the active cell has no
   *  done render (parent shows the poster/status fallback instead). */
  recordId: string | null;
  playing: boolean;
  muted: boolean;
  /** Absolute playhead (ms) on the virtual timeline + this clip's start (ms). */
  playheadMs: number;
  clipStartMs: number;
  onAvailability?: (state: CellVideoAvailability) => void;
}

const DRIFT_RESYNC_S = 0.34; // resync currentTime when it drifts past this

export function CellVideo({
  recordId,
  playing,
  muted,
  playheadMs,
  clipStartMs,
  onAvailability,
}: CellVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const availabilityRef = useRef(onAvailability);
  availabilityRef.current = onAvailability;

  // Fetch bytes → objectURL whenever the active render changes.
  useEffect(() => {
    if (!recordId) {
      setSrc(null);
      availabilityRef.current?.('unavailable');
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    availabilityRef.current?.('loading');
    (async () => {
      try {
        const client = await getMcpClient();
        const bytes = await renderApi.read_bytes(client, recordId);
        if (cancelled) return;
        if (!bytes.base64) {
          // Mock mode, or the running MCP server predates render.read_bytes —
          // degrade to the poster/status fallback (never a fake player).
          setSrc(null);
          availabilityRef.current?.('unavailable');
          return;
        }
        url = URL.createObjectURL(base64ToBlob(bytes.base64, bytes.mime));
        setSrc(url);
      } catch {
        if (!cancelled) {
          setSrc(null);
          availabilityRef.current?.('unavailable');
        }
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [recordId]);

  // Play/pause + mute mirror the transport.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    v.muted = muted;
    if (playing) void v.play().catch(() => {});
    else v.pause();
  }, [playing, muted, src]);

  // Keep currentTime locked to the transport clock: always resync when paused,
  // and gently resync while playing only when drift exceeds the threshold (so
  // real playback stays smooth but scrubs land accurately).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    const offset = Math.max(0, (playheadMs - clipStartMs) / 1000);
    if (!playing) {
      if (Math.abs(v.currentTime - offset) > 0.05) v.currentTime = offset;
    } else if (Math.abs(v.currentTime - offset) > DRIFT_RESYNC_S) {
      v.currentTime = offset;
    }
  }, [playheadMs, clipStartMs, playing, src]);

  if (!src) return null;
  return (
    <video
      ref={videoRef}
      className="comp-cell-video"
      src={src}
      playsInline
      preload="auto"
      onCanPlay={() => availabilityRef.current?.('ready')}
      onError={() => availabilityRef.current?.('error')}
      aria-label="Cell preview"
    />
  );
}
