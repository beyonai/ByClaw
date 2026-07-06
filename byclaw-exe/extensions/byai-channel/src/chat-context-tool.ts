import {
  resolveByclawChatContext,
} from "./chat-context-store.js";
import {
  resolveChannelRequestContextBySessionKey,
} from "./channel-request-context.js";

export const BYCLAW_CHAT_CONTEXT_TOOL_NAME = "byclaw_chat_context";

type ToolContext = Record<string, unknown> | undefined;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function normalizeCurrentLaneOnly(value: unknown): boolean {
  if (value === undefined || value === null || value === "") {
    return true;
  }
  return normalizeBoolean(value);
}

function normalizeLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 40) : 12;
}

function normalizeTextList(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of rawValues) {
    const text = normalizeText(item);
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(text);
  }
  return result;
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
          description: "When true, only return messages from the current OpenClaw lane/sessionKey. Default true; set false only for explicit cross-agent handoff/review.",
        },
        agent_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional agent ids to include when current_lane_only=false. Prefer this over querying every lane.",
        },
        agent_names: {
          type: "array",
          items: { type: "string" },
          description: "Optional agent names or roles to include when current_lane_only=false. Prefer this over querying every lane.",
        },
        lane_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional lane ids to include when current_lane_only=false.",
        },
      },
    },
    async execute(_toolCallId: string, input: Record<string, unknown> = {}) {
      const requesterSessionKey = resolveRequesterSessionKey(ctx);
      const sessionId = resolveSessionId(ctx, input, requesterSessionKey);
      const snapshot = resolveByclawChatContext({
        sessionId,
        limit: normalizeLimit(input.limit),
        includeCurrentLaneOnly: normalizeCurrentLaneOnly(input.current_lane_only),
        requesterSessionKey,
        agentIds: normalizeTextList(input.agent_ids),
        agentNames: normalizeTextList(input.agent_names),
        laneIds: normalizeTextList(input.lane_ids),
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
