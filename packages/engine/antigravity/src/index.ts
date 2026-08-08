/**
 * Antigravity CLI Engine adapter.
 *
 * Implements the `Engine` contract from `@ikenga/contract` by wrapping the
 * Antigravity CLI:
 *
 *   agy
 *
 * Most consumers should target the ACP-shaped surface exported below
 * (`createAcpEngine`).
 */

import type {
	Engine,
	EngineEvent,
	HostBridge,
	McpServerSpec,
	Session,
	SessionOpts,
} from '@ikenga/contract/engine';

const ID = 'com.ikenga.engine-antigravity';
const VERSION = '0.2.1';

class AntigravitySession implements Session {
	constructor(
		readonly id: string,
		private readonly host: HostBridge,
	) {}

	async cancel(): Promise<void> {
		await this.host.kill(this.id);
	}
}

export class AntigravityEngine implements Engine {
	readonly id = ID;
	readonly version = VERSION;

	// Mirrors manifest.json `engine` block. Static — kept in sync manually.
	readonly metadata = {
		agentId: 'antigravity-cli',
		display: 'Antigravity CLI',
		capabilities: {
			streaming: false,
			toolUse: true,
			thinking: true,
			artifacts: true,
			fileAttachments: true,
			imageInput: false,
			slashCommands: true,
			modelSwitching: false,
			promptCaching: true,
			agenticTools: true,
			mcp: true,
			sessionResume: true,
		},
		onboarding: {
			requiredVaultKeys: ['GEMINI_API_KEY'],
			requiredEnvVars: [] as string[],
			authCommand: 'agy models',
			docsUrl: 'https://antigravity.google/',
		},
	};

	constructor(private readonly host: HostBridge) {}

	async startSession(opts: SessionOpts): Promise<Session> {
		const sessionId = crypto.randomUUID();
		await this.host.spawn({
			sessionId,
			cwd: opts.cwd,
			systemPrompt: opts.systemPrompt,
		});
		return new AntigravitySession(sessionId, this.host);
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

/**
 * Default factory used by the engine kernel when loading this pkg.
 * The kernel passes a `HostBridge` constructed from its Tauri command set.
 */
export function createEngine(host: HostBridge): Engine {
	return new AntigravityEngine(host);
}

export default createEngine;

// ACP-shaped engine surface.
export { createAcpEngine } from './acp-engine.js';
export type { AcpHost, AcpUnlisten, HostBridge } from '@ikenga/contract/engine';

// Portability adapter (ADR-012 Track G) — exported alongside the runtime
// engine. The kernel's `engine_assets` registry resolves both at load time.
export { AntigravityEngineAdapter } from './portability.js';
