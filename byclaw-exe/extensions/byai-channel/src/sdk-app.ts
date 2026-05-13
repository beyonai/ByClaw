import {
  createRedis,
  WorkerRegistry,
  WorkerRunner,
  GatewayDataEmitter,
  EventType,
  type AskAgentCommand, WorkerHeartbeat,
  ResumeCommand,
  CancelTaskCommand,
  ActionType,
} from "@byclaw/by-framework";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { ResolvedByaiAccount, ByaiSdkInboundMessage } from "./types.js";
import { getByaiRuntime } from "./runtime.js";
import path from "node:path";
import fs from "node:fs/promises";
import {
  resolveActiveSdkRequestByTraceId,
  clearActiveSdkRequestByTarget,
  emitSdkChunkTracked,
  registerSdkEmitter,
  shouldDeferActiveSdkFinal,
  clearActiveSdkRequestRecord,
} from "./session-context.js";
import { deliverReplyToAgentViaSdk } from "./sdk-message-processor.js";
import { resolveInboundLanguage } from "./i18n.js";

export interface ByaiSdkAppOptions {
  account: ResolvedByaiAccount;
  cfg: OpenClawConfig;
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
    debug?: (msg: string) => void;
  };
}

function getRedisInfo() {
  const {
    REDIS_USERNAME,
    REDIS_PASSWORD,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_DATABASE,
  } = process.env;
  if (!REDIS_HOST || !REDIS_PORT) {
    return null;
  }
  return {
    username: REDIS_USERNAME,
    password: REDIS_PASSWORD,
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT, 10),
    db: parseInt(REDIS_DATABASE || '0', 10),
  };
}

function getUserCode(): string | null {
  const code = String(process.env.USER_CODE ?? "").trim();
  return code || null;
}

export class ByaiSdkApp {
  private readonly account: ResolvedByaiAccount;
  private readonly cfg: OpenClawConfig;
  private readonly log?: ByaiSdkAppOptions["log"];

  private runner: WorkerRunner | null = null;
  private stopSubscription: (() => void) | null = null;
  private redis: import("ioredis").Redis | null = null;
  private workerHeartbeat: WorkerHeartbeat | null = null;

  constructor(opts: ByaiSdkAppOptions) {
    this.account = opts.account;
    this.cfg = opts.cfg;
    this.log = opts.log;
  }

  private logger() {
    return this.log ?? {};
  }

  async start(): Promise<void> {
    if (this.runner) {
      return;
    }

    const { info, error, debug } = this.logger();

    const redisInfo = getRedisInfo();
    if (!redisInfo) {
      throw new Error(`[${this.account.accountId}] byai-channel failed to get Redis information`);
    }

    debug?.(`[${this.account.accountId}] byai-channel redisInfo: ${JSON.stringify(redisInfo)}`);

    const redis = createRedis(redisInfo);
    this.redis = redis;

    const userCode = getUserCode();
    if (!userCode) {
      throw new Error(`[${this.account.accountId}] byai-channel failed to get usercode`);
    }

    debug?.(`[${this.account.accountId}] byai-channel usercode: ${userCode}`);

    const workerId = `byai-channel-worker-${userCode}-${Math.random().toString(16).slice(2, 6)}`;
    const agentTypes = [`BYCLAW_EXE_${userCode}`];

    const registry = new WorkerRegistry(redis);

    // 为 Runner 提供独立的 Redis 连接，避免轮询时的 BLOCK 指令阻塞其他操作（如 emitChunk）
    // 关键：轮询必须拥有自己的独占连接
    const runner = new WorkerRunner({ workerId, agentTypes, registry }, {
        redisClient: createRedis(redisInfo)
    });
    const emitter = new GatewayDataEmitter(redis, {
      sourceAgentType: agentTypes[0],
    });

    // 1. 初始化消费组等环境（内部会执行 claimWorkerId 获取独占锁）
    await runner.initialize();

    // 2. 启动心跳维持组件 (Standalone Heartbeat)
    // 必须传入同一个 registry 实例，以便复用 runner 刚刚获取的 lock token
    const heartbeat = new WorkerHeartbeat(workerId, agentTypes, redis, registry);
    this.workerHeartbeat = heartbeat;
    await heartbeat.start();

    info?.(
      `[${this.account.accountId}] byai-channel worker registration: workerId=${workerId}, targetAgentTypes=${agentTypes}`,
    );

    registerSdkEmitter(this.account.accountId, emitter);

    const subscription = runner.subscribe(async ({ streamName, msgId, data }) => {
      if (data.actionType === ActionType.RESUME) {
        // 这里处理resume任务，目的是将原session从sessions_yield的状态中唤醒
        return;
      }
      if (data.actionType !== ActionType.ASK_AGENT) {
        // 下面只处理ASK_AGENT的消息
        return;
      }
      const gatewayMsg = data as AskAgentCommand;
      info?.(`收到新问题: ${gatewayMsg.content}`);
      const {
        sessionId,
        messageId,
        traceId,
        metadata,
      } = gatewayMsg.header;
      if (!gatewayMsg.content || !sessionId || !messageId) {
        await runner.ack(streamName, msgId);
        return;
      }

      await registry.saveExecution({
        // use traceId as execution_id. Then we can use it to cancel the task.
        execution_id: traceId || `exec-${messageId}`,
        message_id: messageId,
        session_id: sessionId,
        worker_id: workerId,
        status: 'RUNNING',
        created_at: Date.now(),
        updated_at: Date.now()
      });

      const metadataLanguage =
        typeof metadata?.language === "string" ? metadata.language : undefined;
      const { language, languageProvided } = resolveInboundLanguage(metadataLanguage);
      const inbound: ByaiSdkInboundMessage = {
        messageId,
        sessionId: sessionId,
        userId: userCode,
        text: gatewayMsg.content as string,
        timestamp: Date.now(),
        traceId: traceId || "",
        accountId: this.account.accountId,
        extraPayload: gatewayMsg.extraPayload,
        language,
        languageProvided,
        channelExtension: metadata?.channelExtension as
          | Record<string, unknown>
          | string
          | undefined,
        beyondToken: metadata?.["Beyond-Token"] ?? metadata?.request_headers?.["Beyond-Token"] ?? "",
      };

      // 写 sessionId 到文件，供 executor.py 读取并注入 X-Session-Id header
      try {
        const runtime = getByaiRuntime();
        const stateDir = runtime.state.resolveStateDir();
        const sessionStorePath = path.join(stateDir, "identity", "byai_session_id.txt");
        await fs.writeFile(sessionStorePath, sessionId, "utf8");
        debug?.(`[${this.account.accountId}] wrote session id to ${sessionStorePath}: ${sessionId}`);
      } catch (err) {
        debug?.(`[${this.account.accountId}] failed to write session id file: ${String(err)}`);
      }

      let hasDeltaChunk = false;
      const sdkTarget = `user:${sessionId}`;
      const abortController = new AbortController();
      try {
        await deliverReplyToAgentViaSdk({
          message: inbound,
          account: this.account,
          cfg: this.cfg,
          abortController,
          log: this.log,
          onReply: async (text, type, options) => {
            if (!text) {
              return;
            }
            if (type === "final") {
              if (!hasDeltaChunk) {
                hasDeltaChunk = true;
                // 做一个防御，如果收到final之前没有任何的onPartialReply，则认为是没有流式输出，则直接发送final
                await emitSdkChunkTracked({
                  emitter,
                  sessionId,
                  traceId,
                  text,
                  options: options || {},
                });
              }
              if (shouldDeferActiveSdkFinal(this.account.accountId, sdkTarget)) {
                info?.(
                  `[${this.account.accountId}] byai-channel SDK final deferred: target=${sdkTarget}`,
                );
                await emitSdkChunkTracked({
                  emitter,
                  sessionId,
                  traceId,
                  text: "\n\n",
                  options: {},
                });
                return;
              }
              info?.(`[${this.account.accountId}] byai-channel SDK emitState, eventType: ${EventType.APP_STREAM_RESPONSE}`);
              await emitter.emitState(
                sessionId,
                traceId || "",
                "",
                {
                  eventType: EventType.APP_STREAM_RESPONSE,
                },
              );
              clearActiveSdkRequestByTarget(this.account.accountId, sdkTarget);
            } else {
              hasDeltaChunk = true;
              info?.(`[${this.account.accountId}] byai-channel SDK emitChunk: ${text}`);
              await emitSdkChunkTracked({
                emitter,
                sessionId,
                traceId,
                text,
                options: options || {},
              });
            }
          },
        });

        await runner.ack(streamName, msgId);
      } catch (err) {
        error?.(
          `[${this.account.accountId}] byai-channel SDK handler failed for message ${messageId}: ${String(
            err,
          )}`,
        );
        clearActiveSdkRequestByTarget(this.account.accountId, sdkTarget);
        try {
          await emitter.emitState(
            sessionId,
            traceId || "",
            "",
            {
              eventType: 'error',
              metadata: { error: String(err) },
            },
          );
        } catch {
          // ignore
        }
        await runner.ack(streamName, msgId).catch(() => undefined);
      }
    });

    const subscriptionCancelTask = runner.subscribeCancel(async (cmd) => {
      // targetExecutionId is traceId
      const { reason, targetExecutionId: traceId } = cmd;
      info?.(`[${this.account.accountId}] cancel task, traceId: ${traceId}, reason: ${reason}`);
      const activeRequest = resolveActiveSdkRequestByTraceId(traceId);
      if (!activeRequest?.abortController) {
        info?.(
          `[${this.account.accountId}] cancel skipped: no active request for traceId ${traceId}`,
        );
        return;
      }
      if (activeRequest.abortController.signal.aborted) {
        clearActiveSdkRequestRecord(activeRequest);
        return;
      }
      activeRequest.abortController.abort(new Error(`[${this.account.accountId}] task canceled, reason: ${reason}`));
      clearActiveSdkRequestRecord(activeRequest);
    });

    this.runner = runner;
    this.stopSubscription = () => {
      subscription.stop();
      subscriptionCancelTask.stop();
      debug?.(`[${this.account.accountId}] byai-channel SDK subscription stopped`);
    };

    info?.(`[${this.account.accountId}] byai-channel SDK app started`);
  }

  async stop(): Promise<void> {
    const { info, error } = this.logger();

    try {
      this.stopSubscription?.();
    } catch (err) {
      error?.(
        `[${this.account.accountId}] byai-channel failed to stop SDK subscription: ${String(err)}`,
      );
    }

    try {
      await this.runner?.release();
    } catch (err) {
      error?.(
        `[${this.account.accountId}] byai-channel failed to release SDK runner: ${String(err)}`,
      );
    }

    try {
      await this.redis?.quit();
    } catch (err) {
      error?.(
        `[${this.account.accountId}] byai-channel failed to close Redis connection: ${String(err)}`,
      );
    }

    try {
      await this.workerHeartbeat?.stop();
    } catch (err) {
      error?.(
        `[${this.account.accountId}] byai-channel failed to stop worker heartbeat: ${String(err)}`,
      );
    }

    this.runner = null;
    this.stopSubscription = null;
    this.redis = null;

    info?.(`[${this.account.accountId}] byai-channel SDK app stopped`);
  }
}
