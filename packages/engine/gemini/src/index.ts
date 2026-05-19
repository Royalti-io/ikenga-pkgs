/**
 * Gemini CLI Engine adapter.
 *
 * Implements the `Engine` contract from `@ikenga/contract` by wrapping the
 * Gemini CLI in ACP-passthrough mode (see ADR-013):
 *
 *   gemini --acp
 *
 * The shell's Rust adapter (`shell/src-tauri/src/engines/gemini_acp/`)
 * spawns the CLI and proxies JSON-RPC; from the pkg surface, Gemini and
 * Claude Code are wire-compatible. Process management is delegated to the
 * host shell via the Tauri commands the shell exposes for engine pkgs;
 * this pkg has no `@tauri-apps/*` dep.
 *
 * Most consumers should target the ACP-shaped surface exported below
 * (`createAcpEngine`). The legacy `createEngine` + `Engine` interface is
 * retained for one release for symmetry with the claude-code pkg.
 */

import type {
	Engine,
	EngineEvent,
	HostBridge,
	McpServerSpec,
	Session,
	SessionOpts,
} from '@ikenga/contract/engine';

const ID = 'com.ikenga.engine-gemini';
const VERSION = '0.2.0';

class GeminiSession implements Session {
	constructor(
		readonly id: string,
		private readonly host: HostBridge,
	) {}

	async cancel(): Promise<void> {
		await this.host.kill(this.id);
	}
}

export class GeminiEngine implements Engine {
	readonly id = ID;
	readonly version = VERSION;

	// Mirrors manifest.json `engine` block. Static — kept in sync manually
	// because the legacy `createEngine` factory is slated for removal; not
	// worth wiring JSON imports just to delete it next release.
	readonly metadata = {
		agentId: 'gemini',
		display: 'Gemini CLI',
		capabilities: {
			streaming: true,
			toolUse: true,
			thinking: true,
			artifacts: true,
			fileAttachments: true,
			imageInput: true,
			slashCommands: true,
			modelSwitching: true,
			promptCaching: true,
			agenticTools: true,
			mcp: true,
			sessionResume: true,
		},
		onboarding: {
			requiredVaultKeys: ['GEMINI_API_KEY'],
			requiredEnvVars: [] as string[],
			authCommand: 'gemini auth',
			docsUrl: 'https://geminicli.com/docs/',
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
		return new GeminiSession(sessionId, this.host);
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
		// The shell's `gemini` binary resolution + CLI availability check is
		// the source of truth. The engine kernel is expected to wire
		// `host.healthCheck` through this — for now, the absence of a probe
		// is treated as healthy.
		return { ok: true };
	}
}

/**
 * Default factory used by the engine kernel when loading this pkg.
 * The kernel passes a `HostBridge` constructed from its Tauri command set.
 */
export function createEngine(host: HostBridge): Engine {
	return new GeminiEngine(host);
}

export default createEngine;

// ACP-shaped engine surface. The legacy `createEngine` + `Engine` above is
// retained for one release; new consumers target `AcpEngine`.
export { createAcpEngine } from './acp-engine.js';
export type { AcpHost, AcpUnlisten, HostBridge } from '@ikenga/contract/engine';

// Portability adapter (ADR-012 Track G) — exported alongside the runtime
// engine. The kernel's `engine_assets` registry resolves both at load time.
export { GeminiEngineAdapter } from './portability.js';
