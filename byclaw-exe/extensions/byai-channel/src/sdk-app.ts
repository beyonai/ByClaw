import fs from "node:fs/promises";
import path from "node:path";
import {
  WorkerRegistry,
  WorkerRunner,
  GatewayDataEmitter,
  type AskAgentCommand,
  WorkerHeartbeat,
  ActionType,
  QueueNames,
  RegistryKeys,
} from "@byclaw/by-framework";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveInboundLanguage } from "./i18n.js";
import { getByaiRuntime, getRuntimeConfig } from "./runtime.js";
import { deliverReplyToAgentViaSdk } from "./sdk-message-processor.js";
import {
  resolveActiveSdkRequestByTraceId,
  registerSdkEmitter,
  clearActiveSdkRequestRecord,
  resolveSdkLocalFilePath,
  buildSdkChunkEvent,
  buildSdkStateEvent,
  withSdkEmitMetadata,
} from "./session-context.js";
import type { ResolvedByaiAccount, ByaiSdkInboundMessage, SdkInboundFile } from "./types.js";
import { getRedisInfo, getUserCode } from "./utils.js";
import {
  isBaiyingEnhanceConfigured,
  waitForBaiyingEnhanceColdStartReady,
} from "./baiying-enhance-readiness.js";
import { normalizeByaiAgentId } from "./session-key.js";
import {
  buildByaiMultiAgentLaneMessages,
  parseByaiLaneMetadata,
  parseByaiMultiAgentBatchMetadata,
} from "./multi-agent.js";
import {
  applyByFrameworkRedisKeyPatch,
  createRedisClient,
  type RedisClient,
} from "../../shared/src/redis-compat.js";

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

type ByaiSdkLogger = NonNullable<ByaiSdkAppOptions["log"]>;

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string {
    const value = metadata?.[key];
    return typeof value === "string" ? value.trim() : "";
}

function buildLaneAssignmentLogItem(message: ByaiSdkInboundMessage, index: number) {
  const lane = message.laneMetadata;
  return {
    index,
    laneId: lane?.laneId ?? "",
    agentId: lane?.agentId ?? "",
    agentCode: lane?.agentCode ?? "",
    agentName: lane?.agentName ?? "",
    traceId: message.traceId,
    messageId: message.messageId,
    query: message.text,
  };
}

async function getInboundMessageFromByFramework(data: AskAgentCommand) {
  let questionText = "";
  let files: SdkInboundFile[] | undefined;
  if (typeof data.content === "string") {
    questionText = data.content;
  } else if (Array.isArray(data.content)) {
    const questionTextArr: string[] = [];
    data.content.forEach((item) => {
      if (typeof item.content === "string") {
        questionTextArr.push(item.content);
      } else if (item.content && typeof item.content === "object") {
        questionTextArr.push(item.content.text || "");
        if (item.content.files) {
          files = [...(files || []), ...item.content.files];
        }
      }
    });
    questionText = questionTextArr.join("\n");
  } else {
    questionText = String(data.content);
  }

  const extParams: Record<string, any> = data.extraPayload?.ext_params || {};
  const resumeFromSubAgent = extParams.resumeFromSubAgent as {
    agentName?: string;
    agentId?: string;
  };
  if (resumeFromSubAgent) {
    questionText = [
      `Message from subagent: ${resumeFromSubAgent.agentName} | feedback: ${questionText}`,
      "- If the task is done, NOT spawn this subagent again.",
      "- If the task failed, collect enough information from user, then spawn this subagent again.",
    ].join("\n");
  }
  if (Array.isArray(data.extraPayload?.resource_list)) {
    const remindTextArr: string[] = [];
    const resourceList: {
      resourceId: string;
      resourceType: string;
      resourceName: string;
      resourceCode: string;
      extData?: string;
    }[] = data.extraPayload?.resource_list || [];
    const { sessionId } = data.header;
    const baiyingCallHandledResourceTypes = ["AGENT", "TOOLKIT", "TOOL", "MCP", "OBJECT", "VIEW", "KG_DOC", "KG_DB", "KG_QA", "KG_DOC_FILE", "KG_DOC_FOLDER"];
    const userCode = getUserCode();
    const runtime = getByaiRuntime();
    resourceList.forEach((item) => {
      if (item.resourceType === "DIG_EMPLOYEE") {
        return;
      }
      if (item.resourceType === "COMMON_FILE") {
        remindTextArr.push(`- file: ${resolveSdkLocalFilePath(item.resourceId, sessionId)}`);
      } else if (item.resourceType === "COMMON_FOLDER") {
        remindTextArr.push(`- folder: ${resolveSdkLocalFilePath(item.resourceId, sessionId)}`);
      } else if (item.resourceType?.toLowerCase() === "skill") {
        if (!item.extData) return;
        let skillExt: {
          skillUrl: string;
          version: string;
          skillType: "inner" | "hub";
        };
        try {
          skillExt = JSON.parse(item.extData);
        } catch (error) {
          return;
        }
        if (skillExt.skillType === "inner") {
          remindTextArr.push(`- skill: ${path.join("/app/skills", item.resourceCode)}`);
        } else if (skillExt.skillType === "hub") {
          if (userCode && skillExt.skillUrl?.includes(userCode)) {
            const normalizeAgentId = normalizeByaiAgentId(data.extraPayload?.agent_id || "main");
            const workspaceDir = runtime.agent.resolveAgentWorkspaceDir(getRuntimeConfig(), normalizeAgentId)
            if (workspaceDir) {
              remindTextArr.push(`- skill: ${path.join(workspaceDir, "skills", item.resourceCode)}`);
            }
          } else {
            const skillsRoot = path.join(runtime.state.resolveStateDir(), "skills");
            remindTextArr.push(`- skill: ${path.join(skillsRoot, item.resourceCode)}`);
          }
        }
      } else {
        let { resourceType } = item;
        let resourceId: string | undefined;
        if (["KG_DOC_FILE", "KG_DOC_FOLDER"].includes(resourceType)) {
          // 知识库文件和文件夹都归类为知识库
          resourceType = "KG_DOC";
          try {
            const { datasetId } = JSON.parse(item.resourceCode);
            // 知识库id
            resourceId = datasetId;
          } catch (e) {
          }
          if (!resourceId) {
            console.warn(`Knowledge base resource id is empty: ${item.resourceName}`);
            return;
          }
        }
        if (item.resourceType === "KG_DOC_FILE") {
          remindTextArr.push(
            `- resource: resource_id=${resourceId}, resource_type=${resourceType}, itemName=${item.resourceName}, itemPath=${item.resourceId}`,
          );
        } else if (item.resourceType === "KG_DOC_FOLDER") {
          remindTextArr.push(
            `- resource: resource_id=${resourceId}, resource_type=${resourceType}, folderName=${item.resourceName}, folderPath=${item.resourceId}`,
          );
        } else {
          remindTextArr.push(
            `- resource: resource_id=${resourceId}, resource_type=${resourceType}, resource_name=${item.resourceName}`,
          );
        }
      }
    });
    if (remindTextArr.length) {
      let handleResourceTips = "";
      if (resourceList.some((item) => baiyingCallHandledResourceTypes.includes(item.resourceType))) {
        if (data.extraPayload?.agent_id || data.extraPayload?.agent_code) {
          handleResourceTips =
            "For the resources, you can use \`baiying_call\` tool to handle them.";
        } else {
          handleResourceTips = "For the resources, you can find a subagent to handle them.";
        }
      }
      const remindPrefix = [
        "<!-- remind_context:start -->",
        `The user mentions:\n${remindTextArr.join("\n")}`,
        handleResourceTips,
        "<!-- remind_context:end -->",
      ]
        .filter(Boolean)
        .join("\n");
      questionText = `${remindPrefix}\n${questionText}`;
    }
  }
  return {
    files,
    text: questionText,
  };
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function isRedisNoGroupError(err: unknown): boolean {
  const message = getErrorMessage(err);
  return message.includes("NOGROUP");
}

function installNoGroupRecovery(params: {
  runner: WorkerRunner;
  registry: WorkerRegistry;
  redis: RedisClient;
  workerId: string;
  agentTypes: string[];
  runnerGroupName?: string;
  log?: ByaiSdkLogger;
}): void {
  const { runner, registry, redis, workerId, agentTypes, runnerGroupName, log } = params;
  const originalPoll = runner.poll.bind(runner);
  const originalRunControlOnce = runner.runControlOnce.bind(runner);
  let recoveryPromise: Promise<void> | null = null;

  const recoverStreams = async (source: string): Promise<void> => {
    if (!recoveryPromise) {
      recoveryPromise = (async () => {
        log?.warn?.(
          `[${workerId}] byai-channel Redis stream consumer group missing during ${source}; recreating worker and agent_type control streams`,
        );
        await registry.registerWorkerMembership(workerId, agentTypes);
        await registry.heartbeatWorker(workerId);
        await runner.setupStreams();
        await setRunnerAgentTypeStreamsToLatest({ redis, agentTypes, runnerGroupName, log });
        await runner.setupControlStreams();
        log?.info?.(`[${workerId}] byai-channel Redis stream consumer groups recovered`);
      })().finally(() => {
        recoveryPromise = null;
      });
    }
    await recoveryPromise;
  };

  runner.poll = async (options) => {
    try {
      return await originalPoll(options);
    } catch (err) {
      if (!isRedisNoGroupError(err)) {
        throw err;
      }
      await recoverStreams("subscription poll");
      return originalPoll(options);
    }
  };

  runner.runControlOnce = async (block) => {
    try {
      return await originalRunControlOnce(block);
    } catch (err) {
      if (!isRedisNoGroupError(err)) {
        throw err;
      }
      await recoverStreams("control poll");
      return originalRunControlOnce(block);
    }
  };
}

async function setRunnerAgentTypeStreamsToLatest(params: {
  redis: RedisClient;
  agentTypes: string[];
  runnerGroupName?: string;
  log?: ByaiSdkLogger;
}): Promise<void> {
  const { redis, agentTypes, runnerGroupName, log } = params;
  if (!runnerGroupName) {
    return;
  }
  for (const agentType of agentTypes) {
    const streamName = QueueNames.ctrl_stream(agentType);
    try {
      await redis.xgroup("SETID", streamName, runnerGroupName, "$");
      log?.info?.(
        `byai-channel custom consumer group starts at latest: group=${runnerGroupName}, stream=${streamName}`,
      );
    } catch (err) {
      log?.warn?.(
        `failed to set byai-channel custom consumer group to latest: group=${runnerGroupName}, stream=${streamName}, err=${String(
          err,
        )}`,
      );
    }
  }
}

export class ByaiSdkApp {
  private readonly account: ResolvedByaiAccount;
  private readonly log?: ByaiSdkAppOptions["log"];
  private readonly cfg: OpenClawConfig;

  private runner: WorkerRunner | null = null;
  private stopSubscription: (() => void) | null = null;
  private redis: RedisClient | null = null;
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
    applyByFrameworkRedisKeyPatch({ QueueNames, RegistryKeys }, redisInfo);

    const redis = createRedisClient(redisInfo);
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
    const consumerGroupSuffix = process.env.BYAI_CHANNEL_CONSUMER_GROUP_SUFFIX?.trim();
    const runnerGroupName = consumerGroupSuffix
      ? `agent_engines:${agentTypes.join(",")}:${consumerGroupSuffix}`
      : undefined;
    const runner = new WorkerRunner(
      { workerId, agentTypes, registry },
      {
        redisClient: createRedisClient(redisInfo) as never,
        ...(runnerGroupName ? { groupName: runnerGroupName } : {}),
      },
    );
    installNoGroupRecovery({
      runner,
      registry,
      redis,
      workerId,
      agentTypes,
      runnerGroupName,
      log: this.log,
    });
    const emitter = new GatewayDataEmitter(redis, {
      sourceAgentType: agentTypes[0],
    });

    // 1. 初始化消费组等环境（内部会执行 claimWorkerId 获取独占锁）
    await runner.initialize();
    await setRunnerAgentTypeStreamsToLatest({ redis, agentTypes, runnerGroupName, log: this.log });

    // 2. 启动心跳维持组件 (Standalone Heartbeat)
    // 必须传入同一个 registry 实例，以便复用 runner 刚刚获取的 lock token
    const heartbeat = new WorkerHeartbeat(workerId, agentTypes, redis, registry);
    this.workerHeartbeat = heartbeat;
    await heartbeat.start();

    info?.(
      `[${this.account.accountId}] byai-channel worker registration: workerId=${workerId}, targetAgentTypes=${agentTypes}`,
    );

    registerSdkEmitter(this.account.accountId, emitter);

    if (isBaiyingEnhanceConfigured(getRuntimeConfig())) {
      const rawWaitMs = Number.parseInt(
        process.env.BAIYING_ENHANCE_COLD_START_WAIT_MS || "60000",
        10,
      );
      const waitMs = Number.isFinite(rawWaitMs) ? Math.max(0, rawWaitMs) : 60000;
      info?.(
        `[${this.account.accountId}] waiting for baiying-enhance cold-start readiness before subscribing, waitMs=${waitMs}`,
      );
      const readiness = await waitForBaiyingEnhanceColdStartReady(waitMs);
      if (readiness.ready) {
        info?.(
          `[${this.account.accountId}] baiying-enhance cold-start readiness complete before subscribing, waitedMs=${readiness.waitedMs}, reason=${readiness.reason ?? "ready"}`,
        );
      } else {
        error?.(
          `[${this.account.accountId}] baiying-enhance cold-start readiness not complete before subscribing, waitedMs=${readiness.waitedMs}, reason=${readiness.reason ?? "timeout"}; continuing`,
        );
      }
    }

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
      const { sessionId, messageId, traceId, metadata } = gatewayMsg.header;
      const traceParentSpanId =
        gatewayMsg.header.traceParentSpanId || metadataString(metadata, "trace_parent_span_id");
      const langfuseParentObservationId =
        gatewayMsg.header.langfuseParentObservationId ||
        metadataString(metadata, "langfuse_parent_observation_id");
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
        status: "RUNNING",
        created_at: Date.now(),
        updated_at: Date.now(),
      });
      const { text, files } = await getInboundMessageFromByFramework(gatewayMsg);
      info?.(`处理问题: ${text}`);

      const metadataLanguage =
        typeof metadata?.language === "string" ? metadata.language : undefined;
      const { language, languageProvided } = resolveInboundLanguage(metadataLanguage);
      const batchMetadata = parseByaiMultiAgentBatchMetadata(gatewayMsg.extraPayload);
      const laneMetadata = batchMetadata ? undefined : parseByaiLaneMetadata(gatewayMsg.extraPayload);
      const inbound: ByaiSdkInboundMessage = {
        files,
        text,
        messageId,
        sessionId: sessionId,
        userId: userCode,
        timestamp: Date.now(),
        traceId: traceId || "",
        traceParentSpanId,
        langfuseParentObservationId,
        accountId: this.account.accountId,
        extraPayload: gatewayMsg.extraPayload,
        language,
        languageProvided,
        channelExtension: metadata?.channelExtension as
          | Record<string, unknown>
          | string
          | undefined,
        beyondToken:
          metadata?.["Beyond-Token"] ?? metadata?.request_headers?.["Beyond-Token"] ?? "",
        laneMetadata,
      };
      const inboundMessages = buildByaiMultiAgentLaneMessages(inbound, batchMetadata);
      if (batchMetadata && inboundMessages.length > 1) {
        info?.(
          `[${this.account.accountId}] byai-channel fan-out multi-agent turn: sessionId=${sessionId}, lanes=${inboundMessages
            .map((item) => item.laneMetadata?.laneId ?? item.laneMetadata?.agentName ?? item.traceId)
            .join(",")}`,
        );
        inboundMessages.forEach((message, index) => {
          info?.(
            `[${this.account.accountId}] byai-channel multi-agent lane assignment: sessionId=${sessionId}, assignment=${JSON.stringify(
              buildLaneAssignmentLogItem(message, index),
            )}`,
          );
        });
      }

      // 写 sessionId 到文件，供 executor.py 读取并注入 X-Session-Id header
      try {
        const runtime = getByaiRuntime();
        const stateDir = runtime.state.resolveStateDir();
        const sessionStorePath = path.join(stateDir, "identity", "byai_session_id.txt");
        await fs.writeFile(sessionStorePath, sessionId, "utf8");
        debug?.(
          `[${this.account.accountId}] wrote session id to ${sessionStorePath}: ${sessionId}`,
        );
      } catch (err) {
        debug?.(`[${this.account.accountId}] failed to write session id file: ${String(err)}`);
      }

      let emittedLaneError = false;
      const emitSdkError = async (currentInbound: ByaiSdkInboundMessage, err: unknown) => {
        emittedLaneError = true;
        const currentLaneMetadata = currentInbound.laneMetadata;
        const errorOptions = withSdkEmitMetadata(
          {
            eventType: "error",
            metadata: { error: String(err) },
          },
          {
            laneMetadata: currentLaneMetadata,
            traceId: currentInbound.traceId,
          },
        );
        await emitter.emitState(
          currentInbound.sessionId,
          currentInbound.traceId || "",
          buildSdkStateEvent("", errorOptions),
          errorOptions,
        );
      };

      const handleInbound = async (currentInbound: ByaiSdkInboundMessage) => {
        const abortController = new AbortController();
        try {
          await deliverReplyToAgentViaSdk({
            message: currentInbound,
            account: this.account,
            cfg: getRuntimeConfig(),
            abortController,
            log: this.log,
            onReply: async (text, options) => {
              if (!text) {
                return;
              }
              const emitOptions = withSdkEmitMetadata(options, {
                laneMetadata: currentInbound.laneMetadata,
                traceId: currentInbound.traceId,
              });
              await emitter.emitChunk(
                currentInbound.sessionId,
                currentInbound.traceId,
                buildSdkChunkEvent(text, emitOptions),
                emitOptions,
              );
            },
          });
        } catch (err) {
          await emitSdkError(currentInbound, err);
          throw err;
        }
      };

      try {
        const results = await Promise.allSettled(
          inboundMessages.map((currentInbound) => handleInbound(currentInbound)),
        );
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (rejected) {
          throw rejected.reason;
        }

        await runner.ack(streamName, msgId);
      } catch (err) {
        error?.(
          `[${this.account.accountId}] byai-channel SDK handler failed for message ${messageId}: ${String(
            err,
          )}`,
        );
        try {
          if (!emittedLaneError) {
            await emitSdkError(inbound, err);
          }
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
      activeRequest.abortController.abort(
        new Error(`[${this.account.accountId}] task canceled, reason: ${reason}`),
      );
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
      await this.workerHeartbeat?.stop();
    } catch (err) {
      error?.(
        `[${this.account.accountId}] byai-channel failed to stop worker heartbeat: ${String(err)}`,
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

    this.runner = null;
    this.stopSubscription = null;
    this.redis = null;
    this.workerHeartbeat = null;

    info?.(`[${this.account.accountId}] byai-channel SDK app stopped`);
  }
}
