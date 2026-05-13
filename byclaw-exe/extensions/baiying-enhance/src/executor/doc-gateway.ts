/**
 * End-to-end DOC handler implemented on top of `@byclaw/by-framework`. This is
 * the canonical default path for DOC queries — `BAIYING_DOC_BACKEND=sdk` is
 * the default and `resource-types/doc.ts` routes here for every DOC call
 * unless the caller explicitly opts into the raw ioredis fallback.
 *
 * Module layering (strictly enforced):
 *   `doc-gateway.ts` (this file, SDK default)
 *         │  imports only:
 *         │    - `@byclaw/by-framework`     (SDK primitives)
 *         │    - `doc-shared.ts`          (cross-backend helpers: types,
 *         │                                parameter parsing, polling,
 *         │                                diagnosis, RedisConfig)
 *         │  does NOT import from `doc-redis.ts` — the raw fallback must
 *         │  never be pulled in on the default path.
 *
 *   `doc-redis.ts`   (raw fallback)
 *         │  imports only from `doc-shared.ts` + ioredis. Its public surface
 *         │  is limited to `createRedisClient` + `sendDocAsyncMessage`.
 *
 *   `doc-shared.ts`  (neutral)
 *         │  imports no DOC-backend module; supplies the primitives both
 *         │  backends need.
 *
 * What this module contributes:
 * - ASK_AGENT dispatch uses `GatewayClient.sendMessage(...)` / `sendCommand(...)`
 *   with typed `AskAgentCommand` + `MessageHeader`.
 * - Session stream polling pins the stream name to
 *   `QueueNames.session_data_stream(sessionId)` so it tracks the SDK's key
 *   naming; reuses the SDK-built Redis connection.
 * - `executeDocViaSdk` is the single entry point for both `sync` and `async`
 *   call modes.
 */

import type { Redis } from "ioredis";
import {
  ActionType,
  AskAgentCommand,
  ByaiGatewayClient,
  type DataMessage,
  MessageHeader,
  QueueNames,
  createRedis,
} from "@byclaw/by-framework";
import type { Capability, Dict, ExecutorFailure, ExecutorResponse } from "./types.js";
import { makeError } from "./errors.js";
import {
  diagnoseTraceInSessionStreams,
  pollDocResult,
  readRedisConfig,
  type DocAsyncAck,
  type DocAsyncSendParams,
  type DocDeltaCallback,
  type DocPollResult,
  type RedisConfig,
} from "./doc-shared.js";

export type SdkGatewayContext = {
  redis: Redis;
  client: ByaiGatewayClient;
};

/**
 * Build an SDK-flavoured gateway client plus a fresh Redis connection.
 * The caller owns the connection and must `redis.quit()` when done (or call
 * `executeDocViaSdk`, which manages the lifetime internally).
 */
export function createSdkGatewayClient(
  config: RedisConfig = readRedisConfig(),
): SdkGatewayContext {
  const redis = createRedis({
    host: config.host,
    port: config.port,
    db: config.db,
    username: config.username,
    password: config.password,
  });
  const client = new ByaiGatewayClient([], undefined, redis);
  return { redis, client };
}

// ---------------------------------------------------------------------------
// ASK_AGENT dispatch via SDK
// ---------------------------------------------------------------------------

/**
 * Send an ASK_AGENT command via the @byclaw/by-framework.
 *
 * Route-mode mapping to SDK constructs:
 * - `agent_type` → `sendMessage({ targetAgentType })` → xadd on `QueueNames.ctrl_stream(agentType)`
 * - `worker`     → `sendMessage({ targetWorkerId })` → xadd on `QueueNames.worker_ctrl_stream(workerId)`
 * - `capability` → SDK has no first-class capability stream; we build the
 *   `AskAgentCommand` manually and dispatch on
 *   `byai_gateway:ctrl:capability:<workerId>` via `client.sendCommand(cmd, streamName)`.
 */
export async function sendDocAsyncMessageViaSdk(
  ctx: SdkGatewayContext,
  params: DocAsyncSendParams,
): Promise<{ ack: DocAsyncAck | null; error: ExecutorFailure | null }> {
  const { client } = ctx;

  // Match the raw path's `header.user_code` by carrying it in `metadata`;
  // SDK's MessageHeader does not expose user_code directly.
  const userCode = process.env.USER_CODE ?? "";
  const metadata: Record<string, unknown> = params.metadata || {};
  if (userCode) metadata.user_code = userCode;

  try {
    if (params.routeMode === "agent_type") {
      const res = await client.sendMessage({
        traceId: params.channelTraceId,
        targetAgentType: params.targetAgentType,
        sessionId: params.sessionId,
        content: params.content,
        actionType: ActionType.ASK_AGENT,
        extraPayload: { ...params.extraPayload, wait_for_reply: false },
        metadata,
        requireOnlineWorker: false,
        parentMessageId: params.parentMessageId,
      });
      if (!res.success) {
        return {
          ack: null,
          error: makeError(
            "DOC_ASYNC_SEND_FAILED",
            res.error || `SDK sendMessage failed: status=${res.status}`,
            { error_code: res.error_code, status: res.status },
          ),
        };
      }
      return {
        ack: toAck({
          params,
          messageId: res.message_id,
          traceId: res.trace_id,
          targetWorkerId: res.target_worker_id,
          streamName: QueueNames.ctrl_stream(params.targetAgentType),
        }),
        error: null,
      };
    }

    if (params.routeMode === "worker") {
      const res = await client.sendMessage({
        traceId: params.channelTraceId,
        targetAgentType: params.targetAgentType,
        sessionId: params.sessionId,
        content: params.content,
        targetWorkerId: params.targetWorkerId,
        actionType: ActionType.ASK_AGENT,
        extraPayload: { ...params.extraPayload, wait_for_reply: false },
        metadata,
        requireOnlineWorker: false,
        parentMessageId: params.parentMessageId,
      });
      if (!res.success) {
        return {
          ack: null,
          error: makeError(
            "DOC_ASYNC_SEND_FAILED",
            res.error || `SDK sendMessage failed: status=${res.status}`,
            { error_code: res.error_code, status: res.status },
          ),
        };
      }
      return {
        ack: toAck({
          params,
          messageId: res.message_id,
          traceId: res.trace_id,
          targetWorkerId: res.target_worker_id || params.targetWorkerId,
          streamName: QueueNames.worker_ctrl_stream(params.targetWorkerId),
        }),
        error: null,
      };
    }

    // capability mode — SDK has no first-class helper, build the command manually.
    const messageId = `msg-${randomHex(8)}`;
    const header = new MessageHeader(messageId, params.sessionId, params.channelTraceId || randomHex(32), {
      targetAgentType: params.targetAgentType,
      metadata,
      parentMessageId: params.parentMessageId,
    });
    const command = new AskAgentCommand(
      header,
      params.content,
      /* waitForReply */ false,
      params.extraPayload,
    );
    const streamName = `byai_gateway:ctrl:capability:${params.targetWorkerId}`;
    const res = await client.sendCommand(command, streamName);
    if (!res.success) {
      return {
        ack: null,
        error: makeError(
          "DOC_ASYNC_SEND_FAILED",
          res.error || `SDK sendCommand failed: status=${res.status}`,
          { error_code: res.error_code, status: res.status },
        ),
      };
    }
    return {
      ack: toAck({
        params,
        messageId: res.message_id,
        traceId: res.trace_id,
        targetWorkerId: res.target_worker_id || params.targetWorkerId,
        streamName,
      }),
      error: null,
    };
  } catch (err) {
    return {
      ack: null,
      error: makeError(
        "DOC_ASYNC_SEND_FAILED",
        err instanceof Error ? err.message : String(err),
      ),
    };
  }
}

function toAck(args: {
  params: DocAsyncSendParams;
  messageId: string;
  traceId: string;
  targetWorkerId: string;
  streamName: string;
}): DocAsyncAck {
  return {
    message_id: args.messageId,
    trace_id: args.traceId,
    session_id: args.params.sessionId,
    target_agent_type: args.params.targetAgentType,
    target_worker_id: args.targetWorkerId,
    tenant_id: args.params.tenantId,
    stream_name: args.streamName,
    route_mode: args.params.routeMode,
    // The SDK does not expose the xadd-returned stream entry id; leave empty.
    redis_msgid: "",
    accepted_at_ms: Date.now(),
  };
}

function randomHex(length: number): string {
  let out = "";
  while (out.length < length) {
    out += Math.random().toString(16).slice(2);
  }
  return out.slice(0, length);
}

// ---------------------------------------------------------------------------
// Session stream polling via SDK constants
// ---------------------------------------------------------------------------

/**
 * Poll the session data stream for a terminal event. Delegates to the
 * backend-neutral `pollDocResult` in `doc-shared.ts`, pinning the stream
 * name to `QueueNames.session_data_stream(sessionId)` — so if the SDK ever
 * changes its key naming this path follows automatically.
 *
 * Reuses the Redis connection that the SDK client already holds to avoid
 * opening a second pool.
 */
export async function pollDocResultViaSdk(
  ctx: SdkGatewayContext,
  params: {
    sessionId: string;
    traceId: string;
    messageId: string;
    timeoutSec: number;
    intervalSec: number;
    sinceMs: number;
    onDelta?: DocDeltaCallback;
    signal?: AbortSignal;
  },
): Promise<DocPollResult> {
  return pollDocResult({
    redis: ctx.redis,
    sessionId: params.sessionId,
    traceId: params.traceId,
    messageId: params.messageId,
    timeoutSec: params.timeoutSec,
    intervalSec: params.intervalSec,
    sinceMs: params.sinceMs,
    streamName: QueueNames.session_data_stream(params.sessionId),
    onDelta: params.onDelta,
    signal: params.signal,
  });
}

/**
 * Type-safe accessor for DataMessage envelopes that may appear on the session
 * stream. Exposed for consumers that want to parse individual rows using the
 * SDK's typed shape; not used in the core polling loop (which already
 * normalises via `extractDocDataMessage`).
 */
export type { DataMessage };

// ---------------------------------------------------------------------------
// Unified DOC entry point (sync + async) for the SDK backend
// ---------------------------------------------------------------------------

export type ExecuteDocViaSdkInput = {
  capability: Capability;
  datasetId: string;
  callMode: "sync" | "async";
  sendParams: DocAsyncSendParams;
  syncTimeoutSec: number;
  syncIntervalSec: number;
  /**
   * Streaming hook — only fired for `sync` call mode (async is fire-and-return
   * and finishes before any worker delta is observable). Ignored silently for
   * async.
   */
  onDelta?: DocDeltaCallback;
  signal?: AbortSignal;
};

/**
 * Full SDK-backed DOC execution. Opens one Redis connection, dispatches the
 * ASK_AGENT command through the SDK, and — in `sync` mode — polls the SDK's
 * canonical session data stream until a terminal event is received.
 *
 * Always tears the Redis connection down on return, including failure and
 * async (fire-and-return) paths.
 */
export async function executeDocViaSdk(
  input: ExecuteDocViaSdkInput,
): Promise<ExecutorResponse> {
  let ctx: SdkGatewayContext;
  try {
    ctx = createSdkGatewayClient();
  } catch (err) {
    return makeError(
      "DOC_SYNC_CONNECT_FAILED",
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    const sendRes = await sendDocAsyncMessageViaSdk(ctx, input.sendParams);
    if (sendRes.error) return sendRes.error;
    const ack = sendRes.ack!;

    // Async mode: fire and return immediately; task state is updated via
    // `/plugins/baiying-enhance/doc-async/complete` (or equivalent integration).
    if (input.callMode === "async") {
      return {
        success: true,
        type: "doc_async",
        status: "running",
        backend: "sdk",
        data: ack,
        target: buildTarget(input, input.sendParams),
      };
    }

    // Sync mode: poll the SDK's session data stream until a terminal event.
    // `onDelta` streams partial answer chunks up to the caller as they arrive.
    const poll = await pollDocResultViaSdk(ctx, {
      sessionId: input.sendParams.sessionId,
      traceId: ack.trace_id,
      messageId: ack.message_id,
      timeoutSec: input.syncTimeoutSec,
      intervalSec: input.syncIntervalSec,
      sinceMs: ack.accepted_at_ms,
      onDelta: input.onDelta,
      signal: input.signal,
    });

    if (!poll.success) {
      let diagnosis: unknown;
      if (poll.event_type === "timeout") {
        diagnosis = await diagnoseTraceInSessionStreams({
          redis: ctx.redis,
          traceId: ack.trace_id,
        }).catch(() => undefined);
      }
      return makeError("DOC_SYNC_FAILED", poll.text || "DOC sync call failed", {
        type: "doc_sync",
        status: "failed",
        backend: "sdk",
        data: { ack, poll: diagnosis !== undefined ? { ...poll, diagnosis } : poll },
        target: buildTarget(input, input.sendParams),
      });
    }

    return {
      success: true,
      status: "completed",
      backend: "sdk",
      data: { poll },
      type: "doc_sync",
      target: buildTarget(input, input.sendParams),
    };
  } finally {
    await ctx.redis.quit().catch(() => undefined);
  }
}

function buildTarget(
  input: ExecuteDocViaSdkInput,
  sendParams: DocAsyncSendParams,
): Dict {
  return {
    resource_id: input.capability.metadata?.resource_id,
    dataset_id: input.datasetId,
    target_agent_type: sendParams.targetAgentType,
    target_worker_id: sendParams.targetWorkerId,
    route_mode: sendParams.routeMode,
  };
}
