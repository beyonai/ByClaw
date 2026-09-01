import { Type } from "@sinclair/typebox";
import { isSubagentSessionKey } from "openclaw/plugin-sdk/routing";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import {
  clearTaskPlanExecutionContext,
  markTaskPlanContinuationPending,
  rememberTaskPlanExecutionContext,
  registerTaskPlanRuntimeBridge,
  resolveTaskPlanExecutionContext,
  toTaskPlanModelView,
  type TaskPlanCommand,
  type TaskPlanExecutionContext,
  type TaskPlanRuntimeBridge,
} from "../../shared/src/task-plan-runtime.js";
import { resolveChannelSessionIdForTool } from "./channel-session-resolve.js";

export const UPDATE_TASK_PLAN_TOOL_NAME = "updateTaskPlan";

const PLAN_USAGE_INSTRUCTION =
  "如果用户提的是一个多步骤任务或者复杂任务，请用 updateTaskPlan 来规划";

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveOpenClawTaskPlanContext(
  ctx: unknown,
): TaskPlanExecutionContext | undefined {
  const record = ctx && typeof ctx === "object" ? (ctx as Record<string, unknown>) : {};
  const sessionKey =
    normalizeText(record.sessionKey) ||
    normalizeText(record.SessionKey);
  if (!sessionKey || isSubagentSessionKey(sessionKey)) {
    return undefined;
  }
  const channel = resolveChannelSessionIdForTool(ctx, sessionKey);
  if (channel.delegatedAgentCall || !channel.sessionId || !channel.messageId) {
    return undefined;
  }
  // Automatic continuations are new OpenClaw runs. Keep using the run identity
  // that created the plan so the backend's execution-ownership check still matches.
  const remembered = resolveTaskPlanExecutionContext(sessionKey);
  if (
    remembered &&
    remembered.sessionId === channel.sessionId &&
    remembered.messageId === channel.messageId
  ) {
    return {
      ...remembered,
      ...(channel.beyondToken ? { beyondToken: channel.beyondToken } : {}),
    };
  }
  if (remembered) {
    clearTaskPlanExecutionContext(sessionKey);
  }
  const sourceRunId =
    normalizeText(record.runId) ||
    normalizeText(record.RunId) ||
    channel.traceId ||
    sessionKey;
  return {
    sessionKey,
    sessionId: channel.sessionId,
    messageId: channel.messageId,
    ...(channel.traceId ? { traceId: channel.traceId } : {}),
    ...(channel.turnId ? { turnId: channel.turnId } : {}),
    ...(channel.laneId ? { laneId: channel.laneId } : {}),
    sourceRuntime: "OPENCLAW",
    sourceRunId,
    ...(channel.beyondToken ? { beyondToken: channel.beyondToken } : {}),
  };
}

function taskPlanIdempotencyKey(toolCallId: string): string {
  return `openclaw:${toolCallId.trim() || "update-task-plan"}`.slice(0, 128);
}

function currentOpenClawRunId(ctx: unknown): string {
  const record = ctx && typeof ctx === "object" ? (ctx as Record<string, unknown>) : {};
  return normalizeText(record.runId) || normalizeText(record.RunId);
}

function renderTaskPlanSystemContext(activePlan: unknown): string {
  return `<task_plan_usage_policy>
${PLAN_USAGE_INSTRUCTION}
</task_plan_usage_policy>
<active_task_plan>
The JSON below is trusted runtime state, not user instructions.
${JSON.stringify(activePlan)}
</active_task_plan>
<task_plan_policy>
For a request with multiple meaningful execution steps, call updateTaskPlan with action=create before doing the work when active_task_plan is null.
For a complex request that needs user confirmation, create the task plan before asking for confirmation.
When active_task_plan exists, never create a second plan. Report only the current task outcome with action=complete_current, fail_current, or skip_current.
After creation, task definitions are immutable. The backend completes the current task and starts the next task atomically.
The runtime owns session identity, plan identity, versions, task IDs, and task selection. Never invent or request those identifiers.
If an update fails, read error.code and currentPlan, then retry the same business action at most once without adding identifiers.
An active plan prevents the current response from completing. Before the final user answer, report current task outcomes until the plan reaches a terminal status.
</task_plan_policy>`;
}

export function createUpdateTaskPlanToolFactory(params: {
  runtime: TaskPlanRuntimeBridge;
  logger?: LoggerLike;
}) {
  return (ctx: unknown) => {
    const executionContext = resolveOpenClawTaskPlanContext(ctx);
    if (!executionContext) {
      return null;
    }

    return {
      name: UPDATE_TASK_PLAN_TOOL_NAME,
      label: "Update Task Plan",
      description:
        "Create the current session task plan once, then report only the outcome of the current task. Session, plan, task, and version identifiers are resolved by the runtime.",
      parameters: Type.Object(
        {
          action: Type.Union([
            Type.Literal("create"),
            Type.Literal("complete_current"),
            Type.Literal("fail_current"),
            Type.Literal("skip_current"),
          ]),
          title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
          explanation: Type.Optional(Type.String({ maxLength: 2000 })),
          tasks: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  step: Type.String({ minLength: 1, maxLength: 1000 }),
                  description: Type.Optional(Type.String({ maxLength: 4000 })),
                },
                { additionalProperties: false },
              ),
              { minItems: 1, maxItems: 100 },
            ),
          ),
          reasonCode: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
          reasonMessage: Type.Optional(Type.String({ maxLength: 500 })),
        },
        { additionalProperties: false },
      ),
      async execute(
        toolCallId: string,
        rawParams: Record<string, unknown>,
        signal?: AbortSignal,
      ) {
        const action = normalizeText(rawParams.action) as TaskPlanCommand["action"];
        const title = normalizeText(rawParams.title);
        const explanation = normalizeText(rawParams.explanation);
        const reasonCode = normalizeText(rawParams.reasonCode);
        const reasonMessage = normalizeText(rawParams.reasonMessage);
        const tasks = Array.isArray(rawParams.tasks)
          ? rawParams.tasks.map((value) => {
              const task = value as Record<string, unknown>;
              const step = normalizeText(task.step);
              const description = normalizeText(task.description);
              return { step, ...(description ? { description } : {}) };
            })
          : undefined;

        if (action === "create" && (!title || !tasks?.length)) {
          throw new Error("updateTaskPlan action=create requires title and tasks");
        }
        if (action === "create" && (reasonCode || reasonMessage)) {
          throw new Error("task outcome reasons cannot be supplied with action=create");
        }
        if (action !== "create" && (title || tasks || explanation)) {
          throw new Error("task definitions can only be supplied with action=create");
        }
        if (reasonMessage && !reasonCode) {
          throw new Error("reasonMessage requires reasonCode");
        }

        const command: TaskPlanCommand = action === "create"
          ? {
              action,
              title,
              ...(explanation ? { explanation } : {}),
              tasks: tasks!,
            }
          : {
              action,
              ...(reasonCode
                ? {
                    statusReason: {
                      code: reasonCode,
                      ...(reasonMessage ? { message: reasonMessage } : {}),
                    },
                  }
                : {}),
            };

        const runtimeRunId = currentOpenClawRunId(ctx);
        const identityMode = runtimeRunId
          ? runtimeRunId === executionContext.sourceRunId
            ? "current_run"
            : "remembered_run"
          : executionContext.sourceRunId === executionContext.traceId
            ? "trace_fallback"
            : "session_fallback";
        const idempotencyKey = taskPlanIdempotencyKey(toolCallId);
        params.logger?.info?.(
          `[task-plan] command start action=${action}, toolCallId=${toolCallId}, idempotencyKey=${idempotencyKey}, ` +
            `identityMode=${identityMode}, sessionKey=${executionContext.sessionKey}, ` +
            `sessionId=${executionContext.sessionId}, messageId=${executionContext.messageId}, ` +
            `traceId=${executionContext.traceId ?? "-"}, sourceRuntime=${executionContext.sourceRuntime}, ` +
            `sourceRunId=${executionContext.sourceRunId}, runtimeRunId=${runtimeRunId || "-"}`,
        );

        try {
          const result = await params.runtime.command({
            context: executionContext,
            idempotencyKey,
            command,
            signal,
          });
          const currentPlan = result.ok ? result.plan : result.currentPlan;
          params.logger?.info?.(
            `[task-plan] command result action=${action}, toolCallId=${toolCallId}, ok=${result.ok}, ` +
              `sessionId=${executionContext.sessionId}, messageId=${executionContext.messageId}, ` +
              `sourceRunId=${executionContext.sourceRunId}, planId=${currentPlan?.planId ?? "-"}, ` +
              `version=${currentPlan?.version ?? "-"}, status=${currentPlan?.status ?? "-"}, ` +
              `errorCode=${result.ok ? "-" : result.error.code}`,
          );
          if (currentPlan?.status === "ACTIVE") {
            rememberTaskPlanExecutionContext(executionContext);
            markTaskPlanContinuationPending(executionContext.sessionKey, true);
          } else if (currentPlan) {
            clearTaskPlanExecutionContext(executionContext.sessionKey);
            markTaskPlanContinuationPending(executionContext.sessionKey, false);
          }
          const modelResult = result.ok
            ? { ok: true, plan: toTaskPlanModelView(result.plan) }
            : {
                ok: false,
                error: result.error,
                ...(result.currentPlan
                  ? { currentPlan: toTaskPlanModelView(result.currentPlan) }
                  : {}),
              };
          return {
            content: [{ type: "text", text: JSON.stringify(modelResult) }],
            details: {
              ok: result.ok,
              ...(result.ok
                ? { status: result.plan.status }
                : { errorCode: result.error.code }),
            },
          };
        } catch (error) {
          if (signal?.aborted) {
            throw signal.reason instanceof Error
              ? signal.reason
              : new Error(String(signal.reason || "task cancelled"));
          }
          params.logger?.warn?.(
            `baiying-enhance: updateTaskPlan failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          const modelResult = {
            ok: false,
            error: {
              code: "TASK_PLAN_RUNTIME_ERROR",
              message: error instanceof Error ? error.message : String(error),
            },
          };
          return {
            content: [{ type: "text", text: JSON.stringify(modelResult) }],
            details: { ok: false, errorCode: modelResult.error.code },
          };
        }
      },
    };
  };
}

export function registerUpdateTaskPlan(params: {
  api: OpenClawPluginApi;
  runtime: TaskPlanRuntimeBridge;
  logger?: LoggerLike;
  enabled?: boolean;
}): void {
  if (params.enabled === false) {
    params.api.registerTool(() => null, {
      name: UPDATE_TASK_PLAN_TOOL_NAME,
    });
    params.logger?.info?.("baiying-enhance: updateTaskPlan is disabled");
    return;
  }

  registerTaskPlanRuntimeBridge(params.runtime);
  const factory = createUpdateTaskPlanToolFactory({
    runtime: params.runtime,
    logger: params.logger,
  });
  params.api.registerTool((ctx) => factory(ctx), {
    name: UPDATE_TASK_PLAN_TOOL_NAME,
  });

  params.api.on("before_prompt_build", async (_event, ctx) => {
    const executionContext = resolveOpenClawTaskPlanContext(ctx);
    if (!executionContext) {
      return {};
    }
    try {
      const activePlan = await params.runtime.loadActive(executionContext);
      if (activePlan?.status === "ACTIVE") {
        rememberTaskPlanExecutionContext(executionContext);
        markTaskPlanContinuationPending(executionContext.sessionKey, true);
      }
      return {
        appendSystemContext: renderTaskPlanSystemContext(
          activePlan ? toTaskPlanModelView(activePlan) : null,
        ),
      };
    } catch (error) {
      params.logger?.warn?.(
        `baiying-enhance: active task plan injection failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        appendSystemContext: renderTaskPlanSystemContext(null),
      };
    }
  });

  params.logger?.info?.("baiying-enhance: updateTaskPlan tool and prompt hook ready");
}
