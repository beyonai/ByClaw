import {
  QueueNames,
  WorkerRegistry,
  buildAskAgentPublishArtifacts,
  createRedis,
  createRedisCallAgentDeps,
  publishWithExecutionRecord,
  resolveCallAgentPublishIds,
  type CallAgentPublishInput,
  type CallAgentPublishResult,
} from "@byclaw/by-framework";
import type { Redis } from "ioredis";
import type { Capability, Dict, ExecutorFailure, ExecutorResponse } from "./types.js";
import { asString } from "./types.js";
import { makeError } from "./errors.js";
import {
  diagnoseTraceInSessionStreams,
  pollDocResult,
  readRedisConfig,
  type DocDeltaCallback,
} from "./doc-shared.js";
import { logBaiyingRequest, type BaiyingEnhanceLogger } from "./debug-channel.js";

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
  syncTimeoutSec: number;
  syncIntervalSec: number;
  responseType: string;
  target: Dict;
  metadata?: Dict;
  userCode?: string;
  userName?: string;
  taskGroupId?: string;
  probeAgentType?: boolean;
  onDelta?: DocDeltaCallback;
  signal?: AbortSignal;
  logger?: BaiyingEnhanceLogger;
  parentMessageId: string;
  toolCallId?: string;
  langfuseParentObservationId?: string;
  langfuseTraceId?: string;
};

export async function executeViaCallAgent(
  input: ExecuteViaCallAgentInput,
): Promise<ExecutorResponse> {
  let ctx: { redis: Redis; registry: WorkerRegistry };
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
    const deps = createRedisCallAgentDeps({
      redis: ctx.redis,
      registry: ctx.registry,
    });
    const sourceAgentType =
      input.sourceAgentType ||
      (process.env.BAIYING_SOURCE_AGENT_TYPE ?? "openclaw").trim() ||
      "openclaw";
    const defaultParentMessageId =
      input.parentMessageId ||
      input.defaultParentMessageId ||
      asString(input.metadata?.parent_message_id) ||
      `parent-${input.traceId || startedAt}`;
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

    const langfuseContext = withLangfuseSessionAliases(
      withLangfuseTraceAliases(
        withLangfuseParentObservationAliases(
          originalTraceId ? { byclaw_original_trace_id: originalTraceId } : {},
          input.langfuseParentObservationId,
        ),
        langfuseTraceId,
      ),
      langfuseSessionId,
      { includePlainSessionAliases: true },
    );

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

    const commandLangfuseContext = {
      header: langfuseContext,
      extraPayload: payloadLangfuseContext,
    };

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
      probe_agent_type: input.probeAgentType ?? false,
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

    const dispatch = await publishCallAgentWithLangfuseContext({
      deps,
      input: {
        sessionId: input.sessionId,
        traceId: dispatchTraceId,
        sourceAgentType,
        defaultParentMessageId,
        targetAgentType: input.targetAgentType,
        content: input.content,
        payload,
        waitForReply: false,
        userCode: input.userCode ?? nonEmptyEnv("USER_CODE"),
        userName: input.userName ?? nonEmptyEnv("USER_NAME"),
        taskGroupId: input.taskGroupId,
        metadata,
        probeAgentType: input.probeAgentType ?? false,
      },
      langfuseContext: commandLangfuseContext,
    });
    const result = dispatch.result;
    if (dispatch.commandPayload) {
      logBaiyingRequest(input.logger, "call_agent.command_payload", dispatch.commandPayload);
    }

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

    if ((input.callMode ?? "sync") === "async") {
      return {
        success: true,
        type: `${input.responseType}_async`,
        status: "running",
        backend: "call_agent_sdk",
        data: ack,
        target: input.target,
      };
    }

    const poll = await pollDocResult({
      redis: ctx.redis,
      sessionId: input.sessionId,
      traceId: dispatchTraceId,
      messageId: result.messageId,
      timeoutSec: input.syncTimeoutSec,
      intervalSec: input.syncIntervalSec,
      sinceMs: startedAt,
      streamName: QueueNames.session_data_stream(input.sessionId),
      onDelta: input.onDelta,
      signal: input.signal,
      toolCallId: input.toolCallId,
    });

    if (!poll.success) {
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

async function publishCallAgentWithLangfuseContext(params: {
  deps: ReturnType<typeof createRedisCallAgentDeps>;
  input: CallAgentPublishInput;
  langfuseContext: { header: Dict; extraPayload: Dict };
}): Promise<{ result: CallAgentPublishResult; commandPayload?: Record<string, unknown> }> {
  if (params.input.probeAgentType ?? true) {
    const probe = await params.deps.probe.probeAgentTypeOnline(params.input.targetAgentType);
    if (!probe.ok) {
      return {
        result: {
          status: "FAILED",
          messageId: "",
          parentMessageId: params.input.parentMessageId || params.input.defaultParentMessageId,
          targetAgentType: params.input.targetAgentType,
          error: probe.error ?? `No alive worker found with agent type '${params.input.targetAgentType}'`,
          error_code: probe.error_code ?? "AGENT_TYPE_NOT_FOUND",
        },
      };
    }
  }

  const { messageId, parentMessageId, waitForReply } = resolveCallAgentPublishIds(params.input);
  const artifacts = buildAskAgentPublishArtifacts(
    params.input,
    messageId,
    parentMessageId,
    waitForReply,
    QueueNames,
  );
  const commandPayload = withCommandLangfuseContext(
    artifacts.command.toDict(),
    params.langfuseContext,
  );
  await publishWithExecutionRecord({
    execution: params.deps.execution,
    bus: params.deps.bus,
    executionRecord: artifacts.executionRecord,
    streamName: artifacts.ctrlStreamName,
    serializedCommandJson: JSON.stringify(commandPayload),
  });
  return {
    result: {
      status: "QUEUED",
      messageId,
      parentMessageId,
      targetAgentType: params.input.targetAgentType,
      runtimeHint: waitForReply ? "suspend" : "transfer",
    },
    commandPayload,
  };
}

function withCommandLangfuseContext(
  commandPayload: Record<string, unknown>,
  langfuseContext: { header: Dict; extraPayload: Dict },
): Record<string, unknown> {
  const header = isRecord(commandPayload.header) ? commandPayload.header : {};
  const body = isRecord(commandPayload.body) ? commandPayload.body : {};
  const extraPayload = isRecord(body.extra_payload) ? body.extra_payload : {};
  return {
    ...commandPayload,
    header: {
      ...header,
      ...langfuseContext.header,
    },
    body: {
      ...body,
      extra_payload: {
        ...extraPayload,
        ...langfuseContext.extraPayload,
      },
    },
  };
}

function isRecord(value: unknown): value is Dict {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function createCallAgentContext(): { redis: Redis; registry: WorkerRegistry } {
  const config = readRedisConfig();
  const redis = createRedis({
    host: config.host,
    port: config.port,
    db: config.db,
    username: config.username,
    password: config.password,
  });
  return { redis, registry: new WorkerRegistry(redis) };
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}
