/**
 * Cursor Agent Engine adapter — **scaffold-only** per ADR-013 Phase 4.
 *
 * Expected eventual shape (see ADR-013 §1): ACP passthrough, structurally
 * identical to the Gemini adapter — `cursor-agent --acp` (or whichever
 * flag the CLI exposes once installable) spoken JSON-RPC over stdio, with
 * the shell's Rust adapter (`shell/src-tauri/src/engines/cursor_agent/`)
 * doing the spawn + proxy. The file layout in this pkg mirrors the
 * Gemini pkg deliberately so the Phase-next swap is a content diff, not a
 * structural one.
 *
 * **Today every runtime method throws** `RUNTIME_NOT_IMPLEMENTED`. The
 * metadata block advertises no capabilities — the scaffold can't do
 * anything yet, so it shouldn't claim to. `createAcpEngine` also throws
 * (no transport exists). The portability adapter is exported but every
 * method throws as well (no fan-out targets have been verified for the
 * Cursor CLI yet).
 */

import type {
	Engine,
	EngineEvent,
	HostBridge,
	McpServerSpec,
	Session,
	SessionOpts,
} from '@ikenga/contract/engine';

const ID = 'com.ikenga.engine-cursor-agent';
const VERSION = '0.1.0';

const RUNTIME_NOT_IMPLEMENTED =
	'cursor-agent runtime not implemented — see ADR-013 Phase 4';

class CursorAgentSession implements Session {
	constructor(
		readonly id: string,
		private readonly host: HostBridge,
	) {
		void this.host;
	}

	async cancel(): Promise<void> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
	}
}

export class CursorAgentEngine implements Engine {
	readonly id = ID;
	readonly version = VERSION;

	// Mirrors manifest.json `engine` block. All capabilities `false` —
	// scaffold-only. When ADR-013 Phase ~next swaps in real ACP
	// passthrough, this block expands to advertise streaming / toolUse /
	// etc., mirroring the Gemini metadata.
	readonly metadata = {
		agentId: 'cursor-agent',
		display: 'Cursor Agent',
		capabilities: {
			streaming: false,
			toolUse: false,
			thinking: false,
			artifacts: false,
			fileAttachments: false,
			imageInput: false,
			slashCommands: false,
			modelSwitching: false,
			promptCaching: false,
			agenticTools: false,
			mcp: false,
			sessionResume: false,
		},
		onboarding: {
			requiredVaultKeys: [] as string[],
			requiredEnvVars: [] as string[],
			// TODO(ADR-013 Phase ~next): pin the auth command once the
			// Cursor CLI install flow is verified. Left `undefined`
			// today because the auth surface is unknown (the contract's
			// `EngineMetadata.onboarding.authCommand` is `string |
			// undefined`, not nullable).
			authCommand: undefined as string | undefined,
			docsUrl: 'https://cursor.com/docs',
		},
	};

	constructor(private readonly host: HostBridge) {
		void this.host;
	}

	startSession(_opts: SessionOpts): Promise<Session> {
		throw new Error(RUNTIME_NOT_IMPLEMENTED);
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
		// Scaffold honesty: report unhealthy with the canonical error
		// string so the kernel + UI surfaces a consistent message.
		return { ok: false, reason: RUNTIME_NOT_IMPLEMENTED };
	}
}

/**
 * Default factory used by the engine kernel when loading this pkg. The
 * kernel passes a `HostBridge` constructed from its Tauri command set —
 * the constructor accepts it for symmetry with the gemini pkg but the
 * scaffold never uses it.
 */
export function createEngine(host: HostBridge): Engine {
	return new CursorAgentEngine(host);
}

export default createEngine;

/**
 * ACP-shaped engine factory. Throws for the scaffold — no transport
 * exists until the Cursor CLI is installable + ACP-verifiable. Mirror of
 * gemini's pre-Phase-2 stub before `acp-engine.ts` was written.
 */
export function createAcpEngine(_host: unknown): never {
	throw new Error(RUNTIME_NOT_IMPLEMENTED);
}

// Portability adapter (ADR-012 Track G) — exported alongside the runtime
// engine. Every method throws RUNTIME_NOT_IMPLEMENTED until the on-disk
// layout for the Cursor CLI is verified.
export { CursorAgentEngineAdapter } from './portability.js';
