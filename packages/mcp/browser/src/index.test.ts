// Smoke tests for the browser MCP. We don't spin up a real Ikenga shell;
// instead a tiny in-process HTTP server stands in for `/iyke/browser/*`
// so BrowserClient + the URL routing get exercised end-to-end without any
// mocking of ES-module bindings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { BrowserClient } from './api.js';
import type { ControlFile } from './control.js';

interface RecordedRequest {
  method: string;
  url: string;
  headers: NodeJS.Dict<string | string[]>;
  body: string;
}

async function withServer<T>(
  handler: (req: RecordedRequest) => { status?: number; body?: unknown },
  fn: (cf: ControlFile, recorded: RecordedRequest[]) => Promise<T>,
): Promise<T> {
  const recorded: RecordedRequest[] = [];
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const body: string = await new Promise((resolve) => {
      let buf = '';
      req.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
      });
      req.on('end', () => resolve(buf));
    });
    const rec: RecordedRequest = {
      method: req.method || '',
      url: req.url || '',
      headers: req.headers,
      body,
    };
    recorded.push(rec);
    const out = handler(rec);
    res.statusCode = out.status ?? 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out.body ?? { ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const cf: ControlFile = {
    schema_version: 1,
    port: addr.port,
    token: 'test-bearer',
    pid: process.pid,
    started_at_unix_ms: Date.now(),
    identifier: 'app.ikenga',
  };
  try {
    return await fn(cf, recorded);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('BrowserClient.post sends Authorization, Content-Type, and the JSON body', async () => {
  await withServer(
    () => ({ body: { ok: true } }),
    async (cf, recorded) => {
      const c = new BrowserClient(cf);
      const res = await c.post('/iyke/browser/open', {
        pkg_id: 'com.ikenga.mcp-browser',
        pane_id: 'b1',
        url: 'https://example.com',
      });
      assert.deepEqual(res, { ok: true });
      assert.equal(recorded.length, 1);
      assert.equal(recorded[0]!.method, 'POST');
      assert.equal(recorded[0]!.url, '/iyke/browser/open');
      assert.equal(recorded[0]!.headers.authorization, 'Bearer test-bearer');
      assert.equal(recorded[0]!.headers['content-type'], 'application/json');
      const parsed = JSON.parse(recorded[0]!.body);
      assert.equal(parsed.pkg_id, 'com.ikenga.mcp-browser');
      assert.equal(parsed.pane_id, 'b1');
      assert.equal(parsed.url, 'https://example.com');
    },
  );
});

test('BrowserClient.get builds a query string and skips null/undefined', async () => {
  await withServer(
    () => ({ body: { panes: [] } }),
    async (cf, recorded) => {
      const c = new BrowserClient(cf);
      await c.get('/iyke/browser/list', {
        pkg_id: 'com.ikenga.mcp-browser',
        empty: null,
        gone: undefined,
      });
      assert.equal(recorded[0]!.method, 'GET');
      assert.match(recorded[0]!.url, /^\/iyke\/browser\/list\?pkg_id=com\.ikenga\.mcp-browser$/);
    },
  );
});

test('BrowserClient surfaces non-2xx responses', async () => {
  await withServer(
    () => ({ status: 500, body: { error: 'boom' } }),
    async (cf) => {
      const c = new BrowserClient(cf);
      await assert.rejects(
        c.post('/iyke/browser/snapshot', { pkg_id: 'x', pane_id: 'b1' }),
        /HTTP 500/,
      );
    },
  );
});

test('BrowserClient propagates a custom timeout to fetch via AbortController', async () => {
  // Server that hangs without ever responding — the abort fires on the client side.
  const server = createServer(() => {
    // intentionally never end the response
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const cf: ControlFile = {
    schema_version: 1,
    port: addr.port,
    token: 't',
    pid: process.pid,
    started_at_unix_ms: Date.now(),
    identifier: 'app.ikenga',
  };
  try {
    const c = new BrowserClient(cf);
    await assert.rejects(
      c.post('/iyke/browser/wait-for', { pkg_id: 'x', pane_id: 'b1' }, 250),
      /timed out/,
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
