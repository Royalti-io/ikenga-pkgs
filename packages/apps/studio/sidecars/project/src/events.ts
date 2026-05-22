/**
 * Typed `pkg://com.ikenga.studio/*` event payloads + an `emit()` helper that
 * writes JSON-RPC notification frames to stdout.
 *
 * Wire shape (one JSON object per line, no `id` for notifications):
 *   {
 *     "jsonrpc": "2.0",
 *     "method": "event",
 *     "params": { topic, projectId, payload, ts }
 *   }
 */

export const TOPIC_CELLS_CHANGED = 'pkg://com.ikenga.studio/cells/changed' as const;
export const TOPIC_RENDER_PROGRESS = 'pkg://com.ikenga.studio/render/progress' as const;
export const TOPIC_RENDER_DONE = 'pkg://com.ikenga.studio/render/done' as const;

export type EventTopic =
  | typeof TOPIC_CELLS_CHANGED
  | typeof TOPIC_RENDER_PROGRESS
  | typeof TOPIC_RENDER_DONE;

export interface CellsChangedPayload {
  cellId: string;
  kind: 'created' | 'updated' | 'deleted';
  path: string;
}

export interface RenderProgressPayload {
  recordId: string;
  cellId: string;
  engine: string;
  /** 0..1 */
  progress: number;
  frame?: number;
  /**
   * Discriminates per-cell renders from full-composition exports (WP-07c).
   * Defaults to 'render' when absent so existing consumers are unaffected.
   * Export progress carries `kind: 'export'`; `cellId` is the exportId and
   * `engine` is the literal 'export' for those frames.
   */
  kind?: 'render' | 'export';
}

export interface RenderDonePayload {
  recordId: string;
  cellId: string;
  engine: string;
  status: 'done' | 'failed' | 'cancelled';
  outputPath?: string;
  error?: string;
  /** See RenderProgressPayload.kind. */
  kind?: 'render' | 'export';
}

export type EventPayload =
  | { topic: typeof TOPIC_CELLS_CHANGED; payload: CellsChangedPayload }
  | { topic: typeof TOPIC_RENDER_PROGRESS; payload: RenderProgressPayload }
  | { topic: typeof TOPIC_RENDER_DONE; payload: RenderDonePayload };

export interface EventEnvelope {
  jsonrpc: '2.0';
  method: 'event';
  params: {
    topic: EventTopic;
    projectId: string;
    payload: CellsChangedPayload | RenderProgressPayload | RenderDonePayload;
    ts: number;
  };
}

export type EventWriter = (line: string) => void;

/** Default writer — emits a JSON-RPC notification frame to stdout. */
export function stdoutEventWriter(line: string): void {
  process.stdout.write(line + '\n');
}

export function emit(
  writer: EventWriter,
  projectId: string,
  evt: EventPayload,
): void {
  const env: EventEnvelope = {
    jsonrpc: '2.0',
    method: 'event',
    params: {
      topic: evt.topic,
      projectId,
      payload: evt.payload,
      ts: Date.now(),
    },
  };
  writer(JSON.stringify(env));
}

export function emitCellsChanged(
  writer: EventWriter,
  projectId: string,
  payload: CellsChangedPayload,
): void {
  emit(writer, projectId, { topic: TOPIC_CELLS_CHANGED, payload });
}

export function emitRenderProgress(
  writer: EventWriter,
  projectId: string,
  payload: RenderProgressPayload,
): void {
  emit(writer, projectId, { topic: TOPIC_RENDER_PROGRESS, payload });
}

export function emitRenderDone(
  writer: EventWriter,
  projectId: string,
  payload: RenderDonePayload,
): void {
  emit(writer, projectId, { topic: TOPIC_RENDER_DONE, payload });
}
