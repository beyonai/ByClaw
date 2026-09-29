/** 暂停当前执行栈，由持久队列恢复；不能据此取消远端任务或终结业务 Run。 */
export class RecoverableExecutionError extends Error {}

/** 执行权丢失或无法确认时停止本地工作。 */
export class ExecutionOwnershipLostError extends RecoverableExecutionError {
  constructor(runId: string, options?: ErrorOptions) {
    super(`Run lease fencing token lost: ${runId}`, options);
    this.name = "ExecutionOwnershipLostError";
  }
}

/** 远端可能已接收派发；只有幂等重试可以裁决结果，不能猜测失败并新建任务。 */
export class ConnectorDispatchUncertainError extends RecoverableExecutionError {
  constructor(runId: string, options?: ErrorOptions) {
    super(`Connector dispatch outcome is uncertain: ${runId}`, options);
    this.name = "ConnectorDispatchUncertainError";
  }
}

export function isRecoverableExecutionError(error: unknown): boolean {
  return error instanceof RecoverableExecutionError || isExecutionOwnershipLost(error);
}

/** 兼容旧版存储 Port 的 fencing 错误，滚动升级期间也保持相同的停止语义。 */
export function isExecutionOwnershipLost(error: unknown): boolean {
  return error instanceof ExecutionOwnershipLostError ||
    (error instanceof Error && error.message.startsWith("Run lease fencing token lost"));
}

/** 数据库已经确认用户取消；即使旧执行租约已过期，也应停止该 Run 的远端任务。 */
export class RunCancellationRequestedError extends Error {
  constructor(runId: string, reason = "Run cancelled") {
    super(`${reason}: ${runId}`);
    this.name = "RunCancellationRequestedError";
  }
}
