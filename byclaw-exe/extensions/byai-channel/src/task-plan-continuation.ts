import {
  clearTaskPlanExecutionContext,
  markTaskPlanContinuationPending,
  resolveTaskPlanRuntimeBridge,
  resolveTaskPlanExecutionContext,
  type TaskPlanExecutionContext,
  type TaskPlanSnapshot,
} from "../../shared/src/task-plan-runtime.js";
import {
  isActiveSdkRequestReadyForTaskPlanContinuation,
  resolveActiveSdkRequestBySessionKey,
  type ActiveSdkRequest,
} from "./session-context.js";

const MAX_TASK_PLAN_STALL_ATTEMPTS = 3;
const CONTINUATION_READY_POLL_MS = 100;
const CONTINUATION_READY_TIMEOUT_MS = 30 * 60 * 1000;

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildExecutionContext(request: ActiveSdkRequest): TaskPlanExecutionContext | undefined {
  const messageId = request.messageId?.trim();
  if (!messageId) {
    return undefined;
  }
  const remembered = resolveTaskPlanExecutionContext(request.sessionKey);
  if (
    remembered &&
    remembered.sessionId === request.sessionId &&
    remembered.messageId === messageId
  ) {
    return {
      ...remembered,
      ...(request.beyondToken ? { beyondToken: request.beyondToken } : {}),
    };
  }
  const runIds = [...request.boundRunIds];
  const sourceRunId = runIds[runIds.length - 1] || request.traceId || request.sessionKey;
  return {
    sessionKey: request.sessionKey,
    sessionId: request.sessionId,
    messageId,
    ...(request.traceId ? { traceId: request.traceId } : {}),
    ...(request.laneMetadata?.turnId ? { turnId: request.laneMetadata.turnId } : {}),
    ...(request.laneMetadata?.laneId ? { laneId: request.laneMetadata.laneId } : {}),
    sourceRuntime: "OPENCLAW",
    sourceRunId,
    ...(request.beyondToken ? { beyondToken: request.beyondToken } : {}),
  };
}

function buildContinuationPrompt(language: string, plan: TaskPlanSnapshot): string {
  const current = plan.tasks.find((task) => task.status === "IN_PROGRESS");
  if (language.toLowerCase().startsWith("zh")) {
    return [
      "当前权威任务计划仍处于 ACTIVE 状态，请继续执行，不要提前结束本轮会话。",
      current
        ? `继续当前第 ${current.position} 项任务：${current.title}`
        : "请检查活动计划并继续当前未完成任务。",
      "不要重复已完成的任务；每当当前任务完成、失败或跳过时，立即调用 updateTaskPlan 更新状态。",
      "只有计划进入 COMPLETED、FAILED 或 CANCELLED 终态后，才能向用户给出最终答复。",
    ].join("\n");
  }
  return [
    "The authoritative task plan is still ACTIVE. Continue executing it and do not end this response early.",
    current
      ? `Continue task ${current.position}: ${current.title}`
      : "Inspect the active plan and continue its current unfinished task.",
    "Do not repeat completed tasks. Call updateTaskPlan immediately whenever the current task completes, fails, or is skipped.",
    "Only provide the final user answer after the plan reaches COMPLETED, FAILED, or CANCELLED.",
  ].join("\n");
}

async function waitUntilContinuationReady(params: {
  request: ActiveSdkRequest;
  signal?: AbortSignal;
}): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    if (params.signal?.aborted) {
      return false;
    }
    const latest = resolveActiveSdkRequestBySessionKey(params.request.sessionKey);
    if (!latest || latest !== params.request) {
      return false;
    }
    if (isActiveSdkRequestReadyForTaskPlanContinuation(latest)) {
      return true;
    }
    if (Date.now() - startedAt >= CONTINUATION_READY_TIMEOUT_MS) {
      throw new Error(
        `task plan continuation readiness timed out: sessionKey=${params.request.sessionKey}`,
      );
    }
    await sleep(CONTINUATION_READY_POLL_MS);
  }
}

/**
 * Continue an ACTIVE backend plan under the channel's existing dispatch lease.
 * Each unchanged continuation consumes one stall attempt; the third unchanged
 * attempt fails the current task through the same authoritative backend API.
 */
export async function continueActiveTaskPlan(params: {
  request: ActiveSdkRequest;
  language: string;
  signal?: AbortSignal;
  dispatch: (prompt: string) => Promise<void>;
  logger?: LoggerLike;
}): Promise<void> {
  const bridge = resolveTaskPlanRuntimeBridge();
  const firstContext = buildExecutionContext(params.request);
  if (!bridge || !firstContext) {
    markTaskPlanContinuationPending(params.request.sessionKey, false);
    return;
  }

  let activePlan: TaskPlanSnapshot | undefined;
  try {
    params.logger?.info?.(
      `[task-plan] continuation lookup sessionKey=${params.request.sessionKey}, ` +
        `sessionId=${firstContext.sessionId}, messageId=${firstContext.messageId}, ` +
        `traceId=${firstContext.traceId ?? "-"}, sourceRunId=${firstContext.sourceRunId}`,
    );
    activePlan = await bridge.loadActive(firstContext, params.signal);
    if (activePlan?.status !== "ACTIVE") {
      params.logger?.info?.(
        `[task-plan] continuation stopped: no active owned plan sessionKey=${params.request.sessionKey}, ` +
          `sessionId=${firstContext.sessionId}, messageId=${firstContext.messageId}, ` +
          `sourceRunId=${firstContext.sourceRunId}`,
      );
      clearTaskPlanExecutionContext(params.request.sessionKey);
      markTaskPlanContinuationPending(params.request.sessionKey, false);
      return;
    }

    markTaskPlanContinuationPending(params.request.sessionKey, true);
    let previousVersion = activePlan.version;
    let stalledAttempts = 0;

    while (activePlan.status === "ACTIVE") {
      const ready = await waitUntilContinuationReady({
        request: params.request,
        signal: params.signal,
      });
      if (!ready || params.signal?.aborted) {
        markTaskPlanContinuationPending(params.request.sessionKey, false);
        return;
      }

      params.logger?.info?.(
        `[task-plan] continuation dispatch sessionKey=${params.request.sessionKey}, ` +
          `sessionId=${firstContext.sessionId}, messageId=${firstContext.messageId}, ` +
          `sourceRunId=${firstContext.sourceRunId}, ` +
          `planId=${activePlan.planId}, version=${activePlan.version}, stalledAttempts=${stalledAttempts}`,
      );
      await params.dispatch(buildContinuationPrompt(params.language, activePlan));
      if (params.signal?.aborted) {
        markTaskPlanContinuationPending(params.request.sessionKey, false);
        return;
      }

      const context = buildExecutionContext(params.request) ?? firstContext;
      const latest = await bridge.loadActive(context, params.signal);
      if (latest?.status !== "ACTIVE") {
        clearTaskPlanExecutionContext(params.request.sessionKey);
        markTaskPlanContinuationPending(params.request.sessionKey, false);
        return;
      }

      if (latest.version === previousVersion) {
        stalledAttempts += 1;
      } else {
        stalledAttempts = 0;
      }
      previousVersion = latest.version;
      activePlan = latest;

      if (stalledAttempts < MAX_TASK_PLAN_STALL_ATTEMPTS) {
        continue;
      }

      params.logger?.warn?.(
        `[byai-channel] task plan made no progress after ${MAX_TASK_PLAN_STALL_ATTEMPTS} continuation attempts; failing current task: sessionKey=${params.request.sessionKey}, planId=${activePlan.planId}, version=${activePlan.version}`,
      );
      const failure = await bridge.command({
        context,
        idempotencyKey: `openclaw-stall:${activePlan.planId}:${activePlan.version}`.slice(0, 128),
        command: {
          action: "fail_current",
          statusReason: {
            code: "TASK_PLAN_STALLED",
            message: `No task-plan progress after ${MAX_TASK_PLAN_STALL_ATTEMPTS} automatic continuation attempts`,
          },
        },
        signal: params.signal,
      });
      clearTaskPlanExecutionContext(params.request.sessionKey);
      markTaskPlanContinuationPending(params.request.sessionKey, false);
      if (!failure.ok && failure.currentPlan?.status === "ACTIVE") {
        throw new Error(
          `failed to mark stalled task plan current task as failed: ${failure.error.code}: ${failure.error.message}`,
        );
      }
      return;
    }
  } catch (error) {
    markTaskPlanContinuationPending(params.request.sessionKey, false);
    if (params.signal?.aborted) {
      return;
    }
    throw error;
  }
}
