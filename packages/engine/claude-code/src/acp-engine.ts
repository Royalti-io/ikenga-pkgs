/**
 * ACP-shaped Claude Code engine adapter.
 *
 * Implements `AcpEngine` from `@ikenga/contract/engine` by delegating to the
 * shell's Tauri ACP commands. The wire shapes are pure TS interfaces; the
 * actual `invoke()` / `listen()` calls are injected by the host so this pkg
 * stays free of `@tauri-apps/*` deps (it builds in any TS environment).
 *
 * The shell owns the canonical `tauri-cmd.ts` wrappers; we deliberately do
 * NOT import them from `shell/src/`. Instead, the shell constructs the
 * `AcpHost` adapter and threads it in via `createAcpEngine(host)`. That
 * keeps the pkg boundary clean for future engine-* pkgs (Codex, Aider) to
 * follow the same pattern.
 */

import type {
	AcpEngine,
	AcpForkOpts,
	AcpForkResult,
	AcpHost,
	AcpInitializeRequest,
	AcpInitializeResponse,
	AcpLoadSessionResponse,
	AcpNewSessionRequest,
	AcpNewSessionResponse,
	AcpNotifyPayload,
	AcpPermissionRequestEnvelope,
	AcpPromptRequest,
	AcpPromptResponse,
	AcpRequestPermissionResponse,
	AcpSessionModeId,
	AcpSessionUpdate,
} from '@ikenga/contract/engine';

class ClaudeCodeAcpEngine implements AcpEngine {
	constructor(private readonly host: AcpHost) {}

	initialize(req: AcpInitializeRequest): Promise<AcpInitializeResponse> {
		return this.host.initialize(req);
	}

	newSession(req: AcpNewSessionRequest): Promise<AcpNewSessionResponse> {
		return this.host.newSession(req);
	}

	prompt(req: AcpPromptRequest): Promise<AcpPromptResponse> {
		return this.host.prompt(req);
	}

	cancel(sessionId: string): Promise<void> {
		return this.host.cancel(sessionId);
	}

	setMode(sessionId: string, modeId: AcpSessionModeId): Promise<void> {
		return this.host.setMode(sessionId, modeId);
	}

	loadSession(sessionId: string): Promise<AcpLoadSessionResponse> {
		return this.host.loadSession(sessionId);
	}

	forkSession(
		sourceSessionId: string,
		opts?: AcpForkOpts,
	): Promise<AcpForkResult> {
		return this.host.forkSession(sourceSessionId, opts);
	}

	onSessionUpdate(
		sessionId: string,
		callback: (update: AcpSessionUpdate) => void,
	): () => void {
		// `listenSession` resolves the Tauri unsubscribe asynchronously; we
		// expose a sync handle so React effect cleanups can drop the
		// subscription on unmount without awaiting.
		const unsubPromise = this.host.listenSession(sessionId, (notif) =>
			callback(notif.update),
		);
		return () => {
			void unsubPromise.then((u) => u()).catch(() => {});
		};
	}

	onPermissionRequest(
		sessionId: string,
		callback: (envelope: AcpPermissionRequestEnvelope) => void,
	): () => void {
		const unsubPromise = this.host.listenPermissionRequests(sessionId, callback);
		return () => {
			void unsubPromise.then((u) => u()).catch(() => {});
		};
	}

	respondPermission(
		requestId: string,
		response: AcpRequestPermissionResponse,
	): Promise<void> {
		return this.host.respondPermission(requestId, response);
	}

	onNotify(callback: (payload: AcpNotifyPayload) => void): () => void {
		const unsubPromise = this.host.listenNotify(callback);
		return () => {
			void unsubPromise.then((u) => u()).catch(() => {});
		};
	}
}

/**
 * Construct an `AcpEngine` over a host-supplied `AcpHost`. The shell wires
 * the host to its `tauri-cmd.ts` `acp*` wrappers; tests can pass a fake.
 */
export function createAcpEngine(host: AcpHost): AcpEngine {
	return new ClaudeCodeAcpEngine(host);
}
