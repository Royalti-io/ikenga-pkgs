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
import fs from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { TOOLS } from './tools.js';
import {
  WhisperSupervisor,
  WhisperModelName,
  getMeetingMediaFilePaths,
  resolveWhisperBinary,
  isModelDownloaded,
  DEFAULT_WHISPER_MODEL,
} from './whisper.js';
import { transcribeWithOpenAi } from './openai.js';
import { summarizeWithOpenAi } from './summarize.js';
import { getOpenAiKey, hasOpenAiKey, setOpenAiKey, clearOpenAiKey } from './secrets-store.js';

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

          const provider = typeof rawArgs.provider === 'string' ? rawArgs.provider : 'local';

          // WP-19: 'engine' routes through the shell's active agent session,
          // which only the iframe (not this Node child process) has any path
          // to reach — and no shipped engine accepts audio input regardless
          // (see AcpPromptCapabilities.audio in @ikenga/contract). Fail loudly
          // and specifically rather than silently falling back to local,
          // which would transcribe on the wrong backend without saying so.
          if (provider === 'engine') {
            const result = {
              ok: false as const,
              meeting_id: meetingId,
              error:
                "'engine' transcription is not reachable from the meetings MCP server — no shipped engine (Claude Code, OpenCode, Pi) accepts audio input yet. Choose 'local' or 'openai'.",
            };
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              structuredContent: result,
              isError: true,
            };
          }

          if (provider === 'openai') {
            const apiKey = await getOpenAiKey();
            if (!apiKey) {
              const result = {
                ok: false as const,
                meeting_id: meetingId,
                error:
                  "no OpenAI API key configured — call stt_set_openai_key first, or choose the 'local' backend.",
              };
              return {
                content: [{ type: 'text', text: JSON.stringify(result) }],
                structuredContent: result,
                isError: true,
              };
            }

            const outputDir =
              typeof rawArgs.output_dir === 'string' ? rawArgs.output_dir : undefined;
            const paths = getMeetingMediaFilePaths(meetingId, outputDir);
            const audioPath =
              typeof rawArgs.audio_path === 'string' ? rawArgs.audio_path : paths.audioPath;

            try {
              const stat = await fs.stat(audioPath);
              if (stat.size === 0) {
                throw new Error(`audio file is empty: ${audioPath}`);
              }
              const { segments } = await transcribeWithOpenAi({
                meetingId,
                audioPath,
                apiKey,
                language: typeof rawArgs.language === 'string' ? rawArgs.language : undefined,
              });
              const result = {
                ok: true as const,
                meeting_id: meetingId,
                audio_path: audioPath,
                segment_count: segments.length,
                segments,
              };
              return {
                content: [{ type: 'text', text: JSON.stringify(result) }],
                structuredContent: result,
                isError: false,
              };
            } catch (err) {
              const result = {
                ok: false as const,
                meeting_id: meetingId,
                error: err instanceof Error ? err.message : String(err),
              };
              return {
                content: [{ type: 'text', text: JSON.stringify(result) }],
                structuredContent: result,
                isError: true,
              };
            }
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

        case 'summarize_cloud': {
          // Explicit, per-meeting, and never automatic (D-16): this sends the
          // whole transcript off the machine. The app's rule-based summariser
          // may run on its own precisely because it does not.
          const meetingId = String(args?.meeting_id ?? '');
          if (!meetingId) throw new Error('summarize_cloud requires meeting_id');
          const segments = Array.isArray(args?.segments) ? args.segments : null;
          if (!segments || segments.length === 0) {
            throw new Error('summarize_cloud requires the transcript segments to summarise');
          }
          const summary = await summarizeWithOpenAi({
            segments: segments as never,
            ...(typeof args?.model === 'string' ? { model: args.model } : {}),
          });
          const payload = { ok: true, meeting_id: meetingId, provider: 'openai', summary };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
            structuredContent: payload,
          };
        }

        case 'stt_status': {
          const binaryRes = await resolveWhisperBinary(
            typeof rawArgs.whisper_bin === 'string' ? rawArgs.whisper_bin : undefined
          );
          const modelDownloaded = await isModelDownloaded(
            typeof rawArgs.model === 'string'
              ? (rawArgs.model as WhisperModelName)
              : DEFAULT_WHISPER_MODEL,
            typeof rawArgs.model_dir === 'string' ? rawArgs.model_dir : undefined
          );
          const result = {
            ok: true,
            local: {
              whisper_binary_available: binaryRes.available,
              model_downloaded: modelDownloaded,
              reason: binaryRes.available ? undefined : binaryRes.error,
            },
            openai: {
              configured: await hasOpenAiKey(),
            },
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
            isError: false,
          };
        }

        case 'stt_set_openai_key': {
          const apiKey = String(rawArgs.api_key ?? '');
          if (!apiKey.trim()) {
            throw new McpError(ErrorCode.InvalidParams, 'missing required argument: api_key');
          }
          await setOpenAiKey(apiKey);
          const result = { ok: true };
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
            isError: false,
          };
        }

        case 'stt_clear_openai_key': {
          await clearOpenAiKey();
          const result = { ok: true };
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
            isError: false,
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
