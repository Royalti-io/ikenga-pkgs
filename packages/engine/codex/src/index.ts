/**
 * Codex CLI Engine adapter.
 *
 * Per ADR-013 §1: Codex CLI doesn't speak ACP natively (no `--acp` flag,
 * no `acp` subcommand). Instead, the shell's Rust adapter
 * (`shell/src-tauri/src/engines/codex_pty/`) drives `codex exec --json`
 * one-shot per turn, parses the JSONL event stream, and emits ACP-shaped
 * `SessionUpdate` envelopes on the same `chat://session/{thread_id}` Tauri
 * channel Claude and Gemini use. From this pkg's perspective the wire is
 * uniform — `createAcpEngine` delegates straight to the host bridge.
 *
 * Process management lives in the shell. This pkg has no `@tauri-apps/*`
 * dep; the host injects an `AcpHost` (and the legacy `HostBridge`) at
 * registration time.
 *
 * Most consumers should target `createAcpEngine` below. The legacy
 * `createEngine` + `Engine` factory is retained for one release for
 * symmetry with the gemini and claude-code pkgs.
 */

import type {
	Engine,
	EngineEvent,
	HostBridge,
	McpServerSpec,
	Session,
	SessionOpts,
} from '@ikenga/contract/engine';

const ID = 'com.ikenga.engine-codex';
const VERSION = '0.2.0';

class CodexSession implements Session {
	constructor(
		readonly id: string,
		private readonly host: HostBridge,
	) {}

	async cancel(): Promise<void> {
		await this.host.kill(this.id);
	}
}

export class CodexEngine implements Engine {
	readonly id = ID;
	readonly version = VERSION;

	// Mirrors manifest.json `engine` block. Kept in sync manually — see the
	// matching note in the gemini and claude-code engines.
	readonly metadata = {
		agentId: 'codex',
		display: 'Codex CLI',
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
			requiredVaultKeys: ['OPENAI_API_KEY'],
			requiredEnvVars: [] as string[],
			authCommand: 'codex login',
			docsUrl: 'https://developers.openai.com/codex/cli',
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
		return new CodexSession(sessionId, this.host);
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
		// Shell-side `codex` binary resolution + auth probe is the source
		// of truth. Until the kernel wires `host.healthCheck` through, treat
		// absence-of-probe as healthy.
		return { ok: true };
	}
}

/**
 * Default factory used by the engine kernel when loading this pkg.
 * The kernel passes a `HostBridge` constructed from its Tauri command set.
 */
export function createEngine(host: HostBridge): Engine {
	return new CodexEngine(host);
}

export default createEngine;

// ACP-shaped engine surface. Per ADR-013, Codex's wire is "custom adapter
// via codex exec" but the FE sees ACP-shaped envelopes, so this delegator
// is identical in shape to gemini's.
export { createAcpEngine } from './acp-engine.js';
export type { AcpHost, AcpUnlisten, HostBridge } from '@ikenga/contract/engine';

// Portability adapter (ADR-012 Track C) — exported alongside the runtime
// engine. The kernel's `engine_assets` registry resolves both at load time.
export { CodexEngineAdapter } from './portability.js';
