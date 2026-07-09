import { resolveChannelSessionIdForTool } from "../../shared/src/channel-session-resolve.js";
import {
  resolveLangfuseParentObservationIdWithRetry,
  resolveLangfuseTraceId,
  setActiveLangfuseSessionId,
} from "../../shared/src/langfuse-observation.js";
import { scheduleLangfuseSessionBackfill } from "../../shared/src/langfuse-session-backfill.js";
import {
  createLangfuseToolObservation,
  deriveLangfuseToolObservationId,
  updateLangfuseToolObservation,
} from "../../shared/src/langfuse-tool-observation.js";
import { appendBaiyingRemoteTaskStartedEvent } from "../../shared/src/remote-task-log.js";
import { executeViaCallAgent } from "../../shared/src/call-agent.js";
import { getDelegatedTaskToolDetails } from "../../shared/src/delegated-tool-details.js";
import type { BaiyingEnhanceLogger } from "../../shared/src/debug-channel.js";
import { logBaiyingRequest } from "../../shared/src/debug-channel.js";
import type { Capability, Dict, ExecutorResponse } from "../../shared/src/executor-types.js";
import { CALL_ACP_AGENT, DEFAULTS } from "./constants.js";
import { buildCallAgentContentFromPlan, createByclawAcpPlan } from "./planner.js";
import type { ByclawRegistry } from "./registry.js";
import type { ByclawAcpPlanRequest, ResolvedByclawAcpAdapterConfig } from "./types.js";

const callAcpAgentParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["agent", "team", "workflow", "loop"],
      default: "agent",
      description:
        "Plan target kind. Use agent for the current digital employee and any agent-mounted skill workflow. Use team/workflow/loop only when the user explicitly asks for a ByClaw agent team, workflow, or loop.",
    },
    id: {
      type: "string",
      description:
        "ByClaw agent/team/workflow/loop id. For the current digital employee, pass its resourceId/digital employee id so mounted linkedSkills can be propagated to the remote ACP agent.",
    },
    input: {
      description: "User task to delegate to the remote ACP agent.",
    },
    cwd: {
      type: "string",
      description: `Optional working directory override for the remote agent plan.`,
    },
    acpAgentId: {
      type: "string",
      description: `Optional ACP harness agent id. Defaults to ${DEFAULTS.acpAgentId}.`,
    },
    acpClientType: {
      type: "string",
      description: "Optional downstream ACP client type used to select shared-directory instructions.",
    },
    language: {
      type: "string",
      description: "Current byai-channel reply language metadata, for example zh_CN or en_US.",
    },
    replyLanguage: {
      type: "string",
      description:
        "Optional explicit downstream ACP client reply language. Defaults to language, then the adapter default.",
    },
    languageProvided: {
      type: "boolean",
      description: "Whether byai-channel received an explicit language from LANG or inbound metadata.",
    },
  },
} as const;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveRequesterSessionKey(ctx: unknown): string {
  const c = isPlainRecord(ctx) ? ctx : {};
  return (
    normalizeText(c.sessionKey) ||
    normalizeText(c.SessionKey) ||
    normalizeText(c.session_id) ||
    CALL_ACP_AGENT.defaultRequesterSessionKey
  );
}

function withDelegatedAgentYieldDetails(result: ExecutorResponse): ExecutorResponse {
  if (!(isPlainRecord(result) && result.backend === "call_agent_sdk" && result.status === "running")) {
    return result;
  }
  return {
    ...result,
    details: getDelegatedTaskToolDetails(),
  };
}

async function trackDelegatedTask(params: {
  result: ExecutorResponse;
  content: string;
  toolCallId: string;
  requesterSessionKey: string;
  parentSessionKey?: string;
  agentId: string;
  byclawId: string;
  logger?: BaiyingEnhanceLogger;
  accountId?: string;
  language?: string;
  beyondToken?: string;
}): Promise<void> {
  const result = params.result;
  if (!(isPlainRecord(result) && result.backend === "call_agent_sdk" && result.status === "running")) {
    return;
  }
  const ack = isPlainRecord(result.data) ? result.data : {};
  const taskId = normalizeText(ack.message_id);
  const sessionId = normalizeText(ack.session_id);
  if (!taskId || !sessionId) {
    return;
  }
  const target = isPlainRecord(result.target) ? result.target : {};
  const traceId = normalizeText(ack.trace_id);
  const createdAt = Date.now();
  const record = {
    taskId,
    messageId: taskId,
    requesterSessionKey: params.requesterSessionKey,
    parentSessionKey: params.parentSessionKey,
    traceId,
    sessionId,
    streamName: String(ack.stream_name || `byai_gateway:session:${sessionId}:data_stream`),
    toolCallId: params.toolCallId,
    targetWorkerId: normalizeText(ack.target_worker_id) || normalizeText(target.target_worker_id),
    targetAgentType: normalizeText(ack.target_agent_type) || normalizeText(target.target_agent_type),
    tenantId: normalizeText(ack.tenant_id),
    resourceId: params.byclawId,
    agentId: params.agentId,
    query: params.content,
    createdAt,
    updatedAt: createdAt,
    status: "pending",
    accountId: params.accountId,
    language: params.language,
    beyondToken: params.beyondToken,
  };
  await appendBaiyingRemoteTaskStartedEvent(record).catch((err) => {
    logBaiyingRequest(params.logger, "byclaw_call_acp_agent.track_failed", {
      task: record,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

export type CreateByclawCallAcpAgentToolParams = {
  config: ResolvedByclawAcpAdapterConfig;
  registry: ByclawRegistry;
  logger?: BaiyingEnhanceLogger;
  executeViaCallAgent?: typeof executeViaCallAgent;
};

/**
 * Third adapter tool: delegate a ByClaw digital-employee/team/workflow/loop task
 * to a remote ACP agent via `executeViaCallAgent` (async), instead of the local
 * `sessions_spawn` path used by `byclawAcpPlan`/`byclawAcpRun`.
 *
 * The tool is registered as a `(ctx) => tool` factory so it can read byai-channel
 * session context from the shared in-process store. It runs the planner to
 * materialize the shared-context bundle (agent roster, linkedSkills, model
 * config, query/metadata files) and hands the plan's task text to the remote
 * agent as the delegation prompt.
 */
export function createByclawCallAcpAgentTool(params: CreateByclawCallAcpAgentToolParams) {
  const executor = params.executeViaCallAgent ?? executeViaCallAgent;
  const { config, registry, logger } = params;
  return (ctx: unknown) => ({
    name: config.toolNames.callAcpAgent,
    label: "ByClaw Call ACP Agent",
    description:
      "Delegate a ByClaw digital-employee/team/workflow/loop task to a remote ACP Claude Code agent (async). For a current digital employee or agent-mounted skill workflow, call this with kind=agent and that digital employee id; use workflow/team only for explicit team orchestration.",
    parameters: callAcpAgentParameters,
    async execute(
      toolCallId: string,
      toolParams: ByclawAcpPlanRequest,
      signal?: AbortSignal,
    ) {
      const userCode = normalizeText(process.env.USER_CODE);
      if (!userCode) {
        return {
          success: false,
          error_code: "USER_CODE_REQUIRED",
          error: "USER_CODE is required to resolve the target ACP agent",
        };
      }
      const requesterSessionKey = resolveRequesterSessionKey(ctx);
      const channelResolve = resolveChannelSessionIdForTool(ctx, requesterSessionKey);
      await setActiveLangfuseSessionId(channelResolve.sessionId);
      const contextRecord = isPlainRecord(ctx) ? ctx : {};
      const langfuseObservationContext = {
        ...contextRecord,
        toolCallId,
        runId: normalizeText(contextRecord.runId),
        sessionKey: requesterSessionKey,
        requesterSessionKey,
        traceId: channelResolve.traceId,
        trace_id: channelResolve.traceId,
        channelTraceId: channelResolve.traceId,
        channel_trace_id: channelResolve.traceId,
      };
      const langfuseTraceId = await resolveLangfuseTraceId(langfuseObservationContext);
      const resolvedLangfuseParentObservationId = await resolveLangfuseParentObservationIdWithRetry(
        langfuseObservationContext,
        {
          attempts: CALL_ACP_AGENT.langfuseParentObservationAttempts,
          delayMs: CALL_ACP_AGENT.langfuseParentObservationDelayMs,
        },
      );
      const syntheticLangfuseToolObservationId = resolvedLangfuseParentObservationId
        ? ""
        : deriveLangfuseToolObservationId({
            traceId: langfuseTraceId,
            toolCallId,
            sessionKey: requesterSessionKey,
          });
      const langfuseParentObservationId =
        resolvedLangfuseParentObservationId || syntheticLangfuseToolObservationId || undefined;
      if (langfuseParentObservationId) {
        (langfuseObservationContext as Record<string, unknown>).langfuseParentObservationId =
          langfuseParentObservationId;
        (langfuseObservationContext as Record<string, unknown>).langfuse_parent_observation_id =
          langfuseParentObservationId;
      }
      if (!channelResolve.sessionId) {
        return {
          success: false,
          error_code: "CHANNEL_SESSION_ID_REQUIRED",
          error:
            `${config.toolNames.callAcpAgent} requires channel sessionId during runtime; cannot execute without channel session context`,
          target: {
            requester_session_key: requesterSessionKey,
          },
        };
      }
      scheduleLangfuseSessionBackfill({
        parentObservationId: langfuseParentObservationId,
        observationContext: langfuseObservationContext,
        traceId: langfuseTraceId,
        sessionId: channelResolve.sessionId,
        userId: userCode,
        logger,
      });
      const langfuseToolObservationStartedAt = new Date();
      const langfuseToolObservationCreated = syntheticLangfuseToolObservationId
        ? await createLangfuseToolObservation({
            observationId: syntheticLangfuseToolObservationId,
            traceId: langfuseTraceId,
            sessionId: channelResolve.sessionId,
            userId: userCode,
            input: toolParams,
            metadata: {
              toolCallId,
              requesterSessionKey,
              channelSessionId: channelResolve.sessionId,
              channelTraceId: channelResolve.traceId,
              syntheticParentForCallAgent: true,
            },
            startTime: langfuseToolObservationStartedAt,
            logger,
          })
        : false;

      // Run the planner to materialize the shared-context bundle (agent roster,
      // linkedSkills, model config, query.md / metadata.md / plan-bundle.json)
      // and derive the delegation prompt. The bundle is written to the shared
      // filesystem; only the plan.task text travels in the call-agent content.
      const plan = createByclawAcpPlan({
        config,
        snapshot: await registry.snapshot(),
        request: {
          ...toolParams,
          sessionId: channelResolve.sessionId,
          language: toolParams.language ?? channelResolve.language,
          replyLanguage: toolParams.replyLanguage,
        },
      });
      const content = buildCallAgentContentFromPlan(plan);

      const agentId = normalizeText(contextRecord.agentId) || CALL_ACP_AGENT.defaultAgentId;
      const result = await executor({
        capability: {} as Capability,
        payload: {
          cwd: plan.cwd,
          modelConfig: plan.sessionsSpawn?.modelConfig,
        },
        target: {} as Dict,
        content,
        sessionId: channelResolve.sessionId,
        traceId: channelResolve.traceId ?? "",
        langfuseTraceId,
        langfuseParentObservationId,
        userCode,
        targetAgentType: CALL_ACP_AGENT.targetAgentTypePrefix + userCode,
        parentMessageId: CALL_ACP_AGENT.asyncParentMessageId,
        toolCallId,
        callMode: "async",
        responseType: CALL_ACP_AGENT.responseType,
        signal,
        logger,
      });
      if (langfuseToolObservationCreated) {
        await updateLangfuseToolObservation({
          observationId: syntheticLangfuseToolObservationId,
          output: result,
          logger,
        });
      }
      await trackDelegatedTask({
        result,
        content,
        toolCallId,
        requesterSessionKey,
        parentSessionKey: channelResolve.parentSessionKey,
        agentId,
        byclawId: plan.id,
        logger,
        accountId: channelResolve.accountId,
        language: channelResolve.language,
        beyondToken: channelResolve.beyondToken,
      });
      return withDelegatedAgentYieldDetails(result);
    },
  });
}
