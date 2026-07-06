import {
  resolveByclawChatContext,
} from "./chat-context-store.js";
import {
  resolveChannelRequestContextBySessionKey,
} from "./channel-request-context.js";

export const BYCLAW_CHAT_CONTEXT_TOOL_NAME = "byclaw_chat_context";

type ToolContext = Record<string, unknown> | undefined;

export function buildByclawChatContextToolPrompt(language?: string): string {
  const isEnglish = typeof language === "string" && language.toLowerCase().startsWith("en");
  if (isEnglish) {
    return [
      "ByClaw chat handoff context is available through the `byclaw_chat_context` tool.",
      "When the user asks you to continue, take over, review a previous agent's work, or refer to another @agent in the same ByClaw chat, call `byclaw_chat_context` first and use its visible messages instead of assuming access to private OpenClaw transcripts.",
      "For parallel @agent requests, keep your answer scoped to your own lane and do not impersonate other agents.",
    ].join("\n");
  }
  return [
    "ByClaw 聊天室接力上下文需要通过 `byclaw_chat_context` 工具获取。",
    "当用户要求“继续/承接/接力/复核上条/参考同一聊天室里的其他 @agent 输出”时，先调用 `byclaw_chat_context`，基于工具返回的可见消息承接，不要假设能读取其他 OpenClaw agent 的私有 transcript。",
    "并行 @多个 agent 派活时，只回答自己 lane 的任务，不要代替其他 agent 输出。",
  ].join("\n");
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function normalizeLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 40) : 12;
}

function resolveRequesterSessionKey(ctx: ToolContext): string {
  return (
    normalizeText(ctx?.sessionKey) ||
    normalizeText(ctx?.SessionKey) ||
    normalizeText(ctx?.session_id) ||
    normalizeText(ctx?.requesterSessionKey)
  );
}

function resolveSessionId(ctx: ToolContext, input: Record<string, unknown>, requesterSessionKey: string): string {
  const sharedContext = resolveChannelRequestContextBySessionKey(requesterSessionKey);
  const fields = sharedContext?.fields ?? {};
  return (
    normalizeText(input.session_id) ||
    normalizeText(input.sessionId) ||
    normalizeText(ctx?.channelSessionId) ||
    normalizeText(ctx?.ChannelSessionId) ||
    normalizeText(ctx?.channel_session_id) ||
    normalizeText(ctx?.gatewaySessionId) ||
    normalizeText(fields.sessionId) ||
    normalizeText(fields.channelSessionId) ||
    normalizeText(fields.channel_session_id)
  );
}

function formatMessageLine(message: ReturnType<typeof resolveByclawChatContext>["messages"][number]): string {
  const actor = message.role === "user"
    ? "user"
    : message.agentName || message.agentId || "assistant";
  const lane = message.laneId ? ` lane=${message.laneId}` : "";
  const agent = message.agentId ? ` agent=${message.agentId}` : "";
  return `[${message.role}:${actor}${agent}${lane}] ${message.text}`;
}

function renderContextText(snapshot: ReturnType<typeof resolveByclawChatContext>): string {
  if (!snapshot.sessionId) {
    return "No ByClaw channel session id is available. This tool must be called from a byai-channel inbound run.";
  }
  if (snapshot.messages.length === 0) {
    return `No visible ByClaw chat context has been recorded for session ${snapshot.sessionId}.`;
  }
  const laneLines = snapshot.lanes.map((lane) => {
    const parts = [
      lane.agentName || lane.agentId || "unknown-agent",
      lane.laneId ? `lane=${lane.laneId}` : "",
      lane.turnId ? `turn=${lane.turnId}` : "",
      `messages=${lane.messageCount}`,
    ].filter(Boolean);
    return `- ${parts.join(" ")}`;
  });
  return [
    `ByClaw visible chat context for session ${snapshot.sessionId}:`,
    snapshot.truncated ? `(showing latest ${snapshot.messages.length} of ${snapshot.totalMessages} messages)` : "",
    laneLines.length ? "Lanes:" : "",
    ...laneLines,
    "Messages:",
    ...snapshot.messages.map(formatMessageLine),
  ].filter(Boolean).join("\n");
}

export function createByclawChatContextTool(ctx: ToolContext) {
  return {
    name: BYCLAW_CHAT_CONTEXT_TOOL_NAME,
    label: "ByClaw Chat Context",
    description:
      "Fetch recent visible ByClaw chat messages for the current byai-channel business session. Use this before handoff/continue/review requests across different @agents instead of relying on private OpenClaw transcript state.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        session_id: {
          type: "string",
          description: "Optional explicit ByClaw business chat session id. Usually omit; byai-channel resolves it from tool context.",
        },
        limit: {
          type: "number",
          description: "Maximum number of recent visible messages to return. Default 12, max 40.",
        },
        current_lane_only: {
          type: "boolean",
          description: "When true, only return messages from the current OpenClaw lane/sessionKey. Default false for handoff.",
        },
      },
    },
    async execute(_toolCallId: string, input: Record<string, unknown> = {}) {
      const requesterSessionKey = resolveRequesterSessionKey(ctx);
      const sessionId = resolveSessionId(ctx, input, requesterSessionKey);
      const snapshot = resolveByclawChatContext({
        sessionId,
        limit: normalizeLimit(input.limit),
        includeCurrentLaneOnly: normalizeBoolean(input.current_lane_only),
        requesterSessionKey,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: renderContextText(snapshot),
          },
        ],
        details: {
          source: "byai-channel",
          requesterSessionKey,
          sessionId: snapshot.sessionId,
          totalMessages: snapshot.totalMessages,
          truncated: snapshot.truncated,
          lanes: snapshot.lanes,
          messages: snapshot.messages,
        },
      };
    },
  };
}
