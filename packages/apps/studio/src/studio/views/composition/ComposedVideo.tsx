// com.ikenga.studio · composed-export playback (the "watch the whole video" path)
//
// The composed strategy from the playback-seam probe: a single blob of the
// export mp4 (`export.read_bytes` → base64 → blob:), played with native
// controls as its own clock. This is the one place the user watches the real,
// continuous deliverable — audio bed, transitions and all — as opposed to the
// per-cell CellVideo preview. Self-contained: mounted only while composed mode
// is on, fetches on mount, revokes on unmount. Honest fallback: if bytes are
// unavailable (mock mode, or a running MCP server that predates the tool) it
// renders a plain notice instead of a fake player.

import { useEffect, useState } from 'react';

import { getMcpClient, exportApi } from '../../mcp-client';
import { base64ToBlob } from './format';

export interface ComposedVideoProps {
  exportId: string;
  muted: boolean;
  onExit: () => void;
}

export function ComposedVideo({ exportId, muted, onExit }: ComposedVideoProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setState('loading');
    (async () => {
      try {
        const client = await getMcpClient();
        const bytes = await exportApi.read_bytes(client, exportId);
        if (cancelled) return;
        if (!bytes.base64) {
          setState('unavailable');
          return;
        }
        url = URL.createObjectURL(base64ToBlob(bytes.base64, bytes.mime));
        setSrc(url);
        setState('ready');
      } catch {
        if (!cancelled) setState('unavailable');
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [exportId]);

  return (
    <div className="comp-composed">
      <div className="comp-composed__bar">
        <span className="kicker">Composed export</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onExit} aria-label="Back to timeline preview">
          ← Back to timeline
        </button>
      </div>
      {state === 'ready' && src ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video className="comp-composed__video" src={src} controls autoPlay muted={muted} playsInline aria-label="Composed export video" />
      ) : state === 'loading' ? (
        <div className="comp-composed__note">Loading composed video…</div>
      ) : (
        <div className="comp-composed__note">
          Composed preview isn’t available in this session. The export is on disk —
          copy its path from the Export panel to open it.
        </div>
      )}
    </div>
  );
}
