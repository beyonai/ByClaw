export type DocAsyncStatus = "pending" | "running" | "completed" | "failed";

export type DocAsyncTaskRecord = {
  taskId: string;
  messageId: string;
  requesterSessionKey: string;
  traceId: string;
  sessionId: string;
  targetWorkerId: string;
  targetAgentType: string;
  tenantId: string;
  resourceId: string;
  agentId: string;
  query: string;
  createdAt: number;
  updatedAt: number;
  status: DocAsyncStatus;
  completionReason?: string;
  readableMessage?: string;
  result?: unknown;
  error?: string;
};

export class DocAsyncState {
  private readonly byTaskId = new Map<string, DocAsyncTaskRecord>();
  private readonly bySessionId = new Map<string, string>();
  private readonly latestByAgentResource = new Map<string, string>();

  upsert(task: DocAsyncTaskRecord): void {
    const existing = this.byTaskId.get(task.taskId);
    const merged: DocAsyncTaskRecord = existing
      ? {
          ...existing,
          ...task,
          updatedAt: Date.now(),
        }
      : task;
    this.byTaskId.set(task.taskId, merged);
    this.bySessionId.set(task.sessionId, task.taskId);
    if (task.agentId && task.resourceId) {
      this.latestByAgentResource.set(`${task.agentId}:${task.resourceId}`, task.taskId);
    }
  }

  getByTaskId(taskId: string): DocAsyncTaskRecord | undefined {
    return this.byTaskId.get(taskId);
  }

  getBySessionId(sessionId: string): DocAsyncTaskRecord | undefined {
    const taskId = this.bySessionId.get(sessionId);
    return taskId ? this.byTaskId.get(taskId) : undefined;
  }

  getLatestByAgentResource(agentId: string, resourceId: string): DocAsyncTaskRecord | undefined {
    if (!agentId || !resourceId) {
      return undefined;
    }
    const taskId = this.latestByAgentResource.get(`${agentId}:${resourceId}`);
    return taskId ? this.byTaskId.get(taskId) : undefined;
  }

  list(limit = 200): DocAsyncTaskRecord[] {
    const rows = [...this.byTaskId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    return rows.slice(0, Math.max(1, limit));
  }

  complete(
    taskId: string,
    result: unknown,
    readableMessage?: string,
    completionReason?: string,
  ): DocAsyncTaskRecord | undefined {
    const task = this.byTaskId.get(taskId);
    if (!task) {
      return undefined;
    }
    task.status = "completed";
    task.result = result;
    task.readableMessage = readableMessage;
    task.completionReason = completionReason;
    task.error = undefined;
    task.updatedAt = Date.now();
    return task;
  }

  fail(
    taskId: string,
    error: string,
    readableMessage?: string,
    completionReason?: string,
  ): DocAsyncTaskRecord | undefined {
    const task = this.byTaskId.get(taskId);
    if (!task) {
      return undefined;
    }
    task.status = "failed";
    task.error = error;
    task.readableMessage = readableMessage;
    task.completionReason = completionReason;
    task.updatedAt = Date.now();
    return task;
  }
}

export const docAsyncState = new DocAsyncState();
