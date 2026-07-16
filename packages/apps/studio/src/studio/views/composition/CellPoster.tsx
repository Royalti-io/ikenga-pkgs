// com.ikenga.studio · best-effort poster thumbnail (bytes-over-bridge → blob:)
//
// Mirrors CellVideo's read_bytes fetch, but for the poster PNG the sidecar
// extracts when a render finishes (render.read_poster → base64 → Blob → blob:
// URL). Used by Canvas grid tiles + Composition timeline clips to show real
// pixels for done cells without loading the full video. Degrades to null when
// no poster exists (mock/standalone mode, extraction failed, or the render
// predates the poster seam) — the caller shows the status-text fallback then.

import { useEffect, useState } from 'react';

import { getMcpClient, renderApi } from '../../mcp-client';
import { base64ToBlob } from './format';

export interface CellPosterProps {
  /** The finished render's record id, or null when the cell has no done render. */
  recordId: string | null;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function CellPoster({ recordId, alt = '', className, style }: CellPosterProps) {
  const [src, setSrc] = useState<string | null>(null);

  // Fetch poster bytes → objectURL whenever the render record changes.
  useEffect(() => {
    if (!recordId) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const client = await getMcpClient();
        const poster = await renderApi.read_poster(client, recordId);
        if (cancelled) return;
        if (!poster.base64) {
          // Mock mode, the running MCP server predates render.read_poster, or
          // poster extraction failed — degrade to null (status-text fallback).
          setSrc(null);
          return;
        }
        url = URL.createObjectURL(base64ToBlob(poster.base64, poster.mime));
        setSrc(url);
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [recordId]);

  if (!src) return null;
  return <img className={className} style={style} src={src} alt={alt} />;
}
