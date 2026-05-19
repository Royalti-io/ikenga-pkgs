/**
 * LSP Content-Length framing.
 *
 * LSP messages on the tsserver-lsp child's stdio look like:
 *
 *   Content-Length: 113\r\n
 *   \r\n
 *   {"jsonrpc":"2.0","id":1,"method":"initialize",...}
 *
 * Our sidecar envelope (the shell's SidecarSupervisor) is line-delimited
 * UTF-8 JSON instead. This module converts between the two.
 *
 * Why not pass LSP frames through unchanged? The supervisor multiplexes by
 * looking at `id` on each line; it expects one JSON object per line. Adding
 * a generic framing escape hatch to the supervisor for one consumer is
 * heavier than translating here.
 */

const HEADER_SEPARATOR = '\r\n\r\n';

export interface LspFrameDecoder {
  /** Push raw stdout bytes; returns any complete frames found. */
  feed(chunk: Uint8Array): string[];
  /** Drop any buffered partial frame (e.g. on child exit). */
  reset(): void;
}

export function createLspFrameDecoder(): LspFrameDecoder {
  let buffer: Uint8Array = new Uint8Array(0);
  const decoder = new TextDecoder('utf-8');
  return {
    feed(chunk) {
      const next = new Uint8Array(buffer.length + chunk.length);
      next.set(buffer, 0);
      next.set(chunk, buffer.length);
      buffer = next;

      const out: string[] = [];
      // Process as many complete frames as we have buffered.
      while (true) {
        const text = decoder.decode(buffer, { stream: true });
        const headerEnd = text.indexOf(HEADER_SEPARATOR);
        if (headerEnd === -1) break;

        const headerText = text.slice(0, headerEnd);
        const match = /content-length:\s*(\d+)/i.exec(headerText);
        if (!match) {
          // Malformed header — drop it and recover so we don't hang.
          buffer = encodeUtf8(text.slice(headerEnd + HEADER_SEPARATOR.length));
          continue;
        }
        const len = Number.parseInt(match[1]!, 10);
        const headerBytes = encodeUtf8(text.slice(0, headerEnd + HEADER_SEPARATOR.length)).length;
        if (buffer.length < headerBytes + len) break; // wait for more

        const bodyStart = headerBytes;
        const bodyEnd = bodyStart + len;
        const bodyText = decoder.decode(buffer.slice(bodyStart, bodyEnd));
        out.push(bodyText);
        buffer = buffer.slice(bodyEnd);
      }
      return out;
    },
    reset() {
      buffer = new Uint8Array(0);
    },
  };
}

export function encodeLspFrame(payload: string): Uint8Array {
  const body = encodeUtf8(payload);
  const header = encodeUtf8(`Content-Length: ${body.length}\r\n\r\n`);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s) as Uint8Array;
}
