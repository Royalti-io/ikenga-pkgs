// com.ikenga.studio · poster thumbnail (bytes-over-bridge → blob:), batched
//
// Review §2.5: Canvas's grid used to fire one render.read_poster round trip
// PER done tile (N+1), refetched again if Composition was open on the same
// records. This module owns a module-scope decoded-blob-URL cache keyed by
// recordId plus a batched fetch through the Wave-1 `render.list_posters` RPC
// (verified present end-to-end: sidecar render-runner.listPosters →
// index.ts's dispatch → mcp/src/tools/render.ts → real-mcp.ts's
// 'render.list_posters' case) — a grid mount now issues ONE call for every
// visible record instead of one per tile. `prefetchPosters()` is what Canvas
// calls with its full visible-tile list; `<CellPoster>` itself only reads the
// cache and falls back to a solo fetch (still through the same cache/batch
// machinery) for a lone caller that never went through a batch, e.g. a single
// clip opened outside a grid. Composition's timeline clips import the same
// `<CellPoster>` and so share this cache for free — no code there changes.
//
// Cache is capped at MAX_ENTRIES with LRU eviction (recency bumped on every
// read); an evicted entry's object URL is revoked so this can't leak. `b64`
// is `null` for a record with no poster yet or an unreadable file — a single
// missing poster never fails the batch (mirrors the mock's honest-null
// contract in __mocks__/mcp.ts).

import { useEffect, useReducer } from 'react';

import { getMcpClient } from '../../mcp-client';
import type { PosterEntry } from '../../mcp-types';
import { base64ToBlob } from './format';

export interface CellPosterProps {
  /** The finished render's record id, or null when the cell has no done render. */
  recordId: string | null;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}

// ─── shared cache (module scope — survives individual tile mount/unmount) ──

const MAX_ENTRIES = 50;

/** recordId → objectURL, or null for a confirmed miss. Map preserves
 *  insertion order, which doubles as the LRU chain: `bump()` re-inserts a key
 *  on every read/write so the oldest (least-recently-used) key is always
 *  `.keys().next().value`. */
const cache = new Map<string, string | null>();
const inFlight = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

function bump(recordId: string, url: string | null) {
  cache.delete(recordId);
  cache.set(recordId, url);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const oldestUrl = cache.get(oldest);
    if (oldestUrl) URL.revokeObjectURL(oldestUrl);
    cache.delete(oldest);
  }
}

function setCached(recordId: string, url: string | null) {
  const prev = cache.get(recordId);
  if (prev && prev !== url) URL.revokeObjectURL(prev);
  bump(recordId, url);
  listeners.get(recordId)?.forEach((fn) => fn());
}

function subscribe(recordId: string, onChange: () => void): () => void {
  let set = listeners.get(recordId);
  if (!set) {
    set = new Set();
    listeners.set(recordId, set);
  }
  set.add(onChange);
  return () => {
    set!.delete(onChange);
    if (set!.size === 0) listeners.delete(recordId);
  };
}

/** Batched fetch — skips ids already cached (hit or confirmed miss) or
 *  already in flight, so calling this redundantly (e.g. every adaptive-poll
 *  tick) costs nothing once the set has resolved. */
async function fetchBatch(recordIds: string[]): Promise<void> {
  const toFetch = [...new Set(recordIds)].filter((id) => !cache.has(id) && !inFlight.has(id));
  if (toFetch.length === 0) return;
  toFetch.forEach((id) => inFlight.add(id));
  try {
    const client = await getMcpClient();
    const { posters } = await client.callTool<{ posters: PosterEntry[] }>('render.list_posters', {
      record_ids: toFetch,
    });
    const seen = new Set<string>();
    for (const p of posters ?? []) {
      seen.add(p.recordId);
      const url = p.b64 ? URL.createObjectURL(base64ToBlob(p.b64, 'image/png')) : null;
      setCached(p.recordId, url);
    }
    // A record the batch didn't report back (shouldn't happen, but a future
    // caller must not re-request it every render) — cache an honest miss.
    for (const id of toFetch) if (!seen.has(id)) setCached(id, null);
  } catch {
    // render.list_posters unreachable (mock/standalone, transient sidecar
    // blip) — cache misses so every tile degrades to its status-text
    // fallback once instead of retrying on every render.
    for (const id of toFetch) setCached(id, null);
  } finally {
    toFetch.forEach((id) => inFlight.delete(id));
  }
}

/** Call once per grid render/mount with every currently-visible done record
 *  id (Canvas). Fire-and-forget — the cache + in-flight guard make repeat
 *  calls with an overlapping id set free. */
export function prefetchPosters(recordIds: string[]): void {
  void fetchBatch(recordIds);
}

export function CellPoster({ recordId, alt = '', className, style }: CellPosterProps) {
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!recordId) return;
    return subscribe(recordId, forceUpdate);
  }, [recordId]);

  useEffect(() => {
    if (!recordId || cache.has(recordId)) return;
    // Not covered by a grid's batch prefetch (a lone poster request) — fetch
    // it solo through the same cache/batch machinery.
    void fetchBatch([recordId]);
  }, [recordId]);

  if (!recordId) return null;
  const src = cache.get(recordId);
  if (!src) return null;
  return <img className={className} style={style} src={src} alt={alt} />;
}
