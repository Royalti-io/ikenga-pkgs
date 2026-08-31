#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { MeetingsDbClient, SqlExecutor } from '@ikenga/meetings-contract';
import { SEARCH_TOOLS, handleSearchTool } from './tools/search.js';
import { RECORDER_TOOLS, handleRecorderTool } from './tools/recorder.js';

class InMemorySqlExecutor implements SqlExecutor {
  private meetingsMap = new Map<string, any>();
  private transcriptsMap = new Map<string, any[]>();
  private speakersMap = new Map<string, any[]>();
  private summariesMap = new Map<string, any>();
  private actionsMap = new Map<string, any[]>();

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (sql.includes('SELECT * FROM meetings WHERE id = ?')) {
      const id = String(params[0]);
      const found = this.meetingsMap.get(id);
      return (found ? [found] : []) as T[];
    }
    if (sql.includes('SELECT * FROM meetings')) {
      return Array.from(this.meetingsMap.values()) as T[];
    }
    if (sql.includes('SELECT * FROM meeting_transcripts WHERE text LIKE ?')) {
      const all: any[] = [];
      for (const list of this.transcriptsMap.values()) {
        all.push(...list);
      }
      const rawPattern = String(params[0] ?? '').replace(/%/g, '').toLowerCase();
      const matched = all.filter((r) => r.text?.toLowerCase().includes(rawPattern));
      return matched as T[];
    }
    if (sql.includes('SELECT * FROM meeting_transcripts WHERE meeting_id = ?')) {
      const id = String(params[0]);
      return (this.transcriptsMap.get(id) ?? []) as T[];
    }
    if (sql.includes('SELECT * FROM meeting_speakers WHERE meeting_id = ?')) {
      const id = String(params[0]);
      return (this.speakersMap.get(id) ?? []) as T[];
    }
    if (sql.includes('SELECT * FROM meeting_summaries WHERE meeting_id = ?')) {
      const id = String(params[0]);
      const found = this.summariesMap.get(id);
      return (found ? [found] : []) as T[];
    }
    return [];
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    if (sql.includes('INSERT INTO meetings')) {
      const [id, title, platform, url, status, start_time, end_time, duration_seconds, video_path, audio_path, created_at, updated_at] = params;
      this.meetingsMap.set(String(id), {
        id, title, platform, url, status, start_time, end_time, duration_seconds, video_path, audio_path, created_at, updated_at
      });
    } else if (sql.includes('UPDATE meetings SET')) {
      const id = String(params[params.length - 1]);
      const existing = this.meetingsMap.get(id);
      if (existing) {
        existing.status = params[0];
        existing.updated_at = params[1];
      }
    }
  }
}

const defaultExecutor = new InMemorySqlExecutor();
const dbClient = new MeetingsDbClient(defaultExecutor);

const ALL_TOOLS = [...SEARCH_TOOLS, ...RECORDER_TOOLS];

export function createMeetingsMcpServer(client: MeetingsDbClient = dbClient): Server {
  const server = new Server(
    {
      name: 'dev.ikenga/mcp-meetings',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOLS,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (SEARCH_TOOLS.some((t) => t.name === name)) {
        const res = await handleSearchTool(client, name, args ?? {});
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      if (RECORDER_TOOLS.some((t) => t.name === name)) {
        const res = await handleRecorderTool(client, name, args ?? {});
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      }

      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    } catch (err: any) {
      if (err instanceof McpError) throw err;
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool error (${name}): ${err.message}` }],
      };
    }
  });

  return server;
}

export async function runServer(): Promise<void> {
  const server = createMeetingsMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runServer().catch((err) => {
    console.error('Fatal MCP Server error:', err);
    process.exit(1);
  });
}
