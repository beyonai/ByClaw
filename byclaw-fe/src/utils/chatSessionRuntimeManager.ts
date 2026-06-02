type RuntimeInfo = {
  clientRequestId: string;
  answerClientMsgId: string;
  sessionId?: string;
  traceId?: string;
  answerMessageId?: string;
  agentId?: string | number | null;
  agentCode?: string | null;
  agentType?: string;
  restored?: boolean;
  lastAppliedStreamId?: string;
  cancel?: () => void;
};

export type RunningChatInfo = {
  sessionId?: string;
  running?: boolean;
  traceId?: string;
  clientRequestId?: string;
  modelAnswerMessageId?: string | number;
  agentId?: string | number | null;
  agentCode?: string | null;
  agentType?: string;
};

type Listener = () => void;

class ChatSessionRuntimeManager {
  private activeByClientRequestId = new Map<string, RuntimeInfo>();

  private activeClientRequestIdBySessionId = new Map<string, string>();

  private listeners = new Set<Listener>();

  register(info: RuntimeInfo): void {
    const oldInfo = this.activeByClientRequestId.get(info.clientRequestId);
    this.activeByClientRequestId.set(info.clientRequestId, {
      ...(oldInfo || {}),
      ...info,
    });
    if (info.sessionId) {
      this.activeClientRequestIdBySessionId.set(`${info.sessionId}`, info.clientRequestId);
    }
    this.emitChange();
  }

  hydrateRunning(info: RunningChatInfo, cancel?: () => void): void {
    if (!info?.sessionId) return;
    if (!info.running) {
      this.completeBySession(info.sessionId);
      return;
    }

    const clientRequestId = `${info.clientRequestId || info.traceId || info.modelAnswerMessageId || info.sessionId}`;
    const answerMessageId = info.modelAnswerMessageId ? `${info.modelAnswerMessageId}` : undefined;
    const sessionId = `${info.sessionId}`;
    const activeClientRequestId = this.activeClientRequestIdBySessionId.get(sessionId);
    const activeInfo = activeClientRequestId
      ? this.activeByClientRequestId.get(activeClientRequestId)
      : this.activeByClientRequestId.get(clientRequestId);

    if (activeInfo && !activeInfo.restored) {
      this.register({
        clientRequestId: activeInfo.clientRequestId,
        answerClientMsgId: activeInfo.answerClientMsgId,
        sessionId,
        traceId: info.traceId || activeInfo.traceId,
        answerMessageId: answerMessageId || activeInfo.answerMessageId,
        agentId: info.agentId ?? activeInfo.agentId,
        agentCode: info.agentCode ?? activeInfo.agentCode,
        agentType: info.agentType || activeInfo.agentType,
        restored: false,
        lastAppliedStreamId: activeInfo.lastAppliedStreamId,
        cancel: activeInfo.cancel || cancel,
      });
      return;
    }

    this.register({
      clientRequestId,
      answerClientMsgId: answerMessageId || clientRequestId,
      sessionId,
      traceId: info.traceId,
      answerMessageId,
      agentId: info.agentId,
      agentCode: info.agentCode,
      agentType: info.agentType,
      restored: true,
      cancel,
    });
  }

  updateLastAppliedStreamId(clientRequestId?: string, streamId?: string): void {
    if (!clientRequestId || !streamId) return;
    const info = this.activeByClientRequestId.get(`${clientRequestId}`);
    if (!info) return;
    info.lastAppliedStreamId = `${streamId}`;
    this.emitChange();
  }

  bindSession(clientRequestId: string, sessionId?: string): void {
    if (!sessionId) return;
    const info = this.activeByClientRequestId.get(clientRequestId);
    if (!info) return;
    if (info.sessionId) {
      this.activeClientRequestIdBySessionId.delete(`${info.sessionId}`);
    }
    info.sessionId = `${sessionId}`;
    this.activeClientRequestIdBySessionId.set(`${sessionId}`, clientRequestId);
    this.emitChange();
  }

  complete(clientRequestId: string): void {
    const info = this.activeByClientRequestId.get(clientRequestId);
    if (!info) return;
    this.activeByClientRequestId.delete(clientRequestId);
    if (info.sessionId) {
      this.activeClientRequestIdBySessionId.delete(`${info.sessionId}`);
    }
    this.emitChange();
  }

  completeBySession(sessionId?: string | number): void {
    if (!sessionId) return;
    const clientRequestId = this.activeClientRequestIdBySessionId.get(`${sessionId}`);
    if (clientRequestId) {
      this.complete(clientRequestId);
    }
  }

  isSessionRunning(sessionId?: string): boolean {
    if (!sessionId) return false;
    return this.activeClientRequestIdBySessionId.has(`${sessionId}`);
  }

  getBySession(sessionId?: string): RuntimeInfo | undefined {
    if (!sessionId) return undefined;
    const clientRequestId = this.activeClientRequestIdBySessionId.get(`${sessionId}`);
    if (!clientRequestId) return undefined;
    return this.activeByClientRequestId.get(clientRequestId);
  }

  getByClientRequest(clientRequestId?: string): RuntimeInfo | undefined {
    if (!clientRequestId) return undefined;
    return this.activeByClientRequestId.get(`${clientRequestId}`);
  }

  getByTrace(sessionId?: string | number, traceId?: string): RuntimeInfo | undefined {
    if (!sessionId || !traceId) return undefined;
    const runtime = this.getBySession(`${sessionId}`);
    if (!runtime || runtime.traceId !== traceId) return undefined;
    return runtime;
  }

  clear(): void {
    this.activeByClientRequestId.clear();
    this.activeClientRequestIdBySessionId.clear();
    this.emitChange();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const chatSessionRuntimeManager = new ChatSessionRuntimeManager();
