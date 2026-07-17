import {
  callAgent,
  QueueNames,
  RegistryKeys,
  WorkerRegistry,
  createRedisCallAgentDeps,
  RoutePolicy,
} from "@byclaw/by-framework";
import { isSubagentSessionKey } from "openclaw/plugin-sdk/routing";
import type {
  Capability,
  Dict,
  ExecutorFailure,
  ExecutorResponse,
  ResourceContext,
} from "./executor-types.js";
import { asString } from "./executor-types.js";
import { makeError } from "./errors.js";
import {
  diagnoseTraceInSessionStreams,
  pollDocResult,
  readRedisConfig,
  type DocDeltaCallback,
} from "./call-agent-doc.js";
import { logBaiyingRequest, type BaiyingEnhanceLogger } from "./debug-channel.js";
import {
  applyByFrameworkRedisKeyPatch,
  byFrameworkRedisKeys,
  createRedisClient,
  type RedisClient,
} from "./redis-compat.js";
import { getCallAgentAsyncModeResult } from "./delegated-tool-details.ts";
import {
  appendBaiyingRemoteTaskDeletedEvent,
  appendBaiyingRemoteTaskStartedEvent,
} from "./remote-task-log.js";

const DEFAULT_TRACKED_SYNC_TIMEOUT_SEC = 30 * 60;

export type CallAgentMode = "sync" | "async";

export type CallAgentExecutionAck = {
  message_id: string;
  parent_message_id?: string;
  trace_id: string;
  session_id: string;
  target_agent_type: string;
  stream_name: string;
  accepted_at_ms: number;
  runtime_hint?: string;
};

export type ExecuteViaCallAgentInput = {
  capability: Capability;
  content: string;
  payload: Dict;
  sessionId: string;
  traceId: string;
  targetAgentType: string;
  sourceAgentType?: string;
  defaultParentMessageId?: string;
  callMode?: CallAgentMode;
  syncTimeoutSec?: number;
  syncIntervalSec?: number;
  responseType: string;
  target: Dict;
  metadata?: Dict;
  userCode?: string;
  userName?: string;
  taskGroupId?: string;
  onDelta?: DocDeltaCallback;
  signal?: AbortSignal;
  logger?: BaiyingEnhanceLogger;
  parentMessageId: string;
  toolCallId?: string;
  langfuseParentObservationId?: string;
  langfuseTraceId?: string;
  resourceContext: ResourceContext;
};

function shouldTrackCallAgentRemoteTask(
  callMode: CallAgentMode,
  resourceContext: ResourceContext,
): boolean {
  return (
    callMode === "async" ||
    (callMode === "sync" && !isSubagentSessionKey(asString(resourceContext.session_key)))
  );
}

function resolveCallAgentSyncTimeoutSec(params: {
  callMode: CallAgentMode;
  shouldTrackRemoteTask: boolean;
  syncTimeoutSec?: number;
}): number | undefined {
  // 同步调用的情况下，暂时只处理非subagent。
  // 通过 sessions_spawn 启动的subagent，sessions_yield 后，父agent仍然会启动一个announce run总结。等待openclaw源码修复后再处理（目前已经提交PR处理:fix(agents): preserve yielded subagent continuations #106364)
  if (params.callMode === "sync" && params.shouldTrackRemoteTask) {
    return params.syncTimeoutSec ?? DEFAULT_TRACKED_SYNC_TIMEOUT_SEC;
  }
  return params.syncTimeoutSec;
}

export const __callAgentTestInternals = {
  DEFAULT_TRACKED_SYNC_TIMEOUT_SEC,
  resolveCallAgentSyncTimeoutSec,
  shouldTrackCallAgentRemoteTask,
};

export async function executeViaCallAgent(
  input: ExecuteViaCallAgentInput,
): Promise<ExecutorResponse> {
  let ctx: { redis: RedisClient; registry: WorkerRegistry };
  try {
    ctx = createCallAgentContext();
  } catch (err) {
    return makeError(
      "CALL_AGENT_CONNECT_FAILED",
      err instanceof Error ? err.message : String(err),
      { target: input.target },
    );
  }
  try {
    const startedAt = Date.now();
    const callMode = input.callMode ?? "sync";
    const requesterSessionKey = asString(
      input.resourceContext.requester_session_key ?? input.resourceContext.session_key,
    );
    const shouldTrackRemoteTask = shouldTrackCallAgentRemoteTask(callMode, input.resourceContext);
    const syncTimeoutSec = resolveCallAgentSyncTimeoutSec({
      callMode,
      shouldTrackRemoteTask,
      syncTimeoutSec: input.syncTimeoutSec,
    });
    const deps = createRedisCallAgentDeps({
      redis: ctx.redis as never,
      registry: ctx.registry,
    });
    const sourceAgentType =
      input.sourceAgentType ||
      (process.env.BAIYING_SOURCE_AGENT_TYPE ?? "openclaw").trim() ||
      "openclaw";
    let defaultParentMessageId =
      input.parentMessageId ||
      input.defaultParentMessageId ||
      asString(input.metadata?.parent_message_id) ||
      `parent-${input.traceId || startedAt}`;
    if (callMode === "async") {
      // 异步调用的话，parent_message_id 为 "-1"，否则call agent的输出会渲染到工具调用下面。但是异步调用的话，工具调用马上就会结束，折叠起来，用户看不到
      defaultParentMessageId = "-1";
    }
    const langfuseTraceId = asString(input.langfuseTraceId);
    const dispatchTraceId = langfuseTraceId || input.traceId;
    const originalTraceId = dispatchTraceId !== input.traceId ? input.traceId : "";

    const baseMetadata: Dict = {
      ...(input.metadata || {}),
      toolCallId: input.toolCallId,
    };
    if (originalTraceId) {
      baseMetadata.byclaw_original_trace_id = originalTraceId;
      baseMetadata.channel_trace_id ??= originalTraceId;
      baseMetadata.openclaw_trace_id ??= originalTraceId;
    }

    const metadata = withLangfuseSessionAliases(
      withLangfuseTraceAliases(
        withLangfuseParentObservationAliases(
          baseMetadata,
          input.langfuseParentObservationId,
        ),
        langfuseTraceId,
      ),
      input.sessionId,
      { includePlainSessionAliases: true },
    );
    const basePayload: Dict = { ...input.payload };
    if (originalTraceId) {
      basePayload.byclaw_original_trace_id = originalTraceId;
      basePayload.channel_trace_id ??= originalTraceId;
      basePayload.openclaw_trace_id ??= originalTraceId;
    }
    const payload = withLangfuseSessionAliases(
      withLangfuseTraceAliases(
        withLangfuseParentObservationAliases(basePayload, input.langfuseParentObservationId),
        langfuseTraceId,
      ),
      input.sessionId,
    );

    const langfuseSessionId = asString(input.sessionId);

    const payloadLangfuseContext = withLangfuseSessionAliases(
      withLangfuseTraceAliases(
        withLangfuseParentObservationAliases(
          originalTraceId ? { byclaw_original_trace_id: originalTraceId } : {},
          input.langfuseParentObservationId,
        ),
        langfuseTraceId,
      ),
      langfuseSessionId,
    );

    logBaiyingRequest(input.logger, "call_agent.dispatch", {
      resource_id: input.capability.metadata?.resource_id,
      resource_type: input.capability.resource_type,
      response_type: input.responseType,
      call_mode: input.callMode ?? "sync",
      target_agent_type: input.targetAgentType,
      source_agent_type: sourceAgentType,
      session_id: input.sessionId,
      trace_id: input.traceId,
      dispatch_trace_id: dispatchTraceId,
      default_parent_message_id: defaultParentMessageId,
      wait_for_reply: false,
      user_code: input.userCode ?? nonEmptyEnv("USER_CODE"),
      user_name: input.userName ?? nonEmptyEnv("USER_NAME"),
      task_group_id: input.taskGroupId ?? "",
      langfuse_parent_observation_id: input.langfuseParentObservationId,
      langfuse_trace_id: langfuseTraceId,
      langfuse_session_id: langfuseSessionId,
      metadata,
      content: input.content,
      payload,
      sync_timeout_sec: input.syncTimeoutSec,
      sync_interval_sec: input.syncIntervalSec,
      target: input.target,
    });

    const result = await callAgent(
      deps,
      {
        sessionId: input.sessionId,
        traceId: dispatchTraceId,
        sourceAgentType,
        defaultParentMessageId,
        targetAgentType: input.targetAgentType,
        content: input.content,
        extraPayload: {
          ...payload,
          ...payloadLangfuseContext,
        },
        waitForReply: false,
        userCode: input.userCode ?? nonEmptyEnv("USER_CODE"),
        userName: input.userName ?? nonEmptyEnv("USER_NAME"),
        taskGroupId: input.taskGroupId,
        metadata,
        langfuseParentObservationId: input.langfuseParentObservationId,
        routePolicy: RoutePolicy.WAKE_AND_WAIT,
      },
    );

    if (result.status !== "QUEUED") {
      return makeError(
        "CALL_AGENT_DISPATCH_FAILED",
        result.error || `callAgent failed: status=${result.status}`,
        {
          status: result.status,
          error_code: result.error_code,
          target: input.target,
        },
      );
    }

    const ack: CallAgentExecutionAck = {
      message_id: result.messageId,
      parent_message_id: result.parentMessageId,
      trace_id: dispatchTraceId,
      session_id: input.sessionId,
      target_agent_type: result.targetAgentType,
      stream_name: QueueNames.ctrl_stream(input.targetAgentType),
      accepted_at_ms: startedAt,
      runtime_hint: result.runtimeHint,
    };

    if (shouldTrackRemoteTask) {
      const selectedResource = input.resourceContext.selected_resource;
      const createdAt = Date.now();
      const record = {
        taskId: ack.message_id,
        messageId: ack.message_id,
        requesterSessionKey,
        parentSessionKey: asString(input.resourceContext.parent_session_key),
        traceId: ack.trace_id,
        sessionId: ack.session_id,
        streamName: byFrameworkRedisKeys.sessionDataStream(ack.session_id),
        toolCallId: asString(input.toolCallId),
        targetWorkerId: asString(input.target.target_worker_id),
        targetAgentType: ack.target_agent_type || asString(input.target.target_agent_type),
        tenantId: asString(input.target.tenant_id),
        resourceId:
          asString(input.target.resource_id) || asString(selectedResource?.resourceId),
        query: input.content,
        createdAt,
        pollAfter:
          callMode === "sync" && syncTimeoutSec !== undefined
            ? createdAt + syncTimeoutSec * 1000
            : undefined,
        accountId: asString(input.resourceContext.accountId),
        language: asString(input.resourceContext.language),
        beyondToken: asString(input.resourceContext.beyondToken),
      };
      await appendBaiyingRemoteTaskStartedEvent(record).catch((err) => {
        logBaiyingRequest(input.logger, "call_agent.track_failed", {
          task: record,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    if (callMode === "async") {
      return getCallAgentAsyncModeResult(ack, input);
    }

    const poll = await pollDocResult({
      redis: ctx.redis,
      sessionId: input.sessionId,
      traceId: dispatchTraceId,
      messageId: result.messageId,
      timeoutSec: syncTimeoutSec,
      intervalSec: input.syncIntervalSec,
      sinceMs: startedAt,
      streamName: byFrameworkRedisKeys.sessionDataStream(input.sessionId),
      onDelta: input.onDelta,
      signal: input.signal,
      toolCallId: input.toolCallId,
    });

    if (!poll.success) {
      // poll 超时后，自动切换到 async 模式 -> 记录任务，通过 remote-task-watch 拉取结果
      if (poll.event_type === "timeout" && shouldTrackRemoteTask) {
        return getCallAgentAsyncModeResult(ack, input);
      }
      let diagnosis: unknown;
      if (poll.event_type === "timeout") {
        diagnosis = await diagnoseTraceInSessionStreams({
          redis: ctx.redis,
          traceId: dispatchTraceId,
        }).catch(() => undefined);
      }
      return makeError("CALL_AGENT_SYNC_FAILED", poll.text || "callAgent sync call failed", {
        type: `${input.responseType}_sync`,
        status: "failed",
        backend: "call_agent_sdk",
        data: { ack, poll: diagnosis !== undefined ? { ...poll, diagnosis } : poll },
        target: input.target,
      });
    }

    if (shouldTrackRemoteTask) {
      await appendBaiyingRemoteTaskDeletedEvent(asString(input.toolCallId)).catch((err) => {
        logBaiyingRequest(input.logger, "call_agent.track_delete_failed", {
          tool_call_id: input.toolCallId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return {
      success: true,
      status: "completed",
      backend: "call_agent_sdk",
      data: { ack, text: poll.text || "" },
      type: `${input.responseType}_sync`,
      target: input.target,
    };
  } catch (err) {
    const failure: ExecutorFailure = makeError(
      "CALL_AGENT_FAILED",
      err instanceof Error ? err.message : String(err),
      { target: input.target },
    );
    return failure;
  } finally {
    await ctx.redis.quit().catch(() => undefined);
  }
}

function withLangfuseParentObservationAliases(
  value: Dict,
  langfuseParentObservationId?: string,
): Dict {
  if (!langfuseParentObservationId) {
    return value;
  }
  return {
    ...value,
    langfuseParentObservationId,
    langfuse_parent_observation_id: langfuseParentObservationId,
    parentObservationId: langfuseParentObservationId,
    parent_observation_id: langfuseParentObservationId,
  };
}

function withLangfuseSessionAliases(
  value: Dict,
  langfuseSessionId?: string,
  options: { includePlainSessionAliases?: boolean } = {},
): Dict {
  if (!langfuseSessionId) {
    return value;
  }
  return {
    ...value,
    ...(options.includePlainSessionAliases
      ? { sessionId: langfuseSessionId, session_id: langfuseSessionId }
      : {}),
    langfuseSessionId,
    langfuse_session_id: langfuseSessionId,
    "langfuse.session.id": langfuseSessionId,
    "session.id": langfuseSessionId,
  };
}

function withLangfuseTraceAliases(value: Dict, langfuseTraceId?: string): Dict {
  if (!langfuseTraceId) {
    return value;
  }
  return {
    ...value,
    langfuseTraceId,
    langfuse_trace_id: langfuseTraceId,
  };
}

function isRecord(value: unknown): value is Dict {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function createCallAgentContext(): { redis: RedisClient; registry: WorkerRegistry } {
  const config = readRedisConfig();
  applyByFrameworkRedisKeyPatch({ QueueNames, RegistryKeys }, config);
  const redis = createRedisClient(config);
  return { redis, registry: new WorkerRegistry(redis as never) };
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}
