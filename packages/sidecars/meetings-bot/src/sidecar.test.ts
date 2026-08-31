import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingsBotSidecar } from './sidecar.js';

describe('MeetingsBotSidecar JSON-RPC Controller', () => {
  it('responds to ping over stdio RPC', async () => {
    const sidecar = new MeetingsBotSidecar();
    const res: any = await sidecar.handleRequest({
      jsonrpc: '2.0',
      id: 'ping-1',
      method: 'ping',
    });

    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 'ping-1');
    assert.equal(res.result.pong, true);
  });

  it('answers recorder.status query when idle', async () => {
    const sidecar = new MeetingsBotSidecar();
    const res: any = await sidecar.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'recorder.status',
      params: {},
    });

    assert.equal(res.result.state, 'idle');
    assert.equal(res.result.elapsed_seconds, 0);
  });
});
