type RuntimeInfo = {
  clientRequestId: string;
  sessionId?: string;
  // 会话创建阶段保留临时 ID，直到流式回答最终结束。
  sessionAliasIds?: string[];
  traceId?: string;
  laneId?: string;
  turnId?: string;
  answerMessageId?: string;
  agentId?: string | number | null;
  agentCode?: string | null;
  agentName?: string | null;
  agentType?: string;
  restored?: boolean;
  waitingForUserInput?: boolean;
  lastAppliedStreamId?: string;
  cancel?: () => void;
};

export type RunningChatInfo = {
  sessionId?: string;
  running?: boolean;
  traceId?: string;
  laneId?: string;
  turnId?: string;
  clientRequestId?: string;
  userMessageId?: string | number;
  modelAnswerMessageId?: string | number;
  agentId?: string | number | null;
  agentCode?: string | null;
  agentName?: string | null;
  agentType?: string;
  chatContent?: string;
  runtimeSource?: string;
  runtimeStatus?: SessionRuntimeStatus;
  activeAgentCount?: number;
  activeChildCount?: number;
  waitingInteractionCount?: number;
  rootActive?: boolean;
  acceptingInput?: boolean;
  runtimeRevision?: number;
  runtimeChangedAt?: number;
};

export type SessionRuntimeStatus = 'running' | 'waiting_user' | 'idle' | 'failed' | string;

export type SessionRuntimeState = {
  sessionId: string;
  traceId: string;
  source?: string;
  status: SessionRuntimeStatus;
  activeAgentCount: number;
  activeChildCount: number;
  waitingInteractionCount: number;
  rootActive?: boolean;
  acceptingInput?: boolean;
  revision: number;
  changedAt: number;
};

type Listener = () => void;

class ChatSessionRuntimeManager {
  private activeByClientRequestId = new Map<string, RuntimeInfo>();

  private activeClientRequestIdsBySessionId = new Map<string, Set<string>>();

  private activeClientRequestIdByTraceKey = new Map<string, string>();

  private activeClientRequestIdByLaneKey = new Map<string, string>();

  private sessionRuntimeBySessionId = new Map<string, SessionRuntimeState>();

  private listeners = new Set<Listener>();

  register(info: RuntimeInfo): void {
    const clientRequestId = `${info.clientRequestId}`;
    const oldInfo = this.activeByClientRequestId.get(clientRequestId);
    if (oldInfo) {
      this.removeIndexes(oldInfo);
    }

    const sessionId = info.sessionId ? `${info.sessionId}` : oldInfo?.sessionId;
    const sessionAliasIds = Array.from(
      new Set([...(oldInfo?.sessionAliasIds || []), ...(info.sessionAliasIds || [])].filter(Boolean))
    ).filter((sessionAliasId) => sessionAliasId !== sessionId);
    const nextInfo = {
      ...(oldInfo || {}),
      ...info,
      clientRequestId,
      sessionId,
      sessionAliasIds,
      traceId: info.traceId ? `${info.traceId}` : oldInfo?.traceId,
      laneId: info.laneId ? `${info.laneId}` : oldInfo?.laneId,
      turnId: info.turnId ? `${info.turnId}` : oldInfo?.turnId,
      answerMessageId: info.answerMessageId ? `${info.answerMessageId}` : oldInfo?.answerMessageId,
    };

    this.activeByClientRequestId.set(clientRequestId, nextInfo);
    this.addIndexes(nextInfo);
    this.emitChange();
  }

  hydrateRunning(info: RunningChatInfo, cancel?: () => void): void {
    if (!info?.sessionId) return;
    if (
      info.runtimeStatus &&
      info.traceId &&
      info.runtimeRevision !== undefined &&
      info.runtimeChangedAt !== undefined
    ) {
      this.applySessionRuntime({
        sessionId: `${info.sessionId}`,
        traceId: `${info.traceId}`,
        source: info.runtimeSource,
        status: info.runtimeStatus,
        activeAgentCount: Number(info.activeAgentCount || 0),
        activeChildCount: Number(info.activeChildCount || 0),
        waitingInteractionCount: Number(info.waitingInteractionCount || 0),
        rootActive: info.rootActive,
        acceptingInput: info.acceptingInput,
        revision: Number(info.runtimeRevision),
        changedAt: Number(info.runtimeChangedAt),
      });
    }
    if (!info.running) {
      // 后端状态查询可能滞后于首条流式消息，不能提前结束当前页面发起的本地回答。
      this.completeRestoredBySession(info.sessionId);
      return;
    }

    const clientRequestId = info.clientRequestId || `runtime:${info.sessionId}:${info.traceId || 'unknown'}`;
    const answerMessageId = info.modelAnswerMessageId ? `${info.modelAnswerMessageId}` : undefined;
    const sessionId = `${info.sessionId}`;
    const activeInfo =
      this.getByClientRequest(clientRequestId) ||
      this.getByLane(sessionId, info.laneId) ||
      this.getByTrace(sessionId, info.traceId);

    if (activeInfo && !activeInfo.restored) {
      this.register({
        clientRequestId: activeInfo.clientRequestId,
        sessionId,
        traceId: info.traceId || activeInfo.traceId,
        laneId: info.laneId || activeInfo.laneId,
        turnId: info.turnId || activeInfo.turnId,
        answerMessageId: answerMessageId || activeInfo.answerMessageId,
        agentId: info.agentId ?? activeInfo.agentId,
        agentCode: info.agentCode ?? activeInfo.agentCode,
        agentName: info.agentName ?? activeInfo.agentName,
        agentType: info.agentType || activeInfo.agentType,
        restored: false,
        lastAppliedStreamId: activeInfo.lastAppliedStreamId,
        cancel: activeInfo.cancel || cancel,
      });
      return;
    }

    this.register({
      clientRequestId,
      sessionId,
      traceId: info.traceId,
      laneId: info.laneId,
      turnId: info.turnId,
      answerMessageId,
      agentId: info.agentId,
      agentCode: info.agentCode,
      agentName: info.agentName,
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

  updateTrace(clientRequestId?: string, traceId?: string): void {
    if (!clientRequestId || !traceId) return;
    this.register({
      clientRequestId: `${clientRequestId}`,
      traceId: `${traceId}`,
    });
  }

  bindSession(clientRequestId: string, sessionId?: string): void {
    if (!sessionId) return;
    const info = this.activeByClientRequestId.get(`${clientRequestId}`);
    if (!info) return;
    // 临时会话项替换为真实会话项前，两个 ID 都需要保持回答中状态，避免蓝点短暂消失。
    const sessionAliasIds = Array.from(
      new Set(
        [...(info.sessionAliasIds || []), info.sessionId].filter((sessionAliasId): sessionAliasId is string =>
          Boolean(sessionAliasId)
        )
      )
    ).filter((sessionAliasId) => sessionAliasId !== `${sessionId}`);
    this.register({
      clientRequestId: info.clientRequestId,
      sessionId: `${sessionId}`,
      sessionAliasIds,
    });
  }

  complete(clientRequestId: string): void {
    const info = this.activeByClientRequestId.get(`${clientRequestId}`);
    if (!info) return;
    this.removeIndexes(info);
    this.activeByClientRequestId.delete(`${clientRequestId}`);
    this.emitChange();
  }

  cancel(clientRequestId: string, sessionId?: string | number): void {
    const info = this.getByClientRequest(clientRequestId);
    const runtime = this.getSessionRuntime(sessionId || info?.sessionId);
    if (runtime && (!info?.traceId || info.traceId === runtime.traceId)) {
      this.applySessionRuntime({
        ...runtime,
        status: 'cancelled',
        rootActive: false,
        acceptingInput: true,
        activeAgentCount: 0,
        activeChildCount: 0,
        waitingInteractionCount: 0,
        revision: runtime.revision + 1,
        changedAt: Date.now(),
      });
    }
    this.complete(clientRequestId);
  }

  completeBySession(sessionId?: string | number): void {
    if (!sessionId) return;
    const clientRequestIds = Array.from(this.activeClientRequestIdsBySessionId.get(`${sessionId}`) || []);
    clientRequestIds.forEach((clientRequestId) => this.complete(clientRequestId));
  }

  completeRestoredBySession(sessionId?: string | number): boolean {
    if (!sessionId) return false;
    // 运行状态接口只负责校正重新进入页面后恢复的会话，实时 SSE 请求由最终事件清理。
    const restoredClientRequestIds = this.getAllBySession(sessionId)
      .filter((runtimeInfo) => runtimeInfo.restored)
      .map((runtimeInfo) => runtimeInfo.clientRequestId);
    restoredClientRequestIds.forEach((clientRequestId) => this.complete(clientRequestId));
    return restoredClientRequestIds.length > 0;
  }

  isSessionRunning(sessionId?: string): boolean {
    if (!sessionId) return false;
    return (
      Boolean(this.activeClientRequestIdsBySessionId.get(`${sessionId}`)?.size) ||
      this.isProjectedRuntimeActive(this.sessionRuntimeBySessionId.get(`${sessionId}`))
    );
  }

  canAcceptInput(sessionId?: string): boolean {
    if (this.isSessionFinishing(sessionId)) return false;
    const runtime = this.getSessionRuntime(sessionId);
    if (runtime?.acceptingInput !== undefined) {
      return runtime.acceptingInput;
    }
    return !this.isSessionRunning(sessionId);
  }

  /** An idle Agent may still be flushing the previous Gateway response. */
  isSessionFinishing(sessionId?: string): boolean {
    const runtime = this.getSessionRuntime(sessionId);
    return runtime?.status === 'idle' && this.getAllBySession(sessionId).length > 0;
  }

  isSessionWaitingForUserInput(sessionId?: string | number): boolean {
    const projected = sessionId ? this.sessionRuntimeBySessionId.get(`${sessionId}`) : undefined;
    return (
      this.getAllBySession(sessionId).some((runtimeInfo) => runtimeInfo.waitingForUserInput) ||
      projected?.status === 'waiting_user' ||
      Number(projected?.waitingInteractionCount || 0) > 0
    );
  }

  applySessionRuntime(runtime: SessionRuntimeState): boolean {
    if (!runtime?.sessionId || !runtime.traceId || !runtime.status) return false;
    const normalized: SessionRuntimeState = {
      ...runtime,
      sessionId: `${runtime.sessionId}`,
      traceId: `${runtime.traceId}`,
      source: runtime.source ? `${runtime.source}` : undefined,
      activeAgentCount: Number(runtime.activeAgentCount || 0),
      activeChildCount: Number(runtime.activeChildCount || 0),
      waitingInteractionCount: Number(runtime.waitingInteractionCount || 0),
      revision: Number(runtime.revision),
      changedAt: Number(runtime.changedAt),
    };
    if (!Number.isFinite(normalized.revision) || !Number.isFinite(normalized.changedAt)) return false;

    const current = this.sessionRuntimeBySessionId.get(normalized.sessionId);
    if (current) {
      if (current.status === 'cancelled' && current.traceId === normalized.traceId) return false;
      const sameTurn = current.source === normalized.source && current.traceId === normalized.traceId;
      if (
        (sameTurn && normalized.revision <= current.revision) ||
        (!sameTurn && normalized.changedAt < current.changedAt)
      ) {
        return false;
      }
    }

    this.sessionRuntimeBySessionId.set(normalized.sessionId, normalized);
    this.emitChange();
    return true;
  }

  getSessionRuntime(sessionId?: string | number): SessionRuntimeState | undefined {
    return sessionId ? this.sessionRuntimeBySessionId.get(`${sessionId}`) : undefined;
  }

  setWaitingForUserInput(clientRequestId: string | undefined, waitingForUserInput: boolean): void {
    if (!clientRequestId) return;
    const info = this.activeByClientRequestId.get(`${clientRequestId}`);
    if (!info || Boolean(info.waitingForUserInput) === waitingForUserInput) return;

    info.waitingForUserInput = waitingForUserInput;
    this.emitChange();
  }

  setSessionWaitingForUserInput(sessionId: string | number | undefined, waitingForUserInput: boolean): void {
    const runtimeInfoList = this.getAllBySession(sessionId);
    const changedRuntimeInfoList = runtimeInfoList.filter(
      (runtimeInfo) => Boolean(runtimeInfo.waitingForUserInput) !== waitingForUserInput
    );
    if (!changedRuntimeInfoList.length) return;

    changedRuntimeInfoList.forEach((runtimeInfo) => {
      runtimeInfo.waitingForUserInput = waitingForUserInput;
    });
    this.emitChange();
  }

  getBySession(sessionId?: string): RuntimeInfo | undefined {
    if (!sessionId) return undefined;
    const clientRequestId = this.activeClientRequestIdsBySessionId.get(`${sessionId}`)?.values().next().value;
    if (!clientRequestId) return undefined;
    return this.activeByClientRequestId.get(clientRequestId);
  }

  getAllBySession(sessionId?: string | number): RuntimeInfo[] {
    if (!sessionId) return [];
    return Array.from(this.activeClientRequestIdsBySessionId.get(`${sessionId}`) || [])
      .map((clientRequestId) => this.activeByClientRequestId.get(clientRequestId))
      .filter(Boolean) as RuntimeInfo[];
  }

  getByClientRequest(clientRequestId?: string): RuntimeInfo | undefined {
    if (!clientRequestId) return undefined;
    return this.activeByClientRequestId.get(`${clientRequestId}`);
  }

  getByTrace(sessionId?: string | number, traceId?: string): RuntimeInfo | undefined {
    if (!sessionId || !traceId) return undefined;
    const clientRequestId = this.activeClientRequestIdByTraceKey.get(this.getScopedKey(sessionId, traceId));
    if (clientRequestId) {
      return this.activeByClientRequestId.get(clientRequestId);
    }
    return this.getAllBySession(sessionId).find((runtime) => `${runtime.traceId}` === `${traceId}`);
  }

  getByLane(sessionId?: string | number, laneId?: string | number): RuntimeInfo | undefined {
    if (!laneId) return undefined;
    const scopedClientRequestId = sessionId
      ? this.activeClientRequestIdByLaneKey.get(this.getScopedKey(sessionId, laneId))
      : undefined;
    const clientRequestId = scopedClientRequestId || this.activeClientRequestIdByLaneKey.get(`${laneId}`);
    if (clientRequestId) {
      return this.activeByClientRequestId.get(clientRequestId);
    }
    const candidates = sessionId ? this.getAllBySession(sessionId) : Array.from(this.activeByClientRequestId.values());
    return candidates.find((runtime) => `${runtime.laneId}` === `${laneId}`);
  }

  clear(): void {
    this.activeByClientRequestId.clear();
    this.activeClientRequestIdsBySessionId.clear();
    this.activeClientRequestIdByTraceKey.clear();
    this.activeClientRequestIdByLaneKey.clear();
    this.sessionRuntimeBySessionId.clear();
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

  private getScopedKey(sessionId?: string | number, value?: string | number): string {
    return `${sessionId || ''}:${value || ''}`;
  }

  private isProjectedRuntimeActive(runtime?: SessionRuntimeState): boolean {
    return Boolean(
      runtime &&
        (runtime.status === 'running' ||
          runtime.status === 'waiting_user' ||
          runtime.activeAgentCount > 0 ||
          runtime.waitingInteractionCount > 0)
    );
  }

  private addIndexes(info: RuntimeInfo): void {
    const clientRequestId = info.clientRequestId;
    this.getSessionIds(info).forEach((sessionId) => {
      const ids = this.activeClientRequestIdsBySessionId.get(sessionId) || new Set<string>();
      ids.add(clientRequestId);
      this.activeClientRequestIdsBySessionId.set(sessionId, ids);
    });
    if (info.traceId) {
      this.activeClientRequestIdByTraceKey.set(this.getScopedKey(info.sessionId, info.traceId), clientRequestId);
    }
    if (info.laneId) {
      this.activeClientRequestIdByLaneKey.set(`${info.laneId}`, clientRequestId);
      this.activeClientRequestIdByLaneKey.set(this.getScopedKey(info.sessionId, info.laneId), clientRequestId);
    }
  }

  private removeIndexes(info: RuntimeInfo): void {
    const clientRequestId = info.clientRequestId;
    this.getSessionIds(info).forEach((sessionId) => {
      const ids = this.activeClientRequestIdsBySessionId.get(sessionId);
      ids?.delete(clientRequestId);
      if (!ids?.size) {
        this.activeClientRequestIdsBySessionId.delete(sessionId);
      }
    });
    if (info.traceId) {
      this.activeClientRequestIdByTraceKey.delete(this.getScopedKey(info.sessionId, info.traceId));
    }
    if (info.laneId) {
      this.activeClientRequestIdByLaneKey.delete(`${info.laneId}`);
      this.activeClientRequestIdByLaneKey.delete(this.getScopedKey(info.sessionId, info.laneId));
    }
  }

  private getSessionIds(info: RuntimeInfo): string[] {
    return Array.from(new Set([info.sessionId, ...(info.sessionAliasIds || [])].filter(Boolean).map(String)));
  }
}

export const chatSessionRuntimeManager = new ChatSessionRuntimeManager();
