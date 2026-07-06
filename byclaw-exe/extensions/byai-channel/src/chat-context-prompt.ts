import type { ByaiLaneMetadata } from "./types.js";

export interface ByclawChatContextCrossAgentHint {
  required: boolean;
  mentionedAgents: string[];
}

export interface ByclawChatContextToolPromptOptions {
  crossAgentHint?: ByclawChatContextCrossAgentHint;
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

function extractMentionedAgents(text: string): string[] {
  const mentions: string[] = [];
  const atMentionRegex = /@([^\s@，,。；;：:\n\r]+(?:\s+[^\s@，,。；;：:\n\r]+)?)/gu;
  let match: RegExpExecArray | null;
  while ((match = atMentionRegex.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  const roleRegex =
    /\b(?:ByClaw\s+)?(?:coder|reviewer|tester|issue[-_\s]?triage|req[-_\s]?analyst|orchestrator|team[-_\s]?lead|specialist[-_\s]?teammate)\b/giu;
  while ((match = roleRegex.exec(text)) !== null) {
    mentions.push(match[0]);
  }

  for (const keyword of ["个人助理", "陈舵主", "测试", "评审", "代码", "需求", "问题分诊"]) {
    if (text.includes(keyword)) {
      mentions.push(keyword);
    }
  }

  return uniqueNormalized(mentions);
}

function hasCrossAgentAction(text: string): boolean {
  return [
    /跨\s*agent/iu,
    /其他\s*@?\s*agent/iu,
    /别的\s*@?\s*agent/iu,
    /某些?\s*@?\s*agent/iu,
    /同一聊天室|这个聊天室|聊天室内/iu,
    /之前都聊了什么|历史(?:消息|上下文|记录)?/iu,
    /承接|接力|继续|复核|评审|参考|基于|根据|汇总|总结|整合|对比/iu,
    /上条|上一轮|前面|之前|刚才|交接单|输出|结论|结果/iu,
    /\b(?:handoff|take over|continue|review|refer|previous|prior|earlier|other agent|another agent)\b/iu,
  ].some((pattern) => pattern.test(text));
}

function hasAgentReference(text: string, mentionedAgents: string[]): boolean {
  return mentionedAgents.length > 0 || /@|agent|智能体|助理|员工|同事|角色/iu.test(text);
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

export function detectByclawChatContextCrossAgentHint(params: {
  text?: string;
  laneMetadata?: ByaiLaneMetadata;
}): ByclawChatContextCrossAgentHint {
  const text = typeof params.text === "string" ? params.text.trim() : "";
  if (!text) {
    return { required: false, mentionedAgents: [] };
  }
  const mentionedAgents = extractMentionedAgents(text).filter((agent) => {
    const currentAgentName = params.laneMetadata?.agentName?.trim();
    const currentAgentCode = params.laneMetadata?.agentCode?.trim();
    const currentLaneId = params.laneMetadata?.laneId?.trim();
    return ![currentAgentName, currentAgentCode, currentLaneId]
      .filter(Boolean)
      .some((current) => current && isSameAgentReference(agent, current));
  });
  const required = hasCrossAgentAction(text) && hasAgentReference(text, mentionedAgents);
  return {
    required,
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
      "ByClaw chat handoff context is available through the `byclaw_chat_context` tool.",
      "When the user asks you to continue, take over, review a previous agent's work, or refer to another @agent in the same ByClaw chat, call `byclaw_chat_context` first and use its visible messages instead of assuming access to private OpenClaw transcripts.",
      "Normally call it without `current_lane_only=false`; by default it returns only the current calling agent/lane's chat records to avoid repeated or unrelated context.",
      "For parallel @agent requests, keep your answer scoped to your own lane. The tool defaults to the current lane; only set `current_lane_only=false` when the user explicitly asks for cross-agent handoff or review.",
      crossAgentPrompt,
    ].filter(Boolean).join("\n");
  }
  return [
    "ByClaw 聊天室接力上下文需要通过 `byclaw_chat_context` 工具获取。",
    "当用户要求“继续/承接/接力/复核上条/参考同一聊天室里的其他 @agent 输出”时，先调用 `byclaw_chat_context`，基于工具返回的可见消息承接，不要假设能读取其他 OpenClaw agent 的私有 transcript。",
    "一般情况下调用工具时不要设置 `current_lane_only=false`；默认只返回当前调用工具的 agent/lane 的聊天室记录，避免重复或无关上下文进入会话。",
    "并行 @多个 agent 派活时，只回答自己 lane 的任务；工具默认只返回当前 lane，只有用户明确要求跨 agent 接力/复核时才设置 `current_lane_only=false`。",
    crossAgentPrompt,
  ].filter(Boolean).join("\n");
}
