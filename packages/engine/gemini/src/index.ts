/**
 * Gemini CLI Engine adapter — install-time only (ADR-012 Phase 6, Track G).
 *
 * v1 ships ONLY the portability `EngineAdapter` (skills/commands/agents/MCP
 * fan-out into `~/.gemini/`). Runtime wiring — spawning the `gemini` CLI,
 * streaming ACP-shaped events, session resume — is intentionally out of
 * scope for this track and is left as `throw` stubs. A future Track will
 * lift the runtime body when the `gemini` CLI's streaming surface is
 * pinned down.
 *
 * The kernel resolves both the runtime engine and the portability adapter
 * at load time (ADR §2); for now the kernel's Rust-side `GeminiAdapter`
 * (`shell/src-tauri/src/pkg/engine_adapters/gemini.rs`) is what actually
 * fires on install/uninstall — this TS adapter is here for in-pkg tests
 * and for any future scenario where engine pkgs ship adapters dynamically.
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
const VERSION = '0.1.0';

const RUNTIME_NOT_IMPLEMENTED =
	'GeminiEngine runtime not implemented — install-time adapter only for v1';

class GeminiSessionStub implements Session {
	constructor(readonly id: string) {}

	async cancel(): Promise<void> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}
}

export class GeminiEngine implements Engine {
	readonly id = ID;
	readonly version = VERSION;

	// Mirrors manifest.json `engine` block. Kept in sync manually — see the
	// matching note in the claude-code engine.
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

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	constructor(private readonly _host: HostBridge) {}

	async startSession(_opts: SessionOpts): Promise<Session> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
		// Unreachable, but keeps the return type honest for type-checkers
		// that don't model `never`-returning functions.
		// eslint-disable-next-line no-unreachable
		return new GeminiSessionStub('unreachable');
	}

	stream(_session: Session, _input: string): AsyncIterable<EngineEvent> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}

	registerMcpServer(_spec: McpServerSpec): Promise<void> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}

	unregisterMcpServer(_id: string): Promise<void> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}

	async healthCheck(): Promise<{ ok: boolean; reason?: string }> {
		return { ok: false, reason: RUNTIME_NOT_IMPLEMENTED };
	}
}

/**
 * Default factory used by the engine kernel when loading this pkg. The
 * kernel passes a `HostBridge` constructed from its Tauri command set;
 * for v1 the bridge goes unused because every runtime method throws.
 */
export function createEngine(host: HostBridge): Engine {
	return new GeminiEngine(host);
}

export default createEngine;

/**
 * ACP-shaped engine surface. v1 stub — re-export shape mirrored on the
 * claude-code pkg but every method throws so the kernel can fail fast if
 * it ever tries to drive Gemini runtime.
 */
export function createAcpEngine(_host: unknown): never {
	throw new Error(RUNTIME_NOT_IMPLEMENTED);
}

export type { HostBridge } from '@ikenga/contract/engine';

// Portability adapter (ADR-012 Track G) — the only piece this pkg actually
// implements for v1. The kernel's `engine_assets` registry resolves this
// at load time.
export { GeminiEngineAdapter } from './portability.js';
