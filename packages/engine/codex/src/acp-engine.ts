/**
 * ACP-shaped Codex engine adapter.
 *
 * Per ADR-013 §1: Codex CLI does NOT speak ACP natively (no `--acp` flag,
 * no `acp` subcommand). The shell's Rust adapter
 * (`shell/src-tauri/src/engines/codex_pty/`) drives `codex exec --json`
 * one-shot per turn and emits ACP-shaped `SessionUpdate` envelopes on the
 * same `chat://session/{thread_id}` channel Gemini and Claude use. From
 * the pkg surface, the wire is uniform — so this delegator is intentionally
 * identical in shape to the gemini and claude-code pkgs.
 *
 * The actual `invoke()` / `listen()` calls are injected by the host via the
 * `AcpHost` adapter so this pkg stays free of `@tauri-apps/*` deps and
 * builds in any TS environment.
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

class CodexAcpEngine implements AcpEngine {
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
	return new CodexAcpEngine(host);
}
