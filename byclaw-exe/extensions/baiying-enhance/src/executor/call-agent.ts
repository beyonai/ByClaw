import { QueueNames, WorkerRegistry, createRedis } from "@byclaw/by-framework";
import { callAgent, createRedisCallAgentDeps } from "@byclaw/by-framework";
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

    logBaiyingRequest(input.logger, "call_agent.dispatch", {
      resource_id: input.capability.metadata?.resource_id,
      resource_type: input.capability.resource_type,
      response_type: input.responseType,
      call_mode: input.callMode ?? "sync",
      target_agent_type: input.targetAgentType,
      source_agent_type: sourceAgentType,
      session_id: input.sessionId,
      trace_id: input.traceId,
      default_parent_message_id: defaultParentMessageId,
      wait_for_reply: false,
      probe_agent_type: input.probeAgentType ?? false,
      user_code: input.userCode ?? nonEmptyEnv("USER_CODE"),
      user_name: input.userName ?? nonEmptyEnv("USER_NAME"),
      task_group_id: input.taskGroupId ?? "",
      metadata: input.metadata ?? {},
      content: input.content,
      payload: input.payload,
      sync_timeout_sec: input.syncTimeoutSec,
      sync_interval_sec: input.syncIntervalSec,
      target: input.target,
    });

    const result = await callAgent(deps, {
      sessionId: input.sessionId,
      traceId: input.traceId,
      sourceAgentType,
      defaultParentMessageId,
      targetAgentType: input.targetAgentType,
      content: input.content,
      payload: input.payload,
      waitForReply: false,
      userCode: input.userCode ?? nonEmptyEnv("USER_CODE"),
      userName: input.userName ?? nonEmptyEnv("USER_NAME"),
      taskGroupId: input.taskGroupId,
      metadata: input.metadata,
      probeAgentType: input.probeAgentType ?? false,
    });

    const commandPayload = {
      action_type: "ASK_AGENT",
      header: {
        message_id: result.messageId,
        session_id: input.sessionId,
        trace_id: input.traceId,
        source_agent_id: sourceAgentType,
        target_agent_type: input.targetAgentType,
        parent_message_id: result.parentMessageId ?? defaultParentMessageId,
        task_group_id: input.taskGroupId ?? "",
        user_code: input.userCode ?? nonEmptyEnv("USER_CODE") ?? "",
        user_name: input.userName ?? nonEmptyEnv("USER_NAME") ?? "",
        metadata: input.metadata ?? {},
      },
      body: {
        content: input.content,
        wait_for_reply: false,
        extra_payload: input.payload,
      },
    };
    logBaiyingRequest(input.logger, "call_agent.command_payload", commandPayload);

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
      trace_id: input.traceId,
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
      traceId: input.traceId,
      messageId: result.messageId,
      timeoutSec: input.syncTimeoutSec,
      intervalSec: input.syncIntervalSec,
      sinceMs: startedAt,
      streamName: QueueNames.session_data_stream(input.sessionId),
      onDelta: input.onDelta,
      signal: input.signal,
    });

    if (!poll.success) {
      let diagnosis: unknown;
      if (poll.event_type === "timeout") {
        diagnosis = await diagnoseTraceInSessionStreams({
          redis: ctx.redis,
          traceId: input.traceId,
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
      data: { ack, poll },
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

function createCallAgentContext(): { redis: Redis; registry: WorkerRegistry } {
  const config = readRedisConfig();
  const redis = createRedis({
    host: config.host,
    port: config.port,
    db: config.db,
    username: config.username,
    password: config.password,
  }) as Redis;
  return {
    redis,
    registry: new WorkerRegistry(redis),
  };
}

function nonEmptyEnv(name: string): string | undefined {
  const value = (process.env[name] ?? "").trim();
  return value || undefined;
}
