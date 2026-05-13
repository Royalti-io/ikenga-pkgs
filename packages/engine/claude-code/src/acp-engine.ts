/**
 * ACP-shaped Claude Code engine adapter (Phase 10).
 *
 * Implements `AcpEngine` from `@ikenga/contract/engine` by delegating to the
 * shell's Tauri ACP commands. The wire shapes are pure TS interfaces; the
 * actual `invoke()` / `listen()` calls are injected by the host so this pkg
 * stays free of `@tauri-apps/*` deps (it builds in any TS environment).
 *
 * Design note — duplicate-vs-share (path a per Phase 10 brief):
 *   The shell owns the canonical `tauri-cmd.ts` wrappers; we deliberately do
 *   NOT import them from `shell/src/`. Instead, the shell constructs the
 *   `AcpHost` adapter and threads it in via `createAcpEngine(host)`. That
 *   keeps the pkg boundary clean for future engine-* pkgs (Codex, Aider) to
 *   follow the same pattern.
 */

import type {
	AcpEngine,
	AcpForkOpts,
	AcpForkResult,
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
	AcpSessionNotification,
	AcpSessionUpdate,
} from '@ikenga/contract/engine';

/** Synchronous unsubscribe handle. */
export type AcpUnlisten = () => void;

/**
 * Tauri-side surface the host shell exposes for the ACP engine. The shell
 * binds these to its `acp_*` Tauri commands and `acp://*` event listeners.
 *
 * Each `on*` returns a Promise of an unsubscribe fn — the engine wraps that
 * so callers get a sync unsubscribe.
 */
export interface AcpHost {
	initialize(req: AcpInitializeRequest): Promise<AcpInitializeResponse>;
	newSession(req: AcpNewSessionRequest): Promise<AcpNewSessionResponse>;
	prompt(req: AcpPromptRequest): Promise<AcpPromptResponse>;
	cancel(sessionId: string): Promise<void>;
	setMode(sessionId: string, modeId: AcpSessionModeId): Promise<void>;
	loadSession(sessionId: string): Promise<AcpLoadSessionResponse>;
	forkSession(
		sourceSessionId: string,
		opts?: AcpForkOpts,
	): Promise<AcpForkResult>;
	listenSession(
		sessionId: string,
		onUpdate: (notification: AcpSessionNotification) => void,
	): Promise<AcpUnlisten>;
	listenPermissionRequests(
		sessionId: string,
		onRequest: (envelope: AcpPermissionRequestEnvelope) => void,
	): Promise<AcpUnlisten>;
	respondPermission(
		requestId: string,
		response: AcpRequestPermissionResponse,
	): Promise<void>;
	listenNotify(
		callback: (payload: AcpNotifyPayload) => void,
	): Promise<AcpUnlisten>;
}

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
