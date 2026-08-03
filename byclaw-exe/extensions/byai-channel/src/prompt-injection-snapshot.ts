import path from "node:path";
import type { Language } from "./types.js";
import type { ActiveSdkRequest } from "./session-context.js";
import {
  buildByclawAcpLanguagePrompt,
  buildChannelExtensionPrompt,
  buildLanguagePrompt,
  buildSessionFilesPrompt,
  buildSkillInstallPrompt,
  buildUserMdReloadPrompt,
  isEnglishLanguage,
} from "./i18n.js";
import {
  buildByclawChatContextToolPrompt,
  detectByclawChatContextCrossAgentHint,
} from "./chat-context-prompt.js";
import {
  type ByclawChatContextLaneSummary,
  type ByclawChatContextMessage,
  type ByclawChatContextSnapshot,
  resolveByclawChatContext,
} from "./chat-context-store.js";
import {
  formatGroupChatContextForPrompt,
  type GroupChatContextV1,
} from "./group-chat-context.js";

export type PromptInjectionSnapshot = {
  appendSystemContext: string;
  createdAt: number;
};

const SNAPSHOT_STATE = Symbol.for("openclaw.byaiChannel.promptInjectionSnapshot");
const CHAT_ROOM_METADATA_KEY = "byclawChatRoom";
const MAX_CHAT_ROOM_METADATA_LANES = 12;
const MAX_CHAT_ROOM_LANE_PREVIEW_CHARS = 180;

function getSnapshotStore(): Map<string, PromptInjectionSnapshot> {
  const globalState = globalThis as typeof globalThis & {
    [SNAPSHOT_STATE]?: Map<string, PromptInjectionSnapshot>;
  };
  if (!globalState[SNAPSHOT_STATE]) {
    globalState[SNAPSHOT_STATE] = new Map<string, PromptInjectionSnapshot>();
  }
  return globalState[SNAPSHOT_STATE];
}

function normalizeSessionKey(sessionKey: string | undefined): string | null {
  const trimmed = sessionKey?.trim();
  return trimmed ? trimmed : null;
}

function collectKnownAgentRefs(sessionId: string): string[] {
  const refs = new Set<string>();
  const snapshot = resolveByclawChatContext({
    sessionId,
    limit: 1,
    includeCurrentLaneOnly: false,
  });
  for (const lane of snapshot.lanes) {
    for (const value of [lane.agentName, lane.agentId, lane.laneId]) {
      const normalized = value?.trim();
      if (normalized) {
        refs.add(normalized);
      }
    }
  }
  return Array.from(refs);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactPreview(text: string | undefined): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > MAX_CHAT_ROOM_LANE_PREVIEW_CHARS
    ? `${normalized.slice(0, MAX_CHAT_ROOM_LANE_PREVIEW_CHARS)}...`
    : normalized;
}

function sameNormalized(left: string | undefined, right: string | undefined): boolean {
  const a = left?.trim().toLowerCase();
  const b = right?.trim().toLowerCase();
  return Boolean(a && b && a === b);
}

function laneMatchesCurrent(
  lane: ByclawChatContextLaneSummary,
  request: ActiveSdkRequest,
): boolean {
  return (
    sameNormalized(lane.sessionKey, request.sessionKey) ||
    sameNormalized(lane.laneId, request.laneMetadata?.laneId) ||
    sameNormalized(lane.agentId, request.laneMetadata?.agentId) ||
    sameNormalized(lane.agentName, request.laneMetadata?.agentName)
  );
}

function messageMatchesLane(
  message: ByclawChatContextMessage,
  lane: ByclawChatContextLaneSummary,
): boolean {
  return (
    sameNormalized(message.sessionKey, lane.sessionKey) ||
    sameNormalized(message.laneId, lane.laneId) ||
    sameNormalized(message.agentId, lane.agentId) ||
    sameNormalized(message.agentName, lane.agentName)
  );
}

function lastMessageForLane(
  snapshot: ByclawChatContextSnapshot,
  lane: ByclawChatContextLaneSummary,
): ByclawChatContextMessage | undefined {
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (messageMatchesLane(message, lane)) {
      return message;
    }
  }
  return undefined;
}

function buildByclawChatRoomMetadata(request: ActiveSdkRequest): Record<string, unknown> | null {
  if (!request.sessionId) {
    return null;
  }
  const snapshot = resolveByclawChatContext({
    sessionId: request.sessionId,
    limit: 40,
    includeCurrentLaneOnly: false,
  });
  if (snapshot.totalMessages === 0 && snapshot.lanes.length === 0) {
    return null;
  }

  const en = isEnglishLanguage(request.language);
  const visibleAgentKeys = new Set<string>();
  const visibleAgentLanes = snapshot.lanes
    .slice(-MAX_CHAT_ROOM_METADATA_LANES)
    .map((lane) => {
      const lastMessage = lastMessageForLane(snapshot, lane);
      const agentKey = lane.agentId?.trim() || lane.agentName?.trim() || lane.laneId?.trim();
      if (agentKey) {
        visibleAgentKeys.add(agentKey.toLowerCase());
      }
      return {
        agentId: lane.agentId,
        agentName: lane.agentName,
        laneId: lane.laneId,
        turnId: lane.turnId,
        messageCount: lane.messageCount,
        lastUpdatedAt: lane.lastUpdatedAt,
        isCurrentLane: laneMatchesCurrent(lane, request),
        lastMessageRole: lastMessage?.role,
        lastMessagePreview: compactPreview(lastMessage?.text),
      };
    });
  const hasOtherAgentLanes = visibleAgentLanes.some((lane) => !lane.isCurrentLane);

  return {
    sessionId: request.sessionId,
    currentLane: {
      agentId: request.laneMetadata?.agentId,
      agentName: request.laneMetadata?.agentName,
      agentCode: request.laneMetadata?.agentCode,
      laneId: request.laneMetadata?.laneId,
      turnId: request.laneMetadata?.turnId,
      sessionKey: request.sessionKey,
    },
    visibleMessageCount: snapshot.totalMessages,
    visibleAgentCount: visibleAgentKeys.size,
    visibleAgentLanes,
    lanesTruncated: snapshot.lanes.length > visibleAgentLanes.length,
    hasOtherAgentLanes,
    contextTool: {
      name: "byclaw_chat_context",
      defaultScope: "current_lane_only",
      crossAgentArgs: { current_lane_only: false, limit: 20 },
      useWhen: en
        ? "When this turn refers to prior chat-room outputs, reports, HTML/files, issue plans, or unspecified previous agent work, call the tool before answering or acting."
        : "当本轮任务引用同聊天室之前的输出、报告、HTML/文件、issue 修复计划，或没有点名具体 agent 的上一轮产物时，先调用该工具再回答或执行。",
    },
    metadataNote: en
      ? "Lane summaries and previews are visible chat-room metadata only; use the tool for full visible messages and do not infer private transcripts."
      : "lane 摘要和预览只是聊天室可见元数据；完整可见消息必须通过工具获取，不能臆测其他 agent 的私有 transcript。",
  };
}

function buildEnhancedChannelExtension(
  raw: unknown,
  request: ActiveSdkRequest,
): unknown {
  const chatRoomMetadata = buildByclawChatRoomMetadata(request);
  if (!chatRoomMetadata) {
    return raw;
  }
  if (raw === undefined || raw === null) {
    return { [CHAT_ROOM_METADATA_KEY]: chatRoomMetadata };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return buildEnhancedChannelExtension(parsed, request);
      } catch {
        return {
          channelExtensionRaw: trimmed,
          [CHAT_ROOM_METADATA_KEY]: chatRoomMetadata,
        };
      }
    }
    return { [CHAT_ROOM_METADATA_KEY]: chatRoomMetadata };
  }
  if (isPlainRecord(raw)) {
    return {
      ...raw,
      [CHAT_ROOM_METADATA_KEY]: chatRoomMetadata,
    };
  }
  return {
    channelExtensionValue: raw,
    [CHAT_ROOM_METADATA_KEY]: chatRoomMetadata,
  };
}

export function buildPromptInjectionSnapshot(params: {
  request: ActiveSdkRequest;
  currentUserText?: string;
  groupChatContext?: GroupChatContextV1;
  workspaceDir?: string;
  includeUserMdReloadHint?: boolean;
}): PromptInjectionSnapshot {
  const sections: string[] = [];
  const normalizedWorkspace = params.workspaceDir ? path.resolve(params.workspaceDir) : "";
  if (params.includeUserMdReloadHint && normalizedWorkspace) {
    sections.push(buildUserMdReloadPrompt(params.request.language));
  }
  if (params.request.sessionId) {
    sections.push(buildSessionFilesPrompt(params.request.sessionId, params.request.language));
    if (params.groupChatContext) {
      sections.push(formatGroupChatContextForPrompt(
        params.groupChatContext,
        params.request.language,
      ));
    } else {
      sections.push(buildByclawChatContextToolPrompt(params.request.language, {
        crossAgentHint: detectByclawChatContextCrossAgentHint({
          text: params.currentUserText,
          laneMetadata: params.request.laneMetadata,
          knownAgentRefs: collectKnownAgentRefs(params.request.sessionId),
        }),
      }));
    }
  }
  sections.push(buildSkillInstallPrompt(normalizedWorkspace, params.request.language));
  if (params.request.languageProvided) {
    sections.push(buildLanguagePrompt(params.request.language));
  }
  sections.push(buildByclawAcpLanguagePrompt(
    params.request.language,
    params.request.languageProvided,
    params.request.sessionId,
  ));
  const channelExtensionForPrompt = buildEnhancedChannelExtension(
    params.request.channelExtension,
    params.request,
  );
  const channelExtPrompt = buildChannelExtensionPrompt(
    channelExtensionForPrompt,
    params.request.language,
  );
  if (channelExtPrompt) {
    sections.push(channelExtPrompt);
  }
  return {
    appendSystemContext: sections.join("\n\n"),
    createdAt: Date.now(),
  };
}

export function setPromptInjectionSnapshot(
  sessionKey: string,
  snapshot: PromptInjectionSnapshot,
): void {
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) {
    return;
  }
  getSnapshotStore().set(normalized, snapshot);
}

export function takePromptInjectionSnapshot(
  sessionKey: string | undefined,
): PromptInjectionSnapshot | undefined {
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) {
    return undefined;
  }
  return getSnapshotStore().get(normalized);
}

export function clearPromptInjectionSnapshot(sessionKey: string | undefined): void {
  const normalized = normalizeSessionKey(sessionKey);
  if (!normalized) {
    return;
  }
  getSnapshotStore().delete(normalized);
}

/** @internal test helper */
export function resetPromptInjectionSnapshotsForTest(): void {
  getSnapshotStore().clear();
}

/** Exported for hooks fallback parity */
export type { Language };
