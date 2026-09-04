import fs from "node:fs/promises";
import path from "node:path";
import {
  WorkerRunner,
  GatewayDataEmitter,
  GatewayWorker,
  AskAgentCommand,
  ResumeCommand,
  AgentState,
  AgentTaskResult,
  EventType,
  TaskCancelledError,
  QueueNames,
  RegistryKeys,
  type AgentContext,
  type GatewayCommand,
  type ProcessCommandResult,
} from "@byclaw/by-framework";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveInboundLanguage } from "./i18n.js";
import { getByaiRuntime, getRuntimeConfig } from "./runtime.js";
import { deliverReplyToAgentViaSdk } from "./sdk-message-processor.js";
import {
  resolveActiveSdkRequestByTraceId,
  registerSdkEmitter,
  clearActiveSdkRequestRecord,
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
import { normalizeByaiAgentId } from "../../shared/src/session-key.js";
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
import { connectorAuthorizationFromMetadata } from "./connector-authorization.js";

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

function frameworkLaneLabel(message: ByaiSdkInboundMessage, index: number): string {
  const lane = message.laneMetadata;
  return (
    lane?.agentName?.trim() ||
    lane?.laneId?.trim() ||
    lane?.agentCode?.trim() ||
    lane?.agentId?.trim() ||
    `Lane ${index + 1}`
  );
}

function mergeFrameworkFinalAnswers(
  messages: ByaiSdkInboundMessage[],
  answers: string[],
): string {
  if (messages.length <= 1) {
    return answers[0] ?? "";
  }
  return answers
    .map((answer, index) => ({ answer, index }))
    .filter(({ answer }) => answer.trim().length > 0)
    .map(
      ({ answer, index }) =>
        `【${frameworkLaneLabel(messages[index]!, index)}】\n${answer}`,
    )
    .join("\n\n");
}

/** 将扩展上下文按标签包裹后追加到问题文本末尾。 */
function appendExtraPromptContexts(questionText: string, promptContextList: unknown[]): string {
  const contextText = promptContextList
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const context = item as { tag?: unknown; text?: unknown };
      if (typeof context.tag !== "string" || typeof context.text !== "string") {
        return "";
      }
      return `<${context.tag}>${context.text}</${context.tag}>`;
    })
    .filter(Boolean)
    .join("\n");
  return contextText ? `${questionText}\n${contextText}` : questionText;
}

async function getInboundMessageFromByFramework(data: AskAgentCommand | ResumeCommand) {
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
  } else if (data.content != null) {
    questionText = String(data.content);
  }
  if (!questionText && data instanceof ResumeCommand && data.replyData != null) {
    questionText =
      typeof data.replyData === "string" ? data.replyData : JSON.stringify(data.replyData);
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
  if (Array.isArray(extParams.promptContextList)) {
    questionText = appendExtraPromptContexts(questionText, extParams.promptContextList);
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
    const baiyingCallHandledResourceTypes = [
      "AGENT",
      "TOOLKIT",
      "TOOL",
      "MCP",
      "OBJECT",
      "VIEW",
      "KG_DOC",
      "KG_DB",
      "KG_QA",
      "KG_DOC_FILE",
      "KG_DOC_FOLDER",
    ];
    const userCode = getUserCode();
    const runtime = getByaiRuntime();
    resourceList.forEach((item) => {
      if (["DIG_EMPLOYEE", "COMMON_FILE", "COMMON_FOLDER"].includes(item.resourceType)) {
        // 以上3种类型，均已在原始提示词中处理了，无需再放到 remind context 中
        return;
      }
      if (item.resourceType?.toLowerCase() === "skill") {
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
            const workspaceDir = runtime.agent.resolveAgentWorkspaceDir(
              getRuntimeConfig(),
              normalizeAgentId,
            );
            if (workspaceDir) {
              remindTextArr.push(
                `- skill: ${path.join(workspaceDir, "skills", item.resourceCode)}`,
              );
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
          } catch (e) {}
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
      if (
        resourceList.some((item) => baiyingCallHandledResourceTypes.includes(item.resourceType))
      ) {
        if (data.extraPayload?.agent_id || data.extraPayload?.agent_code) {
          handleResourceTips = "For the resources, you can use `baiying_call` tool to handle them.";
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
  const projectInfo = data.header.metadata?.project_info;
  if (projectInfo) {
    questionText = `${questionText}\n<project_context>${JSON.stringify(projectInfo)}</project_context>`;
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
  registry: GatewayWorker["registry"];
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
        await setRunnerAgentTypeStreamsToLatest({
          redis,
          agentTypes,
          runnerGroupName,
          log,
        });
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

export class ByaiChannelGatewayWorker extends GatewayWorker {
  private readonly account: ResolvedByaiAccount;
  private readonly agentTypes: string[];
  private readonly emitter: GatewayDataEmitter;
  private readonly log?: ByaiSdkLogger;
  private readonly userCode: string;

  constructor(params: {
    workerId: string;
    agentTypes: string[];
    redis: RedisClient;
    emitter: GatewayDataEmitter;
    account: ResolvedByaiAccount;
    userCode: string;
    log?: ByaiSdkLogger;
  }) {
    super(params.workerId, undefined, params.redis as never);
    this.account = params.account;
    this.agentTypes = params.agentTypes;
    this.emitter = params.emitter;
    this.userCode = params.userCode;
    this.log = params.log;
  }

  getAgentTypes(): ReadonlyArray<string> {
    return this.agentTypes;
  }

  private cancelActiveRequest(traceId: string, reason: string): void {
    const activeRequest = resolveActiveSdkRequestByTraceId(traceId);
    if (!activeRequest?.abortController) {
      this.log?.info?.(
        `[${this.account.accountId}] cancel skipped: no active request for traceId ${traceId}`,
      );
      return;
    }
    if (!activeRequest.abortController.signal.aborted) {
      activeRequest.abortController.abort(
        new Error(`[${this.account.accountId}] task canceled, reason: ${reason}`),
      );
    }
    // Keep the per-session lease until the OpenClaw embedded attempt drains.
    // Releasing here lets a replacement write the transcript while the aborted
    // attempt is still unwinding its prompt lock and cleanup fence.
    clearActiveSdkRequestRecord(activeRequest);
  }

  async onCancelTask(command: unknown): Promise<void> {
    const cancelCommand = command as {
      reason?: string;
      targetExecutionId?: string;
    };
    const traceId = cancelCommand.targetExecutionId?.trim() || "";
    const reason = cancelCommand.reason || "task cancelled";
    this.log?.info?.(
      `[${this.account.accountId}] cancel task, traceId: ${traceId}, reason: ${reason}`,
    );
    if (traceId) {
      this.cancelActiveRequest(traceId, reason);
    }
  }

  async processCommand(
    command: GatewayCommand,
    context: AgentContext,
  ): Promise<ProcessCommandResult> {
    if (!(command instanceof AskAgentCommand) && !(command instanceof ResumeCommand)) {
      context.setStreamFinished(true);
      return AgentState.COMPLETED;
    }

    const gatewayMsg = command;
    const { sessionId, messageId, traceId, metadata } = gatewayMsg.header;
    const parentMessageId = gatewayMsg.header.parentMessageId?.trim() || "-1";
    const isCallAgentRequest =
      gatewayMsg instanceof AskAgentCommand && Boolean(gatewayMsg.header.sourceAgentType?.trim());
    if (!sessionId || !messageId) {
      context.setStreamFinished(true);
      return AgentState.COMPLETED;
    }

    const traceParentSpanId =
      gatewayMsg.header.traceParentSpanId || metadataString(metadata, "trace_parent_span_id");
    const langfuseParentObservationId =
      gatewayMsg.header.langfuseParentObservationId ||
      metadataString(metadata, "langfuse_parent_observation_id");
    const { text, files } = await getInboundMessageFromByFramework(gatewayMsg);
    if (!text && !files?.length) {
      context.setStreamFinished(true);
      return AgentState.COMPLETED;
    }
    this.log?.info?.(`处理问题: ${text}`);

    const metadataLanguage = typeof metadata?.language === "string" ? metadata.language : undefined;
    const { language, languageProvided } = resolveInboundLanguage(metadataLanguage);
    const batchMetadata = parseByaiMultiAgentBatchMetadata(gatewayMsg.extraPayload);
    const laneMetadata = batchMetadata ? undefined : parseByaiLaneMetadata(gatewayMsg.extraPayload);
    const inbound: ByaiSdkInboundMessage = {
      files,
      text,
      messageId,
      parentMessageId,
      ...(isCallAgentRequest ? { delegatedAgentCall: true } : {}),
      sessionId,
      userId: this.userCode,
      timestamp: Date.now(),
      traceId: traceId || "",
      traceParentSpanId,
      langfuseParentObservationId,
      accountId: this.account.accountId,
      extraPayload: gatewayMsg.extraPayload,
      language,
      languageProvided,
      channelExtension: metadata?.channelExtension as Record<string, unknown> | string | undefined,
      authConnectorList: connectorAuthorizationFromMetadata(metadata),
      beyondToken: metadata?.["Beyond-Token"] ?? metadata?.request_headers?.["Beyond-Token"] ?? "",
      laneMetadata,
    };
    const inboundMessages = buildByaiMultiAgentLaneMessages(inbound, batchMetadata);
    if (batchMetadata && inboundMessages.length > 1) {
      this.log?.info?.(
        `[${
          this.account.accountId
        }] byai-channel fan-out multi-agent turn: sessionId=${sessionId}, lanes=${inboundMessages
          .map((item) => item.laneMetadata?.laneId ?? item.laneMetadata?.agentName ?? item.traceId)
          .join(",")}`,
      );
      inboundMessages.forEach((message, index) => {
        this.log?.info?.(
          `[${
            this.account.accountId
          }] byai-channel multi-agent lane assignment: sessionId=${sessionId}, assignment=${JSON.stringify(
            buildLaneAssignmentLogItem(message, index),
          )}`,
        );
      });
    }

    try {
      const runtime = getByaiRuntime();
      const stateDir = runtime.state.resolveStateDir();
      const sessionStorePath = path.join(stateDir, "identity", "byai_session_id.txt");
      await fs.writeFile(sessionStorePath, sessionId, "utf8");
      this.log?.debug?.(
        `[${this.account.accountId}] wrote session id to ${sessionStorePath}: ${sessionId}`,
      );
    } catch (err) {
      this.log?.debug?.(
        `[${this.account.accountId}] failed to write session id file: ${String(err)}`,
      );
    }

    const frameworkSignal = context.getCancellationSignal();
    let emittedLaneError = false;
    const emitSdkError = async (currentInbound: ByaiSdkInboundMessage, err: unknown) => {
      emittedLaneError = true;
      const errorOptions = withSdkEmitMetadata(
        {
          eventType: "error",
          metadata: { error: String(err) },
        },
        {
          laneMetadata: currentInbound.laneMetadata,
          traceId: currentInbound.traceId,
          parentMessageId: currentInbound.parentMessageId,
        },
      );
      await this.emitter.emitState(
        currentInbound.sessionId,
        currentInbound.traceId || "",
        buildSdkStateEvent("", errorOptions),
        errorOptions,
      );
    };

    const handleInbound = async (currentInbound: ByaiSdkInboundMessage) => {
      const abortController = new AbortController();
      let businessResult: Awaited<ReturnType<typeof deliverReplyToAgentViaSdk>> | undefined;
      const abortFromFramework = () => {
        if (!abortController.signal.aborted) {
          abortController.abort(frameworkSignal?.reason || "task cancelled");
        }
      };
      if (frameworkSignal?.aborted) {
        abortFromFramework();
      } else {
        frameworkSignal?.addEventListener("abort", abortFromFramework, {
          once: true,
        });
      }
      try {
        businessResult = await deliverReplyToAgentViaSdk({
          message: currentInbound,
          account: this.account,
          cfg: getRuntimeConfig(),
          abortController,
          log: this.log,
          onReply: async (replyText, options) => {
            if (!replyText) {
              return;
            }
            const emitOptions = withSdkEmitMetadata(options, {
              laneMetadata: currentInbound.laneMetadata,
              traceId: currentInbound.traceId,
              parentMessageId: currentInbound.parentMessageId,
            });
            await this.emitter.emitChunk(
              currentInbound.sessionId,
              currentInbound.traceId,
              buildSdkChunkEvent(replyText, emitOptions),
              emitOptions,
            );
          },
        });
        if (abortController.signal.aborted) {
          await businessResult.finalize();
          throw new TaskCancelledError(String(abortController.signal.reason || "task cancelled"));
        }
        return businessResult;
      } catch (err) {
        if (abortController.signal.aborted) {
          this.cancelActiveRequest(
            currentInbound.traceId,
            String(abortController.signal.reason || err),
          );
          await businessResult?.finalize().catch(() => undefined);
          throw new TaskCancelledError(String(abortController.signal.reason || "task cancelled"));
        }
        await emitSdkError(currentInbound, err);
        throw err;
      } finally {
        frameworkSignal?.removeEventListener("abort", abortFromFramework);
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
        await Promise.allSettled(
          results
            .filter(
              (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof handleInbound>>> =>
                result.status === "fulfilled",
            )
            .map((result) => result.value.finalize()),
        );
        throw rejected.reason;
      }
      const businessResults = results.map((result) => {
        if (result.status !== "fulfilled") {
          throw result.reason;
        }
        return result.value;
      });
      if (frameworkSignal?.aborted) {
        await Promise.allSettled(businessResults.map((result) => result.finalize()));
        throw new TaskCancelledError(String(frameworkSignal.reason || "task cancelled"));
      }
      const finalAnswer = mergeFrameworkFinalAnswers(
        inboundMessages,
        businessResults.map((result) => result.finalAnswer),
      );
      try {
        if (finalAnswer) {
          // FINAL_ANSWER must precede every lane APP_STREAM_RESPONSE; byclaw-super
          // treats the latter as the terminal cursor and stops reading afterwards.
          await context.emitChunk(finalAnswer, EventType.FINAL_ANSWER);
          context.setFinalAnswerEmitted(true);
        }
      } finally {
        await Promise.all(businessResults.map((result) => result.finalize()));
      }
      // Lane completion emitted APP_STREAM_RESPONSE after the aggregate final snapshot.
      context.setStreamFinished(true);
      return new AgentTaskResult({
        status: AgentState.COMPLETED,
        content: finalAnswer,
        // Text remains the canonical answer. Duplicate it into replyData only
        // for callAgent callbacks whose consumers still read Resume.reply_data.
        replyData: isCallAgentRequest ? finalAnswer : null,
      });
    } catch (err) {
      if (err instanceof TaskCancelledError || frameworkSignal?.aborted) {
        this.cancelActiveRequest(traceId || "", String(frameworkSignal?.reason || err));
        throw err instanceof TaskCancelledError
          ? err
          : new TaskCancelledError(String(frameworkSignal?.reason || err));
      }
      this.log?.error?.(
        `[${
          this.account.accountId
        }] byai-channel SDK handler failed for message ${messageId}: ${String(err)}`,
      );
      if (!emittedLaneError) {
        await emitSdkError(inbound, err).catch(() => undefined);
      }
      throw err;
    }
  }
}

export class ByaiSdkApp {
  private readonly account: ResolvedByaiAccount;
  private readonly log?: ByaiSdkAppOptions["log"];

  private runner: WorkerRunner | null = null;
  private runnerTask: Promise<void> | null = null;
  private redis: RedisClient | null = null;

  constructor(opts: ByaiSdkAppOptions) {
    this.account = opts.account;
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

    // Use injected worker_id if available; otherwise fall back to deterministic id for backward compatibility
    const workerId = process.env.BYAI_WORKER_ID || `byai-channel-worker-${userCode}`;
    const agentTypes = [`BYCLAW_EXE_${userCode}`];

    // 为 Runner 提供独立的 Redis 连接，避免轮询时的 BLOCK 指令阻塞其他操作（如 emitChunk）
    // 关键：轮询必须拥有自己的独占连接
    const consumerGroupSuffix = process.env.BYAI_CHANNEL_CONSUMER_GROUP_SUFFIX?.trim();
    const runnerGroupName = consumerGroupSuffix
      ? `agent_engines:${agentTypes.join(",")}:${consumerGroupSuffix}`
      : undefined;
    const emitter = new GatewayDataEmitter(redis, {
      sourceAgentType: agentTypes[0],
    });
    const worker = new ByaiChannelGatewayWorker({
      workerId,
      agentTypes,
      redis,
      emitter,
      account: this.account,
      userCode,
      log: this.log,
    });
    const runner = new WorkerRunner(worker, {
      // WorkerRunner 会为阻塞式 task/control poll 创建独立 duplicate 连接。
      redisClient: redis as never,
      ...(runnerGroupName ? { groupName: runnerGroupName } : {}),
    });
    installNoGroupRecovery({
      runner,
      registry: worker.registry,
      redis,
      workerId,
      agentTypes,
      runnerGroupName,
      log: this.log,
    });

    // Runner 初始化统一负责 worker registry、消费组、控制流和 heartbeat。
    await runner.initialize();
    await setRunnerAgentTypeStreamsToLatest({
      redis,
      agentTypes,
      runnerGroupName,
      log: this.log,
    });
    // 初始化完成后立即暴露 runner，确保冷启动等待期间收到 stop 也能释放 heartbeat 与 worker lock。
    this.runner = runner;

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
        `[${this.account.accountId}] waiting for baiying-enhance cold-start readiness before consuming, waitMs=${waitMs}`,
      );
      const readiness = await waitForBaiyingEnhanceColdStartReady(waitMs);
      if (readiness.ready) {
        info?.(
          `[${
            this.account.accountId
          }] baiying-enhance cold-start readiness complete before consuming, waitedMs=${
            readiness.waitedMs
          }, reason=${readiness.reason ?? "ready"}`,
        );
      } else {
        error?.(
          `[${
            this.account.accountId
          }] baiying-enhance cold-start readiness not complete before consuming, waitedMs=${
            readiness.waitedMs
          }, reason=${readiness.reason ?? "timeout"}; continuing`,
        );
      }
    }

    if (this.runner !== runner) {
      return;
    }
    const runnerTask = runner.start({ initialize: false });
    this.runnerTask = runnerTask;
    void runnerTask.catch((err) => {
      error?.(
        `[${this.account.accountId}] byai-channel SDK runner stopped with error: ${String(err)}`,
      );
    });

    info?.(`[${this.account.accountId}] byai-channel SDK app started`);
  }

  async stop(): Promise<void> {
    const { info, error } = this.logger();
    const runner = this.runner;
    const runnerTask = this.runnerTask;

    try {
      runner?.stop({
        cancelActiveExecutions: true,
        reason: `[${this.account.accountId}] byai-channel SDK app stopped`,
      });
      if (runnerTask) {
        await runnerTask;
      } else if (runner) {
        await runner.release();
      }
    } catch (err) {
      error?.(`[${this.account.accountId}] byai-channel failed to stop SDK runner: ${String(err)}`);
    }

    try {
      await this.redis?.quit();
    } catch (err) {
      error?.(
        `[${this.account.accountId}] byai-channel failed to close Redis connection: ${String(err)}`,
      );
    }

    this.runner = null;
    this.runnerTask = null;
    this.redis = null;

    info?.(`[${this.account.accountId}] byai-channel SDK app stopped`);
  }
}
