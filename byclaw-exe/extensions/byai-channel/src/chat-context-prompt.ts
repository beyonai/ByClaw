import type { ByaiLaneMetadata } from "./types.js";

export interface ByclawChatContextCrossAgentHint {
  required: boolean;
  mentionedAgents: string[];
}

export interface ByclawChatContextToolPromptOptions {
  crossAgentHint?: ByclawChatContextCrossAgentHint;
}

export interface DetectByclawChatContextCrossAgentHintParams {
  text?: string;
  laneMetadata?: ByaiLaneMetadata;
  knownAgentRefs?: string[];
}

function uniqueNormalized(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function extractAtMentionedAgents(text: string): string[] {
  const mentions: string[] = [];
  const atMentionRegex = /@([^\s@，,。；;：:\n\r]+(?:\s+[^\s@，,。；;：:\n\r]+)?)/gu;
  let match: RegExpExecArray | null;
  while ((match = atMentionRegex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  return uniqueNormalized(mentions);
}

function isSameAgentReference(agent: string, current: string): boolean {
  const normalizedAgent = agent.trim().toLowerCase();
  const normalizedCurrent = current.trim().toLowerCase();
  return (
    normalizedAgent === normalizedCurrent ||
    normalizedAgent.includes(normalizedCurrent) ||
    normalizedCurrent.includes(normalizedAgent)
  );
}

function textIncludesReference(text: string, ref: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedRef = ref.trim().toLowerCase();
  return Boolean(normalizedRef) && normalizedText.includes(normalizedRef);
}

function currentLaneRefs(laneMetadata: ByaiLaneMetadata | undefined): string[] {
  return uniqueNormalized([
    laneMetadata?.agentName ?? "",
    laneMetadata?.agentCode ?? "",
    laneMetadata?.laneId ?? "",
    laneMetadata?.agentId ?? "",
  ]);
}

export function detectByclawChatContextCrossAgentHint(
  params: DetectByclawChatContextCrossAgentHintParams,
): ByclawChatContextCrossAgentHint {
  const text = typeof params.text === "string" ? params.text.trim() : "";
  if (!text) {
    return { required: false, mentionedAgents: [] };
  }
  const currentRefs = currentLaneRefs(params.laneMetadata);
  const mentionedAgents = uniqueNormalized([
    ...extractAtMentionedAgents(text),
    ...(params.knownAgentRefs ?? []).filter((ref) => textIncludesReference(text, ref)),
  ]).filter((agent) => !currentRefs.some((current) => isSameAgentReference(agent, current)));

  return {
    required: mentionedAgents.length > 0,
    mentionedAgents,
  };
}

function buildCrossAgentPrompt(language: string | undefined, hint: ByclawChatContextCrossAgentHint): string {
  if (!hint.required) {
    return "";
  }
  const isEnglish = typeof language === "string" && language.toLowerCase().startsWith("en");
  const targets = hint.mentionedAgents.length ? hint.mentionedAgents.join(", ") : undefined;
  if (isEnglish) {
    return [
      "Cross-agent chat context is likely required for this turn.",
      "Before answering or taking action, call `byclaw_chat_context` with `current_lane_only=false`, a sufficient `limit`, and targeted `agent_names`/`agent_ids`/`lane_ids` when possible to inspect only relevant visible prior messages in this ByClaw chat room.",
      targets ? `Use targeted filters for messages from or about: ${targets}.` : "Use targeted filters from the returned lane list when a specific other agent is relevant.",
      "Base handoff/review/continuation work only on tool-returned visible messages; do not infer another agent's private transcript.",
    ].join("\n");
  }
  return [
    "本轮任务很可能需要跨 agent 聊天室上下文。",
    "在正式回答或执行前，先调用 `byclaw_chat_context`，参数使用 `current_lane_only=false`，设置足够的 `limit`，并尽量带上 `agent_names`/`agent_ids`/`lane_ids` 精确过滤，只查询当前 ByClaw 聊天室内相关 lane/agent 的可见历史消息。",
    targets ? `优先用过滤参数查询这些 agent/角色相关的历史：${targets}。` : "如果只需要某个其他 agent 的历史，先根据 lane 列表选择过滤参数，不要直接拉全聊天室上下文。",
    "承接、复核、继续或汇总时，只能基于工具返回的可见消息，不要臆测其他 agent 的私有 transcript。",
  ].join("\n");
}

export function buildByclawChatContextToolPrompt(
  language?: string,
  options: ByclawChatContextToolPromptOptions = {},
): string {
  const isEnglish = typeof language === "string" && language.toLowerCase().startsWith("en");
  const crossAgentPrompt = buildCrossAgentPrompt(language, options.crossAgentHint ?? {
    required: false,
    mentionedAgents: [],
  });
  if (isEnglish) {
    return [
      "Supplemental ByClaw chat handoff context is available through the process-local `byclaw_chat_context` tool; it may be incomplete across workers or restarts and is not an authoritative BE snapshot.",
      "When the user asks you to continue, take over, review a previous agent's work, or refer to another @agent in the same ByClaw chat, call `byclaw_chat_context` first and use its visible messages instead of assuming access to private OpenClaw transcripts.",
      "Normally call it without `current_lane_only=false`; by default it returns only the current calling agent/lane's chat records to avoid repeated or unrelated context.",
      "For parallel @agent requests, keep your answer scoped to your own lane. The tool defaults to the current lane; only set `current_lane_only=false` when the user explicitly asks for cross-agent handoff or review.",
      crossAgentPrompt,
    ].filter(Boolean).join("\n");
  }
  return [
    "可通过进程内 `byclaw_chat_context` 工具获取补充性的 ByClaw 聊天室接力上下文；它可能因跨 Worker 或重启而不完整，不是权威 BE 快照。",
    "当用户要求“继续/承接/接力/复核上条/参考同一聊天室里的其他 @agent 输出”时，先调用 `byclaw_chat_context`，基于工具返回的可见消息承接，不要假设能读取其他 OpenClaw agent 的私有 transcript。",
    "一般情况下调用工具时不要设置 `current_lane_only=false`；默认只返回当前调用工具的 agent/lane 的聊天室记录，避免重复或无关上下文进入会话。",
    "并行 @多个 agent 派活时，只回答自己 lane 的任务；工具默认只返回当前 lane，只有用户明确要求跨 agent 接力/复核时才设置 `current_lane_only=false`。",
    crossAgentPrompt,
  ].filter(Boolean).join("\n");
}
