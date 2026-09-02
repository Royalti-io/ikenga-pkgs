import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMeetingsMcpServer,
  createMeetingsDbClient,
  resolveDatabasePath,
  parseDbPathFromArgs,
  InMemorySqlExecutor,
  BetterSqliteExecutor,
} from './index.js';
import { MeetingsDbClient } from '@ikenga/meetings-contract';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

describe('MCP Meetings Server & Protocol Tests', () => {
  it('parses db path from CLI args correctly', () => {
    assert.equal(parseDbPathFromArgs(['node', 'dist/index.js', '--db', '/tmp/test.db']), '/tmp/test.db');
    assert.equal(parseDbPathFromArgs(['node', 'dist/index.js', '--sqlite=/tmp/test2.db']), '/tmp/test2.db');
    assert.equal(parseDbPathFromArgs(['node', 'dist/index.js', '-d', '/tmp/test3.db']), '/tmp/test3.db');
    assert.equal(parseDbPathFromArgs(['node', 'dist/index.js']), undefined);
  });

  it('creates client with in-memory executor when requested', () => {
    const memExecutor = new InMemorySqlExecutor();
    const client = createMeetingsDbClient(memExecutor);
    assert.ok(client instanceof MeetingsDbClient);
  });

  it('creates client with string db path', () => {
    const client = createMeetingsDbClient(':memory:');
    assert.ok(client instanceof MeetingsDbClient);
  });

  it('creates server and lists all tools', async () => {
    const memExecutor = new InMemorySqlExecutor();
    const server = createMeetingsMcpServer(memExecutor);

    // Call list tools handler directly
    const listHandler = (server as any)._requestHandlers?.get(ListToolsRequestSchema.shape.method.value);
    assert.ok(listHandler, 'ListTools handler registered');

    const result = await listHandler({ method: 'tools/list', params: {} });
    assert.ok(Array.isArray(result.tools));
    const toolNames = result.tools.map((t: any) => t.name);

    assert.ok(toolNames.includes('search_transcripts'));
    assert.ok(toolNames.includes('get_meeting_transcript'));
    assert.ok(toolNames.includes('get_meeting_summary'));
    assert.ok(toolNames.includes('list_meetings'));
    assert.ok(toolNames.includes('start_recording'));
    assert.ok(toolNames.includes('start_local_recorder'));
    assert.ok(toolNames.includes('stop_recording'));
    assert.ok(toolNames.includes('stop_local_recorder'));
    assert.ok(toolNames.includes('schedule_recording'));
  });

  it('handles tool execution via CallTool handler', async () => {
    const executor = new BetterSqliteExecutor(':memory:');
    const server = createMeetingsMcpServer(executor);

    const callHandler = (server as any)._requestHandlers?.get(CallToolRequestSchema.shape.method.value);
    assert.ok(callHandler, 'CallTool handler registered');

    // Call start_recording
    const startRes = await callHandler({
      method: 'tools/call',
      params: {
        name: 'start_recording',
        arguments: { title: 'test protocol meeting' },
      },
    });

    assert.ok(!startRes.isError);
    const startPayload = JSON.parse(startRes.content[0].text);
    assert.equal(startPayload.ok, true);
    assert.equal(startPayload.status, 'recording');

    // Calling an unknown tool should throw McpError
    await assert.rejects(
      async () =>
        callHandler({
          method: 'tools/call',
          params: {
            name: 'non_existent_tool',
            arguments: {},
          },
        }),
      (err: any) => {
        assert.ok(err instanceof McpError);
        assert.ok(err.message.includes('Unknown tool: non_existent_tool'));
        return true;
      }
    );
  });
});
