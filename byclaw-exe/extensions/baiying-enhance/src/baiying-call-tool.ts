import { Type } from "@sinclair/typebox";
import { isSubagentSessionKey } from "openclaw/plugin-sdk/routing";
import type { AgentRegistryState } from "./agent-state.js";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { buildExecutorResourceContext, compactText, runBaiyingExecutor } from "./resource-metadata.js";
import { docAsyncState, type DocAsyncTaskRecord } from "./doc-async-state.js";
import type { BaiyingAssociatedResource } from "./types.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";
import { resolveChannelSessionIdForTool } from "./channel-session-resolve.js";
import {
  baiyingEnhanceDebugEnabled,
  logBaiyingRequest,
  logChannelDebug,
  type BaiyingEnhanceLogger,
} from "./executor/debug-channel.js";
import type { ResourceContext } from "./executor/types.js";

function normalizeResourceType(resource: BaiyingAssociatedResource | undefined): string {
  return resource?.resourceBizType || resource?.resourceType || "UNKNOWN";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isDocResourceType(value: string): boolean {
  const t = normalizeText(value).toUpperCase();
  return t === "DOC" || t === "ATOM" || t === "KG_DOC" || t === "KG_DB" || t === "KG_QA";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function flattenText(value: unknown, bucket: string[], limit: number): void {
  if (bucket.length >= limit) {
    return;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text) {
      bucket.push(text);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      flattenText(item, bucket, limit);
      if (bucket.length >= limit) {
        break;
      }
    }
    return;
  }
  if (isPlainRecord(value)) {
    for (const key of Object.keys(value)) {
      flattenText(value[key], bucket, limit);
      if (bucket.length >= limit) {
        break;
      }
    }
  }
}

function composeDocAnswerDraft(params: {
  question: string;
  taskQuery: string;
  taskStatus: string;
  taskResult: unknown;
  taskError?: string;
}): {
  draft_answer: string;
  evidence_snippets: string[];
  uncertainty_flags: string[];
  response_policy: {
    must_include_boundary_notice: boolean;
    should_request_followup: boolean;
    boundary_notice_template?: string;
    followup_prompt_template?: string;
  };
} {
  if (params.taskStatus !== "completed") {
    const reason = params.taskStatus === "failed" ? params.taskError || "任务失败" : "任务尚未完成";
    return {
      draft_answer: `当前无法给出最终答案，原因：${reason}。建议等待任务完成后重新生成回答。`,
      evidence_snippets: [],
      uncertainty_flags: [reason],
      response_policy: {
        must_include_boundary_notice: true,
        should_request_followup: true,
        boundary_notice_template: "当前仅能确认任务状态，尚不能基于文档内容给出结论。",
        followup_prompt_template: "请稍后重试，或补充检索范围后我再继续整理答案。",
      },
    };
  }
  const snippets: string[] = [];
  flattenText(params.taskResult, snippets, 8);
  const evidence = snippets.slice(0, 3).map((text) => (text.length > 180 ? `${text.slice(0, 177)}...` : text));
  const uncertainty: string[] = [];
  if (evidence.length === 0) {
    uncertainty.push("异步结果中未提取到可引用的文档片段");
  }
  uncertainty.push("需结合用户问题进行最终措辞，不可直接照搬草稿");
  const mustIncludeBoundaryNotice = uncertainty.length > 0;
  const shouldRequestFollowup = uncertainty.some(
    (item) => item.includes("未提取") || item.includes("不足") || item.includes("失败"),
  );

  const draft =
    evidence.length > 0
      ? `基于已返回的文档片段，关于“${params.question || params.taskQuery}”可先给出结论：${evidence[0]}`
      : `关于“${params.question || params.taskQuery}”，当前文档结果不足以形成可靠结论，建议补充检索范围后再回答。`;

  return {
    draft_answer: draft,
    evidence_snippets: evidence,
    uncertainty_flags: uncertainty,
    response_policy: {
      must_include_boundary_notice: mustIncludeBoundaryNotice,
      should_request_followup: shouldRequestFollowup,
      boundary_notice_template: mustIncludeBoundaryNotice
        ? "以下结论仅基于当前检索到的文档片段，文档未覆盖部分我会明确标注。"
        : undefined,
      followup_prompt_template: shouldRequestFollowup
        ? "如果你愿意，我可以继续补充检索更精确的文档范围后再给出完整结论。"
        : undefined,
    },
  };
}

function formatResourceLine(params: {
  resourceName: string;
  resourceType: string;
  resourceId: string;
  resourceCode?: string;
  description?: string;
  datasetId?: string;
  sourceResourceId?: string;
  method?: string;
  url?: string;
  integrationType?: string;
  agentSseUrl?: string;
  agentHomeUrl?: string;
  serverUrl?: string;
  transferType?: string;
  unsupportedReason?: string;
  schemaSummary?: string;
  marker?: string;
}): string {
  const attrs = [`${params.resourceType}`, `id: ${params.resourceId}`, `name: ${params.resourceName}`];
  if (params.resourceCode) {
    attrs.push(`resource_code: ${params.resourceCode}`);
  }
  if (params.datasetId) {
    attrs.push(`dataset_id: ${params.datasetId}`);
  }
  if (params.sourceResourceId) {
    attrs.push(`source_id: ${params.sourceResourceId}`);
  }
  if (params.integrationType) {
    attrs.push(`integration_type: ${params.integrationType}`);
  }
  if (params.agentSseUrl) {
    attrs.push(`agent_sse_url: ${params.agentSseUrl}`);
  }
  if (params.agentHomeUrl) {
    attrs.push(`agent_home_url: ${params.agentHomeUrl}`);
  }
  if (params.serverUrl) {
    attrs.push(`server_url: ${params.serverUrl}`);
  }
  if (params.transferType) {
    attrs.push(`transfer_type: ${params.transferType}`);
  }
  if (params.method) {
    attrs.push(`method: ${params.method}`);
  }
  if (params.url) {
    attrs.push(`url: ${params.url}`);
  }
  if (params.schemaSummary) {
    attrs.push(`input: ${params.schemaSummary}`);
  }
  if (params.unsupportedReason) {
    attrs.push(`mode: INFO_ONLY`);
  }
  const marker = params.marker ? `${params.marker} ` : "";
  const desc = params.description ? ` - ${params.description}` : "";
  return `  - ${marker}${params.resourceName} (${attrs.join(", ")})${desc}`;
}

function formatRootAgentLine(agent: AdaptedManagedAgent): string {
  return formatResourceLine({
    resourceName: agent.listEntry.name ?? agent.agentId,
    resourceType: "AGENT",
    resourceId: agent.sourceKey,
    description: compactText(agent.systemPrompt, 120),
    integrationType: agent.integrationType,
    agentSseUrl: agent.agentSseUrl,
    agentHomeUrl: agent.agentHomeUrl,
  });
}

/**
 * Tool description uses only fields present on `agent.associatedResources` (from
 * the latest agent sync). Enriched snapshot details are not cached here; each
 * `baiying_call` execution loads capability from Redis via the executor.
 */
export function buildBaiyingCallDescription(params: { agent: AdaptedManagedAgent; isFromThirdPartyAgent?: boolean }): string {
  if (params.isFromThirdPartyAgent) {
    // 暂时这么定，后续需要考虑：更详细的描述、执行参数等
    return [
      "Capabilities:",
      params.agent.coreCompetencies?.map(capacity => {
        return `  - ${capacity.coreCompetency}.${capacity.description || ""}`
      }).join("\n"),
      `Pass agent_id = ${params.agent.sourceKey}, resource_id = ${params.agent.agentId} to \`baiying_call\``
    ].filter(Boolean).join("\n");
  }
  const resources = params.agent.associatedResources ?? [];
  const summaryNames = resources
    .slice(0, 3)
    .map((resource) => resource.resourceName)
    .filter(Boolean)
    .join(", ");
  const summarySuffix =
    resources.length > 0
      ? ` Available resources: ${resources.length}${summaryNames ? ` (${summaryNames})` : ""}.`
      : "";
  const descParts = [`Call Baiying backend capabilities for this agent.${summarySuffix}`];

  if (resources.length > 0) {
    descParts.push("Available resources:");
    for (const resource of resources) {
      const normalizedType = normalizeResourceType(resource);
      const raw =
        resource.raw && typeof resource.raw === "object"
          ? (resource.raw as Record<string, unknown>)
          : undefined;
      const pickStr = (k: string): string | undefined => {
        const v = raw?.[k];
        return typeof v === "string" && v.trim() ? v.trim() : undefined;
      };
      const domainUrl = pickStr("domainURL") ?? pickStr("domainUrl");
      const line = formatResourceLine({
        resourceName: resource.resourceName,
        resourceType: normalizedType,
        resourceId: resource.resourceId,
        description: compactText(resource.resourceDesc),
        resourceCode: resource.resourceCode,
        datasetId: resource.resourceSourcePkId,
        sourceResourceId: pickStr("sourceResourceId") ?? resource.resourceSourcePkId,
        method: pickStr("method"),
        url: domainUrl,
        integrationType: resource.implType,
        agentSseUrl: pickStr("agentSseUrl"),
        serverUrl: pickStr("mcpServerUrl"),
        transferType: pickStr("mcpTransferType"),
      });
      descParts.push(line);
    }
  } else if (params.agent.agentSseUrl) {
    descParts.push("Available resources:");
    descParts.push(formatRootAgentLine(params.agent));
  }

  descParts.push(
    "Use `resource_id` to choose a parent resource and `action` to choose a TOOLKIT/MCP child tool when needed; OBJECT/VIEW resources are dispatched through callAgent and usually do not need `action`.",
  );
  descParts.push(
    "For DOC resources (`KG_DOC`/`KG_DB`/`KG_QA`), `agent_id` is required by executor. This plugin auto-populates `agent_id` from agent.json `resourceId` (current agent sourceKey) and forwards it in the top-level payload.",
  );
  descParts.push(
    "Pass structured backend parameters in `arguments`; OBJECT and VIEW resources are dispatched to `BYCLAW_DATA` with the selected resource code in `call_object_ids` or `call_view_ids`.",
  );
  descParts.push(
    "For OBJECT/VIEW calls with large payloads, backend may return `file_url` in response data; `file_url` is a local file path. Treat this local path as the authoritative payload reference and read it to process the full business data before producing final conclusions.",
  );
  descParts.push(
    "When both inline summary fields and `file_url` exist, prefer the local-file content pointed to by `file_url` for detailed analysis, and clearly state any limitation if the local path cannot be accessed.",
  );
  descParts.push(
    "IMPORTANT: reading data from `file_url` is mandatory when provided, but file publication may be delayed after tool execution; you must retry at least 3 times with a 1-2 second interval before concluding the file is unavailable.",
  );

  return descParts.join("\n");
}

/**
 * Create a tool factory that provides `baiying_call` to managed agents with SSE URL or associated resources.
 */
export function createBaiyingCallToolFactory(params: {
  registry: AgentRegistryState;
  executorPath: string;
  embedApiKeysFromJson?: boolean;
  envApiKeyTemplate?: string;
  defaultProxyUrl?: string;
  defaultApiKey?: string;
  logger?: BaiyingEnhanceLogger;
}): any {
  function debugLog(message: string) {
    if (baiyingEnhanceDebugEnabled()) {
      const line = `[baiying_call debug] ${message}`;
      if (params.logger?.info) {
        params.logger.info(line);
      } else {
        console.warn(line);
      }
    }
  }

  function traceLog(stage: string, payload: Record<string, unknown>) {
    if (!baiyingEnhanceDebugEnabled()) return;
    const sid = normalizeText(payload.channel_session_id);
    const tid = normalizeText(payload.channel_trace_id);
    const message = `[baiying_call trace] ${stage} channel-session-id=${sid || "<empty>"} channel-trace-id=${tid || "<empty>"}`;
    if (params.logger?.info) {
      params.logger.info(message);
    } else {
      console.warn(message);
    }
  }

  return (ctx: any) => {
    const agentId = ctx.agentId;
    if (!agentId || !agentId.startsWith(MANAGED_AGENT_PREFIX)) {
      debugLog(`skip: invalid agentId=${String(agentId)}`);
      return null;
    }

    const agent = params.registry.get(agentId);
    debugLog(
      `resolve: agentId=${agentId} registryHit=${agent ? "yes" : "no"} redisOnly=yes registrySize=${params.registry.list().length}`,
    );
    if (!agent) {
      return null;
    }

    const isSubagent = isSubagentSessionKey(ctx.sessionKey);

    const hasResources = !!agent.associatedResources?.length;
    const hasSseUrl = !!agent.agentSseUrl;
    const hasHomeUrl = !!agent.agentHomeUrl;
    const { integrationType } = agent;

    // 第三方创建的数字员工，单独处理tool
    const isFromThirdPartyAgent =
      integrationType === "INTERFACE" || integrationType === "A2A" || integrationType === "PAGE";

    if (!hasResources && !hasSseUrl && !hasHomeUrl && !isFromThirdPartyAgent) {
      return null;
    }

    const tool: any = {
      name: "baiying_call",
      label: "Baiying Call",
      description: buildBaiyingCallDescription({ agent, isFromThirdPartyAgent }),
      parameters: Type.Object({
        query: Type.Optional(
          Type.String({
            description:
              "Natural-language request or a short summary for the backend call. Optional when `arguments.question` / `arguments.query` already carries the request.",
          }),
        ),
        agent_id: Type.Optional(
          Type.String({
            description:
              "Required by executor for DOC resources (KG_DOC/KG_DB/KG_QA/ATOM). If omitted, baiying-enhance will auto-fill it from current agent.json `resourceId`.",
          }),
        ),
        resource_id: Type.Optional(
          Type.String({ description: "Target parent resource ID from the available resources list" }),
        ),
        resource_type: Type.Optional(
          Type.String({
            description: "Resource type filter (for example KG_DOC, TOOLKIT, MCP, OBJECT, VIEW)",
          }),
        ),
        resource_name: Type.Optional(
          Type.String({
            description: "Target parent resource name from the available resources list",
          }),
        ),
        action: Type.Optional(
          Type.String({
            description:
              "Child action/tool name for TOOLKIT, MCP, OBJECT, or VIEW resources; optional for DOC/AGENT/TOOL. For DOC async, use `get_doc_async_result` then `compose_doc_async_answer`.",
          }),
        ),
        arguments: Type.Optional(
          Type.Object(
            {},
            {
              additionalProperties: true,
              description:
                "Structured backend arguments. Required for TOOLKIT / TOOL / MCP / OBJECT / VIEW child-tool execution.",
            },
          ),
        ),
      }),
      async execute(
        _toolCallId: string,
        toolParams: Record<string, unknown>,
        signal?: AbortSignal,
        onUpdate?: (partial: {
          content: Array<{ type: "text"; text: string }>;
          details?: Record<string, unknown>;
        }) => void,
      ) {
        const actionName = normalizeText(toolParams.action);
        const requesterSessionKey =
          normalizeText((ctx as any)?.sessionKey) ||
          normalizeText((ctx as any)?.SessionKey) ||
          normalizeText((ctx as any)?.session_id) ||
          "agent:main:main";
        const channelResolve = resolveChannelSessionIdForTool(ctx, requesterSessionKey);
        const structuredArguments = isPlainRecord(toolParams.arguments)
          ? toolParams.arguments
          : undefined;
        logBaiyingRequest(params.logger, "tool.execute.received", {
          agent_id: agent.agentId,
          tool_call_id: _toolCallId,
          requester_session_key: requesterSessionKey,
          channel_session_id: channelResolve.sessionId,
          channel_trace_id: channelResolve.traceId,
          channel_session_source: channelResolve.source,
          tool_params: toolParams,
        });
        traceLog("request.received", {
          agent_id: agent.agentId,
          tool_call_id: _toolCallId,
          action: actionName || undefined,
          resource_id: normalizeText(toolParams.resource_id) || undefined,
          resource_type: normalizeText(toolParams.resource_type) || undefined,
          query_preview: normalizeText(toolParams.query).slice(0, 120) || undefined,
          has_arguments: !!structuredArguments,
          argument_keys: structuredArguments ? Object.keys(structuredArguments).slice(0, 20) : [],
          requester_session_key: requesterSessionKey,
          channel_session_id: channelResolve.sessionId,
          channel_trace_id: channelResolve.traceId,
          channel_session_source: channelResolve.source,
        });
        if (
          actionName === "get_doc_async_result" ||
          actionName === "get_doc_async_readable" ||
          actionName === "compose_doc_async_answer"
        ) {
          const explicitTaskId =
            normalizeText(structuredArguments?.task_id) ||
            normalizeText(structuredArguments?.message_id);
          const sessionId = normalizeText(structuredArguments?.session_id);
          const queryLikeInput = normalizeText(toolParams.query);
          const queryLooksLikeTaskId =
            queryLikeInput.startsWith("msg-") || queryLikeInput.startsWith("doc-");
          const lookupWarning =
            queryLikeInput && !queryLooksLikeTaskId
              ? "query 是自然语言问题，不会作为任务ID用于异步结果定位；请在 arguments 中提供 message_id/session_id/task_id。"
              : undefined;

          const lookupTaskId = explicitTaskId || (queryLooksLikeTaskId ? queryLikeInput : "");
          let resolvedLookupBy = "none";
          let task = lookupTaskId ? docAsyncState.getByTaskId(lookupTaskId) : undefined;
          if (task) {
            resolvedLookupBy = "task_id";
          } else if (sessionId) {
            task = docAsyncState.getBySessionId(sessionId);
            if (task) {
              resolvedLookupBy = "session_id";
            }
          }
          if (!task) {
            const latest = docAsyncState.getLatestByAgentResource(agent.agentId, normalizeText(toolParams.resource_id));
            if (latest) {
              task = latest;
              resolvedLookupBy = "latest_by_agent_resource";
            }
          }
          if (!task) {
            traceLog("doc_async.lookup_miss", {
              agent_id: agent.agentId,
              action: actionName,
              lookup_task_id: lookupTaskId || undefined,
              session_id: sessionId || undefined,
              query_ignored_as_task_id: queryLikeInput && !queryLooksLikeTaskId ? queryLikeInput : undefined,
            });
            return {
              success: false,
              error_code: "DOC_ASYNC_TASK_NOT_FOUND",
              error: "DOC async task not found",
              target: {
                task_id: lookupTaskId || undefined,
                session_id: sessionId || undefined,
                query_ignored_as_task_id: queryLikeInput && !queryLooksLikeTaskId ? queryLikeInput : undefined,
              },
              warning: lookupWarning,
            };
          }
          if (actionName === "compose_doc_async_answer") {
            const question =
              normalizeText(structuredArguments?.user_question) ||
              normalizeText(structuredArguments?.question) ||
              normalizeText(toolParams.query) ||
              task.query;
            const drafted = composeDocAnswerDraft({
              question,
              taskQuery: task.query,
              taskStatus: task.status,
              taskResult: task.result,
              taskError: task.error,
            });
            traceLog("doc_async.compose", {
              agent_id: agent.agentId,
              task_id: task.taskId,
              status: task.status,
              resolved_lookup_by: resolvedLookupBy,
              evidence_count: drafted.evidence_snippets.length,
              uncertainty_count: drafted.uncertainty_flags.length,
            });
            return {
              success: true,
              type: "doc_async_answer_draft",
              data: {
                task_id: task.taskId,
                status: task.status,
                question,
                resolved_lookup_by: resolvedLookupBy,
                warning: lookupWarning,
                ...drafted,
                next_action:
                  "请基于 evidence_snippets 与用户原问题组织最终回答；若 response_policy.must_include_boundary_notice 为 true，答复中必须声明边界；若 response_policy.should_request_followup 为 true，需主动建议补充检索。",
              },
            };
          }
          return {
            success: true,
            type: actionName === "get_doc_async_readable" ? "doc_async_readable" : "doc_async_result",
            data: {
              task_id: task.taskId,
              status: task.status,
              readable_message: task.readableMessage,
              result: task.result,
              error: task.error,
              completion_reason: task.completionReason,
              session_id: task.sessionId,
              trace_id: task.traceId,
              message_id: task.messageId,
              updated_at_ms: task.updatedAt,
              resolved_lookup_by: resolvedLookupBy,
              warning: lookupWarning,
            },
          };
        }
        if (!channelResolve.sessionId) {
          traceLog("request.reject_missing_channel_session", {
            agent_id: agent.agentId,
            requester_session_key: requesterSessionKey,
            action: actionName || undefined,
          });
          return {
            success: false,
            error_code: "CHANNEL_SESSION_ID_REQUIRED",
            error:
              "baiying_call requires channel sessionId during runtime; cannot execute without channel session context",
            target: {
              requester_session_key: requesterSessionKey,
            },
          };
        }
        const query =
          normalizeText(toolParams.query) ||
          normalizeText(structuredArguments?.query) ||
          normalizeText(structuredArguments?.question) ||
          normalizeText(structuredArguments?.message);
        if (!query && !structuredArguments) {
          return {
            success: false,
            error_code: "INVALID_PARAMETERS",
            error: "`query` is required when `arguments` do not contain a natural-language request",
          };
        }

        const resources = agent.associatedResources ?? [];
        const requestedResourceId = normalizeText(toolParams.resource_id);
        const hasRootAgentResource = !!(agent.agentSseUrl || agent.agentHomeUrl);
        const isRootAgentRequest = hasRootAgentResource && requestedResourceId === agent.sourceKey;
        let selectedResource: BaiyingAssociatedResource | undefined =
          (requestedResourceId && !isRootAgentRequest
            ? resources.find((resource) => resource.resourceId === requestedResourceId)
            : undefined) ?? resources[0];
        if (isRootAgentRequest) {
          selectedResource = undefined;
        }

        let resourceId = requestedResourceId || selectedResource?.resourceId || agent.sourceKey;
        const selectedResourceType = selectedResource ? normalizeResourceType(selectedResource) : "";
        let resourceType =
          normalizeText(toolParams.resource_type) ||
          selectedResourceType ||
          (hasRootAgentResource ? "AGENT" : "UNKNOWN");

        if (!selectedResource && resourceId === agent.sourceKey && hasRootAgentResource) {
          resourceType = "AGENT";
        }

        /** No metadataOnly prefetch: executor `resolveCapability` reads snapshot files by `resourceId` on each execute. */
        const resourceContext = buildExecutorResourceContext({
          agent,
          resource: selectedResource,
          sessionKey: requesterSessionKey,
          channelSessionId: channelResolve.sessionId,
          channelTraceId: channelResolve.traceId,
          language: channelResolve.language,
          beyondToken: channelResolve.beyondToken,
          parentSessionKey: channelResolve.parentSessionKey,
        });
        logChannelDebug(`baiying_call(${agent.agentId})`, {
          resourceContext: resourceContext as ResourceContext,
          channelSessionId: channelResolve.sessionId,
          channelTraceId: channelResolve.traceId,
          logger: params.logger,
        });
        const payload: Record<string, unknown> = {
          query,
          is_subagent: isSubagent,
          tool_call_id: _toolCallId,
          resource_context: resourceContext,
        };
        if (isDocResourceType(resourceType)) {
          // DOC route in executor requires top-level agent_id; use agent.json resourceId (adapted sourceKey).
          payload.agent_id = agent.sourceKey;
        }
        traceLog("executor.route", {
          agent_id: agent.agentId,
          action: actionName || undefined,
          resolved_resource_id: resourceId,
          resolved_resource_type: resourceType,
          selected_resource_id: selectedResource?.resourceId,
          selected_resource_name: selectedResource?.resourceName,
          channel_session_id: channelResolve.sessionId,
          channel_trace_id: channelResolve.traceId,
          channel_session_source: channelResolve.source,
        });
        if (actionName) {
          payload.action = actionName;
        }
        if (structuredArguments) {
          payload.arguments = structuredArguments;
          payload.parameters = structuredArguments;
        }

        // For DOC resources: executor requires `agent_id` + `query`.
        // If user provided `agent_id`, use it; otherwise, auto-fill from current agent sourceKey.
        if (isDocResourceType(resourceType)) {
          const explicitAgentId = normalizeText(toolParams.agent_id);
          payload.agent_id = explicitAgentId || agent.sourceKey;
        }

        logBaiyingRequest(params.logger, "executor.route", {
          agent_id: agent.agentId,
          resource_id: resourceId,
          resource_type: resourceType,
          action: actionName || undefined,
          selected_resource: selectedResource,
          payload,
        });

        // For DOC sync calls, forward the OpenClaw `onUpdate` callback down to
        // the executor so partial answer chunks reach the chat UI as they
        // arrive. Async calls ignore this (they return an ack before any worker
        // reply is observable).
        const streamingDocCall =
          isDocResourceType(resourceType) &&
          normalizeText((structuredArguments as any)?.doc_call_mode).toLowerCase() !== "async";
        const onDelta = streamingDocCall && onUpdate
          ? async (_chunk: string, accumulated: string, eventType: string) => {
              try {
                onUpdate({
                  content: [{ type: "text", text: accumulated }],
                  details: {
                    status: "streaming",
                    accumulated_chars: accumulated.length,
                    event_type: eventType,
                  },
                });
              } catch {
                // surface side-channel updates only; any UI failure must not
                // abort the polling loop
              }
            }
          : undefined;

        try {
          const result = await runBaiyingExecutor({
            executorPath: params.executorPath,
            resourceId,
            resourceType,
            payload,
            onDelta,
            signal,
            logger: params.logger,
          });
          if (typeof result === "string") {
            traceLog("executor.result_text", {
              agent_id: agent.agentId,
              resource_id: resourceId,
              resource_type: resourceType,
              text_length: result.length,
            });
            return {
              success: true,
              data: {
                text: result,
              },
            };
          }
          if (isPlainRecord(result) && result.type === "doc_async" && result.status === "running") {
            const ack = isPlainRecord(result.data) ? result.data : {};
            const taskId = normalizeText(ack.message_id);
            const sessionId = normalizeText(ack.session_id);
            const traceId = normalizeText(ack.trace_id);
            if (taskId && sessionId) {
              const target = isPlainRecord(result.target) ? result.target : {};
              const record: DocAsyncTaskRecord = {
                taskId,
                messageId: taskId,
                requesterSessionKey,
                traceId,
                sessionId,
                targetWorkerId: normalizeText(ack.target_worker_id) || normalizeText(target.target_worker_id),
                targetAgentType: normalizeText(ack.target_agent_type) || normalizeText(target.target_agent_type),
                tenantId: normalizeText(ack.tenant_id),
                resourceId: normalizeText(target.resource_id) || resourceId,
                agentId: agent.agentId,
                query,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                status: "pending",
              };
              docAsyncState.upsert(record);
              traceLog("doc_async.tracked", {
                agent_id: agent.agentId,
                task_id: taskId,
                doc_session_id: sessionId,
                trace_id: traceId,
                target_worker_id: record.targetWorkerId,
                requester_session_key: requesterSessionKey,
              });
            }
            return {
              ...result,
              guidance:
                "DOC 异步任务已投递。建议主智能体调用 sessions_yield 挂起；唤醒后用 action=get_doc_async_result，并优先在 arguments 里传 message_id/session_id，避免把 query 误用为任务ID；随后再用 action=compose_doc_async_answer 生成草稿与证据。",
            };
          }
          traceLog("executor.result_json", {
            agent_id: agent.agentId,
            resource_id: resourceId,
            resource_type: resourceType,
            result_type: isPlainRecord(result) ? normalizeText(result.type) : undefined,
            success: isPlainRecord(result) ? result.success : undefined,
          });
          return result;
        } catch (err) {
          traceLog("executor.error", {
            agent_id: agent.agentId,
            resource_id: resourceId,
            resource_type: resourceType,
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            success: false,
            error_code: "EXECUTOR_FAILED",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    };

    return tool;
  };
}
