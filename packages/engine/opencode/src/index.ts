/**
 * OpenCode Engine adapter.
 *
 * Implements the `Engine` and `AcpEngine` contracts from `@ikenga/contract`
 * for the OpenCode CLI (`opencode`).
 */

import type {
  Engine,
  EngineEvent,
  HostBridge,
  McpServerSpec,
  Session,
  SessionOpts,
} from '@ikenga/contract/engine';

const ID = 'com.ikenga.engine-opencode';
const VERSION = '0.1.0';

class OpencodeSession implements Session {
  constructor(
    readonly id: string,
    private readonly host: HostBridge,
  ) {}

  async cancel(): Promise<void> {
    await this.host.kill(this.id);
  }
}

export class OpencodeEngine implements Engine {
  readonly id = ID;
  readonly version = VERSION;

  // Mirrors manifest.json `engine` block.
  readonly metadata = {
    agentId: 'opencode',
    display: 'OpenCode',
    capabilities: {
      streaming: true,
      toolUse: true,
      thinking: false,
      artifacts: false,
      fileAttachments: true,
      imageInput: false,
      slashCommands: true,
      modelSwitching: true,
      promptCaching: false,
      agenticTools: true,
      mcp: true,
      sessionResume: true,
    },
    onboarding: {
      requiredVaultKeys: [] as string[],
      requiredEnvVars: [] as string[],
      authCommand: 'opencode /init',
      docsUrl: 'https://opencode.ai',
    },
  };

  constructor(private readonly host: HostBridge) {}

  async startSession(opts: SessionOpts): Promise<Session> {
    const sessionId = crypto.randomUUID();
    await this.host.spawn({
      sessionId,
      cwd: opts.cwd,
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      resumeSessionId: opts.resumeSessionId,
    });
    return new OpencodeSession(sessionId, this.host);
  }

  stream(session: Session, input: string): AsyncIterable<EngineEvent> {
    const host = this.host;
    const id = session.id;
    return {
      [Symbol.asyncIterator]() {
        return (async function* () {
          await host.send(id, input);
          for await (const ev of host.listen(id)) {
            yield ev;
            if (ev.type === 'done') return;
          }
        })();
      },
    };
  }

  registerMcpServer(spec: McpServerSpec): Promise<void> {
    return this.host.registerMcp(spec);
  }

  unregisterMcpServer(id: string): Promise<void> {
    return this.host.unregisterMcp(id);
  }

  async healthCheck(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: true };
  }
}

export function createEngine(host: HostBridge): Engine {
  return new OpencodeEngine(host);
}

export default createEngine;

// ACP-shaped engine surface
export { createAcpEngine, OpencodeAcpEngine } from './acp-engine.js';
export type { AcpHost, AcpUnlisten, HostBridge } from '@ikenga/contract/engine';
