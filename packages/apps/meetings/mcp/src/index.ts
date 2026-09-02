/**
 * com.ikenga.meetings — Supervised Long-Lived MCP Server (WP-17)
 *
 * Exposes meeting transcription on a supervised long-lived process tracked by
 * the shell's supervisor. Unlike a one-shot sidecar CLI dropped after spawning,
 * this server maintains direct tracking of any active `whisper-cli` child process.
 * Orphan handling, stated accurately: the shell kills a supervised child with
 * SIGKILL (kill_on_drop), which is untrappable, so the signal handlers here do
 * NOT cover shell-initiated shutdown. What bounds the orphan is (a) stdin EOF,
 * the one warning the shell gives before that kill, and (b) a sweep at startup
 * that reaps whisper processes left by a previous run. The guarantee is
 * therefore "bounded by the next server start", not "never orphaned".
 */

import path from 'node:path';
import os from 'node:os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { TOOLS } from './tools.js';
import { WhisperSupervisor, WhisperModelName } from './whisper.js';

const NAME = 'meetings';
const VERSION = '0.1.0';

export function createMeetingsMcpServer(
  supervisor: WhisperSupervisor = new WhisperSupervisor()
): Server {
  const server = new Server(
    { name: NAME, version: VERSION },
    { capabilities: { tools: {}, logging: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const rawArgs = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case 'transcribe': {
          const meetingId = String(rawArgs.meeting_id ?? '');
          if (!meetingId) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'missing required argument: meeting_id'
            );
          }

          const result = await supervisor.transcribe({
            meetingId,
            audioPath: typeof rawArgs.audio_path === 'string' ? rawArgs.audio_path : undefined,
            outputDir: typeof rawArgs.output_dir === 'string' ? rawArgs.output_dir : undefined,
            model: typeof rawArgs.model === 'string' ? (rawArgs.model as WhisperModelName) : undefined,
            language: typeof rawArgs.language === 'string' ? rawArgs.language : undefined,
            whisperBinaryPath: typeof rawArgs.whisper_bin === 'string' ? rawArgs.whisper_bin : undefined,
            modelDir: typeof rawArgs.model_dir === 'string' ? rawArgs.model_dir : undefined,
            force: rawArgs.force === true,
            onProgress: (chunk) => {
              void server
                .sendLoggingMessage({
                  level: 'info',
                  logger: 'meetings-mcp/transcribe',
                  data: {
                    method: 'transcribe.progress',
                    params: { meeting_id: meetingId, chunk },
                  },
                })
                .catch(() => {});
            },
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result as unknown as Record<string, unknown>,
            isError: result.ok === false,
          };
        }

        case 'transcribe_status': {
          const meetingId = String(rawArgs.meeting_id ?? '');
          const status = supervisor.getStatus(meetingId);
          const result = { ok: true, meeting_id: meetingId, ...status };
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result as unknown as Record<string, unknown>,
          };
        }

        case 'transcribe_cancel': {
          const meetingId = String(rawArgs.meeting_id ?? '');
          const cancelled = await supervisor.cancel(meetingId);
          const result = { ok: true, meeting_id: meetingId, cancelled };
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result as unknown as Record<string, unknown>,
          };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (err: any) {
      if (err instanceof McpError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: false, error: msg }),
          },
        ],
        structuredContent: { ok: false, error: msg },
        isError: true,
      };
    }
  });

  return server;
}

export async function runServer(): Promise<void> {
  const supervisor = new WhisperSupervisor();

  // Reap whisper processes left behind by a previous run BEFORE accepting any
  // work. A whisper that outlived its supervisor (SIGKILL is untrappable, and
  // the shell may never deliver stdin EOF) would otherwise keep burning cores
  // indefinitely — observed at ~380% CPU for minutes. This is what makes the
  // orphan bounded by "the next server start" rather than unbounded.
  try {
    const mediaRoot = path.join(os.homedir(), '.ikenga', 'media', 'meetings');
    const reaped = await supervisor.sweepOrphans(mediaRoot);
    if (reaped > 0) {
      process.stderr.write(`[meetings-mcp] reaped ${reaped} orphaned whisper process(es)\n`);
    }
  } catch (err) {
    // A failed sweep must never stop the server booting — worst case the
    // orphan survives one more cycle.
    process.stderr.write(`[meetings-mcp] orphan sweep failed: ${String(err)}\n`);
  }

  const server = createMeetingsMcpServer(supervisor);
  const transport = new StdioServerTransport();

  const shutdown = async (signal: string) => {
    process.stderr.write(`[meetings-mcp] received ${signal}, shutting down\n`);
    supervisor.killAll();
    try {
      await server.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await server.connect(transport);
  process.stderr.write(`[meetings-mcp] ready name=${NAME} pid=${String(process.pid)}\n`);
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('index.js')
) {
  runServer().catch((err) => {
    process.stderr.write(`[meetings-mcp] fatal: ${err?.stack ?? String(err)}\n`);
    process.exit(1);
  });
}
