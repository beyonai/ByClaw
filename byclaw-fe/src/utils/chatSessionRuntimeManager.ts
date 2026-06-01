type RuntimeInfo = {
  requestId: string;
  msgId: string;
  sessionId?: string;
  traceId?: string;
  messageId?: string;
  agentId?: string | number | null;
  agentCode?: string | null;
  agentType?: string;
  restored?: boolean;
  cancel?: () => void;
};

export type RunningChatInfo = {
  sessionId?: string;
  running?: boolean;
  traceId?: string;
  requestId?: string;
  modelAnswerMessageId?: string | number;
  agentId?: string | number | null;
  agentCode?: string | null;
  agentType?: string;
};

type Listener = () => void;

class ChatSessionRuntimeManager {
  private activeByRequestId = new Map<string, RuntimeInfo>();

  private activeRequestIdBySessionId = new Map<string, string>();

  private listeners = new Set<Listener>();

  register(info: RuntimeInfo): void {
    const oldInfo = this.activeByRequestId.get(info.requestId);
    this.activeByRequestId.set(info.requestId, {
      ...(oldInfo || {}),
      ...info,
    });
    if (info.sessionId) {
      this.activeRequestIdBySessionId.set(`${info.sessionId}`, info.requestId);
    }
    this.emitChange();
  }

  hydrateRunning(info: RunningChatInfo, cancel?: () => void): void {
    if (!info?.sessionId) return;
    if (!info.running) {
      this.completeBySession(info.sessionId);
      return;
    }

    const requestId = `${info.requestId || info.traceId || info.modelAnswerMessageId || info.sessionId}`;
    const messageId = info.modelAnswerMessageId ? `${info.modelAnswerMessageId}` : undefined;
    const sessionId = `${info.sessionId}`;
    const activeRequestId = this.activeRequestIdBySessionId.get(sessionId);
    const activeInfo = activeRequestId
      ? this.activeByRequestId.get(activeRequestId)
      : this.activeByRequestId.get(requestId);

    if (activeInfo && !activeInfo.restored) {
      this.register({
        requestId: activeInfo.requestId,
        msgId: activeInfo.msgId,
        sessionId,
        traceId: info.traceId || activeInfo.traceId,
        messageId: messageId || activeInfo.messageId,
        agentId: info.agentId ?? activeInfo.agentId,
        agentCode: info.agentCode ?? activeInfo.agentCode,
        agentType: info.agentType || activeInfo.agentType,
        restored: false,
        cancel: activeInfo.cancel || cancel,
      });
      return;
    }

    this.register({
      requestId,
      msgId: messageId || requestId,
      sessionId,
      traceId: info.traceId,
      messageId,
      agentId: info.agentId,
      agentCode: info.agentCode,
      agentType: info.agentType,
      restored: true,
      cancel,
    });
  }

  bindSession(requestId: string, sessionId?: string): void {
    if (!sessionId) return;
    const info = this.activeByRequestId.get(requestId);
    if (!info) return;
    if (info.sessionId) {
      this.activeRequestIdBySessionId.delete(`${info.sessionId}`);
    }
    info.sessionId = `${sessionId}`;
    this.activeRequestIdBySessionId.set(`${sessionId}`, requestId);
    this.emitChange();
  }

  complete(requestId: string): void {
    const info = this.activeByRequestId.get(requestId);
    if (!info) return;
    this.activeByRequestId.delete(requestId);
    if (info.sessionId) {
      this.activeRequestIdBySessionId.delete(`${info.sessionId}`);
    }
    this.emitChange();
  }

  completeBySession(sessionId?: string | number): void {
    if (!sessionId) return;
    const requestId = this.activeRequestIdBySessionId.get(`${sessionId}`);
    if (requestId) {
      this.complete(requestId);
    }
  }

  isSessionRunning(sessionId?: string): boolean {
    if (!sessionId) return false;
    return this.activeRequestIdBySessionId.has(`${sessionId}`);
  }

  getBySession(sessionId?: string): RuntimeInfo | undefined {
    if (!sessionId) return undefined;
    const requestId = this.activeRequestIdBySessionId.get(`${sessionId}`);
    if (!requestId) return undefined;
    return this.activeByRequestId.get(requestId);
  }

  getByRequest(requestId?: string): RuntimeInfo | undefined {
    if (!requestId) return undefined;
    return this.activeByRequestId.get(`${requestId}`);
  }

  getByTrace(sessionId?: string | number, traceId?: string): RuntimeInfo | undefined {
    if (!sessionId || !traceId) return undefined;
    const runtime = this.getBySession(`${sessionId}`);
    if (!runtime || runtime.traceId !== traceId) return undefined;
    return runtime;
  }

  clear(): void {
    this.activeByRequestId.clear();
    this.activeRequestIdBySessionId.clear();
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
