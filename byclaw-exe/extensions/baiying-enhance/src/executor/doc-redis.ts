/**
 * Raw ioredis DOC fallback (opt-in via `BAIYING_DOC_BACKEND=raw` /
 * `doc_backend=raw`). **Not** imported by the SDK default path in
 * `doc-gateway.ts` — that module exclusively uses `doc-shared.ts` for the
 * cross-backend primitives (types, parameter helpers, polling, diagnosis).
 *
 * Everything here is specific to the hand-rolled implementation:
 *   - `createRedisClient` — a plain `new Redis(...)` factory
 *   - `sendDocAsyncMessage` — hand-rolls the ASK_AGENT command JSON and
 *     `xadd`s it to `byai_gateway:ctrl:*` streams with no SDK dependency
 *
 * If you are adding a new cross-backend helper, put it in `doc-shared.ts`.
 */

import Redis from "ioredis";
import { randomBytes, randomUUID } from "node:crypto";
import type { ExecutorFailure } from "./types.js";
import { makeError } from "./errors.js";
import {
  readRedisConfig,
  type DocAsyncAck,
  type DocAsyncSendParams,
  type RedisConfig,
} from "./doc-shared.js";

function safeUuid(): string {
  try {
    return randomUUID().replace(/-/g, "");
  } catch {
    return randomBytes(16).toString("hex");
  }
}

export function createRedisClient(config: RedisConfig = readRedisConfig()): Redis {
  return new Redis({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    db: config.db,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
    retryStrategy: () => null,
  });
}

/**
 * Raw-backend dispatcher. Builds the ASK_AGENT command JSON by hand and
 * writes it directly to `byai_gateway:ctrl:*` via `xadd`.
 *
 * The SDK path uses `sendDocAsyncMessageViaSdk` in `doc-gateway.ts` instead;
 * the two are intentionally parallel, not layered on top of each other.
 */
export async function sendDocAsyncMessage(
  client: Redis,
  params: DocAsyncSendParams,
): Promise<{ ack: DocAsyncAck | null; error: ExecutorFailure | null }> {
  const messageId = `msg-${safeUuid().slice(0, 12)}`;
  const traceId = params.channelTraceId || safeUuid();
  const command = {
    action_type: "ASK_AGENT",
    header: {
      message_id: messageId,
      session_id: params.sessionId,
      trace_id: traceId,
      source_agent_id: "",
      target_agent_type: params.targetAgentType,
      parent_message_id: "",
      task_group_id: "",
      tenant_id: params.tenantId,
      user_code: process.env.USER_CODE ?? "",
      metadata: params.metadata,
    },
    body: {
      content: params.content,
      wait_for_reply: false,
      extra_payload: params.extraPayload,
    },
  };
  let streamName: string;
  if (params.routeMode === "agent_type") {
    streamName = `byai_gateway:ctrl:agent_type:${params.targetAgentType}`;
  } else if (params.routeMode === "worker") {
    streamName = `byai_gateway:ctrl:worker:${params.targetWorkerId}`;
  } else {
    streamName = `byai_gateway:ctrl:capability:${params.targetWorkerId}`;
  }
  try {
    const redisMsgId = await client.xadd(streamName, "*", "data", JSON.stringify(command));
    return {
      ack: {
        message_id: messageId,
        trace_id: traceId,
        session_id: params.sessionId,
        target_agent_type: params.targetAgentType,
        target_worker_id: params.targetWorkerId,
        tenant_id: params.tenantId,
        stream_name: streamName,
        route_mode: params.routeMode,
        redis_msgid: redisMsgId != null ? String(redisMsgId) : "",
        accepted_at_ms: Date.now(),
      },
      error: null,
    };
  } catch (err) {
    return {
      ack: null,
      error: makeError("DOC_ASYNC_SEND_FAILED", err instanceof Error ? err.message : String(err)),
    };
  }
}
