import { createHash } from "node:crypto";
import { ConnectorDispatchUncertainError, RunCancellationRequestedError } from "@byclaw/by-conductor";
import { AgentState, RegistryKeys, type WorkerRegistry, type createRedis } from "@byclaw/by-framework";
import {
  callAgent,
  createRedisCallAgentDeps,
} from "@byclaw/by-framework/dist/dispatch/dispatch_ask_agent.js";
import { buildAskAgentPublishArtifacts } from "@byclaw/by-framework/dist/dispatch/ask_agent_build.js";
import type { ByFrameworkCallAgentInput, ByFrameworkCallAgentResult } from "./index.js";

type RedisClient = ReturnType<typeof createRedis>;

type DispatchRoute = {
  execution: Record<string, unknown>;
  streamName: string;
  targetAgentType: string;
};

// Registry 与 ctrl stream 在 Redis Cluster 中不在同一 slot。先固定不可变路由和
// execution ID，再幂等初始化 registry，最后在 ctrl slot 原子写 receipt + XADD。
// 任一步骤宕机都可继续；registry 已有 RUNNING/终态时绝不覆盖。
const INITIALIZE_EXECUTION = `
local mapped = redis.call('HGET', KEYS[1], ARGV[1])
if mapped and mapped ~= ARGV[2] then
  return redis.error_reply('SUPER_DISPATCH_EXECUTION_CONFLICT')
end
redis.call('HSETNX', KEYS[1], ARGV[3], ARGV[4])
redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1
`;

const PUBLISH_ONCE = `
if redis.call('EXISTS', KEYS[3]) == 1 then return 'CANCELLED' end
local published = redis.call('GET', KEYS[2])
if published then return published end
local streamType = redis.call('TYPE', KEYS[1]).ok
if streamType ~= 'none' and streamType ~= 'stream' then
  return redis.error_reply('SUPER_DISPATCH_INVALID_STREAM_TYPE')
end
local id = redis.call('XADD', KEYS[1], '*', 'data', ARGV[1])
redis.call('SET', KEYS[2], id)
return id
`;

/**
 * SDK 的 init + XADD 没有 messageId 幂等性，在发布边界补原子去重。
 * route/receipt 只存无凭证标识且不自动过期：任意长暂停的旧实例恢复也不能重投。
 * 业务结果仍以 PostgreSQL Delegation 为准；Redis 仅负责传输发布记录。
 */
export function createIdempotentCallAgent(redis: RedisClient, registry: WorkerRegistry) {
  const dispatch = async (input: ByFrameworkCallAgentInput): Promise<ByFrameworkCallAgentResult> => {
    input.signal?.throwIfAborted();
    if (!input.messageId) {
      throw new Error("Idempotent dispatch requires a stable messageId");
    }
    if (input.routePolicy === "QUEUE_ONLY" || input.routePolicy === "WAKE_AND_QUEUE") {
      throw new Error("Idempotent dispatch requires direct delivery or WAKE_AND_WAIT");
    }
    const id = createHash("sha256").update(JSON.stringify([input.sessionId, input.messageId])).digest("hex");
    const routeKey = `byclaw-super:dispatch-route:${id}`;
    const cancelledKey = messageKey("cancel", input.messageId);
    const runId = typeof input.metadata?.parent_run_id === "string" ? input.metadata.parent_run_id : input.messageId;
    if (await redis.get(cancelledKey)) throw new RunCancellationRequestedError(runId);
    const publish = async (route: DispatchRoute): Promise<ByFrameworkCallAgentResult> => {
      input.signal?.throwIfAborted();
      if (await redis.get(cancelledKey)) throw new RunCancellationRequestedError(runId);
      const artifacts = buildAskAgentPublishArtifacts(
        { ...input, targetAgentType: route.targetAgentType },
        input.messageId!,
        input.parentMessageId || input.defaultParentMessageId,
        input.waitForReply ?? true,
      );
      await redis.eval(
        INITIALIZE_EXECUTION,
        1,
        RegistryKeys.session_registry(input.sessionId),
        `msg_map:${input.messageId}`,
        String(route.execution.execution_id),
        `exec:${String(route.execution.execution_id)}`,
        // 1.6.0 用 execution.metadata 恢复回调路由。它只进入有 TTL 的框架
        // registry，不能随不可过期的派发 route 保存凭证。
        JSON.stringify({ ...route.execution, metadata: { ...input.metadata } }),
        RegistryKeys.DEFAULT_SESSION_TTL,
      );
      input.signal?.throwIfAborted();
      const tag = redisHashTag(route.streamName);
      const published = await redis.eval(
        PUBLISH_ONCE,
        3,
        route.streamName,
        `byclaw-super:dispatch-receipt:{${tag}}:${id}`,
        `byclaw-super:dispatch-cancelled:{${tag}}:${id}`,
        JSON.stringify(artifacts.command.toDict()),
      );
      if (published === "CANCELLED") throw new RunCancellationRequestedError(runId);
      return {
        status: AgentState.QUEUED,
        messageId: input.messageId!,
        parentMessageId: input.parentMessageId || input.defaultParentMessageId,
        targetAgentType: route.targetAgentType,
      };
    };
    const savedRoute = await redis.get(routeKey);
    if (savedRoute) {
      return publish(parseRoute(savedRoute));
    }
    // Super 的等待期限和回调幂等由 PostgreSQL 管理。SDK 1.6 的 wait gate
    // 在业务落库前消费索引，会误丢宕机后的 pending 重投，因此不注册第二套索引。
    const { waitIndex: _waitIndex, ...deps } = createRedisCallAgentDeps({ redis, registry });
    let pending: Record<string, unknown> | undefined;
    let accepted: ByFrameworkCallAgentResult | undefined;
    const result = await callAgent({
      ...deps,
      execution: {
        async init(execution) {
          // 仅缓冲本次调用的序列化输入；持久化与发布由下面的恢复协议负责。
          pending = execution;
        },
      },
      bus: {
        async publish(streamName) {
          if (!pending) {
            throw new Error("by-framework did not initialize the dispatch execution");
          }
          // 对升级前只有 registry 而没有 receipt 的执行保守拒绝，不能猜测是否已发布。
          const existing = await redis.hget(RegistryKeys.session_registry(input.sessionId), `msg_map:${input.messageId}`);
          if (existing && existing !== `exec-super-${id}`) {
            throw new Error("SUPER_DISPATCH_LEGACY_EXECUTION: cannot safely redispatch an existing framework execution");
          }
          const now = Date.now();
          const route: DispatchRoute = {
            streamName,
            targetAgentType: String(pending.target_agent_type),
            execution: {
              // 只持久化恢复所需的标识，避免 SDK 新增字段把凭证写入永久记录。
              message_id: pending.message_id,
              parent_message_id: pending.parent_message_id,
              session_id: pending.session_id,
              trace_id: pending.trace_id,
              source_agent_type: pending.source_agent_type,
              task_group_id: pending.task_group_id ?? "",
              stream_name: streamName,
              worker_id: "",
              target_agent_type: pending.target_agent_type,
              status: AgentState.QUEUED,
              cancel_requested: false,
              cancel_reason: "",
              route_policy: pending.route_policy,
              route_status: pending.route_status,
              selected_agent_type: pending.selected_agent_type,
              execution_id: `exec-super-${id}`,
              created_at: now,
              updated_at: now,
              started_at: 0,
              finished_at: 0,
              timeline: [{ status: AgentState.QUEUED, timestamp: now }],
            },
          };
          input.signal?.throwIfAborted();
          await redis.set(messageKey("route", input.messageId!), routeKey, "NX");
          await redis.set(routeKey, JSON.stringify(route), "NX");
          const canonical = await redis.get(routeKey);
          if (!canonical) {
            throw new Error("SUPER_DISPATCH_ROUTE_MISSING");
          }
          accepted = await publish(parseRoute(canonical));
        },
      },
    }, input);
    return accepted ?? result;
  };
  return async (input: ByFrameworkCallAgentInput): Promise<ByFrameworkCallAgentResult> => {
    try {
      return await dispatch(input);
    } catch (error) {
      input.signal?.throwIfAborted();
      if (error instanceof RunCancellationRequestedError) throw error;
      // 协议冲突是确定性失败；Redis 断连可能发生在 XADD 已提交之后，必须保留
      // Delegation 并由下一次持有数据库租约的执行恢复，不能误写业务 FAILED。
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("SUPER_DISPATCH_") || message.startsWith("Idempotent dispatch requires")) {
        throw error;
      }
      const runId = typeof input.metadata?.parent_run_id === "string"
        ? input.metadata.parent_run_id
        : input.messageId ?? "unknown";
      throw new ConnectorDispatchUncertainError(runId, { cause: error });
    }
  };
}

function parseRoute(value: string): DispatchRoute {
  const route = JSON.parse(value) as Partial<DispatchRoute>;
  if (!route.execution || !route.streamName || !route.targetAgentType) {
    throw new Error("SUPER_DISPATCH_ROUTE_INVALID");
  }
  return route as DispatchRoute;
}

/** 与 Redis 自身的 hash-tag 选择规则保持一致，使 receipt 与原 ctrl stream 同 slot。 */
function redisHashTag(key: string): string {
  const open = key.indexOf("{");
  const close = open < 0 ? -1 : key.indexOf("}", open + 1);
  return open >= 0 && close > open + 1 ? key.slice(open + 1, close) : key;
}

/** 持久化取消意图，再定位待发布/已发布任务；不发送新的 AskAgent。 */
export async function requestPendingDispatchCancellation(
  redis: RedisClient,
  messageId: string,
): Promise<{ sessionId: string; targetAgentType: string } | undefined> {
  // 先记录全局意图，覆盖 cancel 先于路由预留的交错。
  await redis.set(messageKey("cancel", messageId), "1");
  const routeKey = await redis.get(messageKey("route", messageId));
  if (!routeKey) return undefined;
  const raw = await redis.get(routeKey);
  if (!raw) return undefined;
  const route = parseRoute(raw);
  const sessionId = String(route.execution.session_id);
  const id = createHash("sha256").update(JSON.stringify([sessionId, messageId])).digest("hex");
  // 与 XADD 同 slot，原子出版先后必有确定顺序。若 XADD 已发生，调用方继续取消registry。
  await redis.set(`byclaw-super:dispatch-cancelled:{${redisHashTag(route.streamName)}}:${id}`, "1");
  return { sessionId, targetAgentType: route.targetAgentType };
}

function messageKey(kind: string, messageId: string): string {
  return `byclaw-super:dispatch-message-${kind}:${createHash("sha256").update(messageId).digest("hex")}`;
}
