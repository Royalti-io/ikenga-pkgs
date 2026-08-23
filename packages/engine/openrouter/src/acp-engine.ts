/**
 * ACP-shaped OpenRouter engine adapter.
 *
 * Provides the modern AcpEngine implementation for OpenRouter LLM endpoints.
 * Process and network operations are mediated via the host bridge.
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
  AcpPermissionRequestEnvelope,
  AcpPromptRequest,
  AcpPromptResponse,
  AcpRequestPermissionResponse,
  AcpSessionModeId,
  AcpSessionUpdate,
} from '@ikenga/contract/engine';

export class OpenRouterAcpEngine implements AcpEngine {
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

  onNotify(callback: (payload: any) => void): () => void {
    const unsubPromise = this.host.listenNotify(callback);
    return () => {
      void unsubPromise.then((u) => u()).catch(() => {});
    };
  }
}

export function createAcpEngine(host: AcpHost): AcpEngine {
  return new OpenRouterAcpEngine(host);
}
