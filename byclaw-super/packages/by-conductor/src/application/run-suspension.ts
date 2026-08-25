/** 外部任务已投递，当前 Leader Run 应释放执行权并等待独立回调。 */
export class DelegationSuspendedError extends Error {
  constructor(
    readonly runId: string,
    readonly delegationId: string,
  ) {
    super(`Delegation suspended pending callback: ${delegationId}`);
    this.name = "DelegationSuspendedError";
  }
}

/** Pi 工具调用已安全投递到外部 Agent；RunService 应保留 WAITING_AGENT 而非判失败。 */
export class LeaderRunSuspendedError extends Error {
  constructor(readonly delegationId: string) {
    super(`Leader run suspended pending delegation callback: ${delegationId}`);
    this.name = "LeaderRunSuspendedError";
  }
}
