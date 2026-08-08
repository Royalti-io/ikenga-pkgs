/**
 * ACP-shaped Antigravity engine adapter.
 *
 * Implements `AcpEngine` from `@ikenga/contract/engine` by delegating to the
 * shell's Tauri ACP commands. The wire shapes are pure TS interfaces; the
 * actual `invoke()` / `listen()` calls are injected by the host so this pkg
 * stays free of `@tauri-apps/*` deps (it builds in any TS environment).
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

class AntigravityAcpEngine implements AcpEngine {
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
	return new AntigravityAcpEngine(host);
}
