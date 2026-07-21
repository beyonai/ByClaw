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
import { executeViaCallAgent } from "../../shared/src/call-agent.js";
import { getDelegatedTaskToolDetails } from "../../shared/src/delegated-tool-details.js";
import type { BaiyingEnhanceLogger } from "../../shared/src/debug-channel.js";
import type {
  Capability,
  Dict,
  ExecutorResponse,
  ResourceContext,
} from "../../shared/src/executor-types.js";
import { CALL_ACP_AGENT, DEFAULTS } from "./constants.js";
import {
  MetadataBootstrapError,
  metadataBootstrapFailureResponse,
} from "./metadata-bootstrap.js";
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
 * config, query/metadata files) and hands a validated metadata-first bootstrap
 * envelope to the remote agent as the delegation prompt.
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

      // Materialize one immutable metadata-first bootstrap snapshot. The remote
      // content includes the complete validated metadata manual before query
      // access; structured files remain available in the shared filesystem.
      let plan: ReturnType<typeof createByclawAcpPlan>;
      let content: string;
      try {
        plan = createByclawAcpPlan({
          config,
          snapshot: await registry.snapshot(),
          request: {
            ...toolParams,
            sessionId: channelResolve.sessionId,
            language: toolParams.language ?? channelResolve.language,
            replyLanguage: toolParams.replyLanguage,
          },
        });
        content = buildCallAgentContentFromPlan(plan);
      } catch (error) {
        if (!(error instanceof MetadataBootstrapError)) {
          throw error;
        }
        const failure = metadataBootstrapFailureResponse({
          error,
          requesterSessionKey,
          sessionId: channelResolve.sessionId,
        });
        if (langfuseToolObservationCreated) {
          await updateLangfuseToolObservation({
            observationId: syntheticLangfuseToolObservationId,
            output: failure,
            logger,
          });
        }
        return failure;
      }

      const agentId = normalizeText(contextRecord.agentId) || CALL_ACP_AGENT.defaultAgentId;
      const resourceContext: ResourceContext = {
        root_agent: {
          resourceId: agentId,
        },
        selected_resource: {
          resourceId: plan.id,
        },
        session_key: requesterSessionKey,
        requester_session_key: requesterSessionKey,
        parent_session_key: channelResolve.parentSessionKey,
        channel_session_id: channelResolve.sessionId,
        channel_trace_id: channelResolve.traceId,
        langfuse_trace_id: langfuseTraceId,
        langfuse_parent_observation_id: langfuseParentObservationId,
        accountId: channelResolve.accountId,
        language: channelResolve.language,
        beyondToken: channelResolve.beyondToken,
      };
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
        resourceContext,
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
      return withDelegatedAgentYieldDetails(result);
    },
  });
}
