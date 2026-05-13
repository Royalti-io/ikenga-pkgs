/**
 * No-op Engine adapter.
 *
 * Implements the `Engine` contract from `@ikenga/contract` with zero external
 * dependencies and no host bridge. Useful as:
 *
 *   - A test fixture for the engine kernel (proves event flow without
 *     spawning a real model).
 *   - A "shell-without-AI" mode for environments where no AI engine is
 *     installed or desired.
 *
 * `stream()` emits a single canned `message_delta` echoing the input, then a
 * `done` event with `reason: 'stop'`.
 */

import type {
	Engine,
	EngineEvent,
	McpServerSpec,
	Session,
	SessionOpts,
} from '@ikenga/contract/engine';

const ID = 'com.ikenga.engine-noop';
const VERSION = '0.1.0';

class NoopSession implements Session {
	constructor(readonly id: string) {}

	async cancel(): Promise<void> {
		// No-op: nothing to cancel.
	}
}

export class NoopEngine implements Engine {
	readonly id = ID;
	readonly version = VERSION;

	// Mirrors manifest.json `engine` block.
	readonly metadata = {
		agentId: 'noop',
		display: 'No-op (offline mode)',
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
		},
	};

	async startSession(_opts: SessionOpts): Promise<Session> {
		return new NoopSession(crypto.randomUUID());
	}

	stream(_session: Session, input: string): AsyncIterable<EngineEvent> {
		return {
			[Symbol.asyncIterator]() {
				return (async function* () {
					yield {
						type: 'message_delta',
						text: `[noop engine] received: ${input}`,
					} satisfies EngineEvent;
					yield { type: 'done', reason: 'stop' } satisfies EngineEvent;
				})();
			},
		};
	}

	async registerMcpServer(_spec: McpServerSpec): Promise<void> {
		// No-op.
	}

	async unregisterMcpServer(_id: string): Promise<void> {
		// No-op.
	}

	async healthCheck(): Promise<{ ok: boolean; reason?: string }> {
		return { ok: true };
	}
}

/**
 * Default factory used by the engine kernel when loading this pkg.
 * The noop engine takes no host bridge — it has nothing to call out to.
 */
export function createEngine(): Engine {
	return new NoopEngine();
}

export default createEngine;
