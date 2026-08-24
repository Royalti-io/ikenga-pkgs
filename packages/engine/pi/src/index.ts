/**
 * Pi Coding Agent Engine adapter.
 *
 * Implements the `Engine` and `AcpEngine` contracts from `@ikenga/contract`
 * for the Pi CLI (`pi` from `@earendil-works/pi-coding-agent`).
 */

import type {
  Engine,
  EngineEvent,
  HostBridge,
  McpServerSpec,
  Session,
  SessionOpts,
} from '@ikenga/contract/engine';

const ID = 'com.ikenga.engine-pi';
const VERSION = '0.1.0';

class PiSession implements Session {
  constructor(
    readonly id: string,
    private readonly host: HostBridge,
  ) {}

  async cancel(): Promise<void> {
    await this.host.kill(this.id);
  }
}

export class PiEngine implements Engine {
  readonly id = ID;
  readonly version = VERSION;

  // Mirrors manifest.json `engine` block.
  readonly metadata = {
    agentId: 'pi',
    display: 'Pi Coding Agent',
    capabilities: {
      streaming: true,
      toolUse: true,
      thinking: false,
      artifacts: false,
      fileAttachments: true,
      imageInput: false,
      slashCommands: false,
      modelSwitching: true,
      promptCaching: false,
      agenticTools: false,
      mcp: false,
      sessionResume: true,
    },
    onboarding: {
      requiredVaultKeys: [] as string[],
      requiredEnvVars: [] as string[],
      authCommand: 'pi /login',
      docsUrl: 'https://github.com/earendil-works/pi',
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
    return new PiSession(sessionId, this.host);
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
  return new PiEngine(host);
}

export default createEngine;

// ACP-shaped engine surface
export { createAcpEngine, PiAcpEngine } from './acp-engine.js';
export type { AcpHost, AcpUnlisten, HostBridge } from '@ikenga/contract/engine';
