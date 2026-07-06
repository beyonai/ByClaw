import path from "node:path";
import type { Language } from "./types.js";
import type { ActiveSdkRequest } from "./session-context.js";
import {
  buildChannelExtensionPrompt,
  buildLanguagePrompt,
  buildSessionFilesPrompt,
  buildUserMdReloadPrompt,
} from "./i18n.js";
import {
  buildByclawChatContextToolPrompt,
  detectByclawChatContextCrossAgentHint,
} from "./chat-context-prompt.js";
import { resolveByclawChatContext } from "./chat-context-store.js";

export type PromptInjectionSnapshot = {
  appendSystemContext: string;
  createdAt: number;
};

const SNAPSHOT_STATE = Symbol.for("openclaw.byaiChannel.promptInjectionSnapshot");

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

export function buildPromptInjectionSnapshot(params: {
  request: ActiveSdkRequest;
  currentUserText?: string;
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
    sections.push(buildByclawChatContextToolPrompt(params.request.language, {
      crossAgentHint: detectByclawChatContextCrossAgentHint({
        text: params.currentUserText,
        laneMetadata: params.request.laneMetadata,
        knownAgentRefs: collectKnownAgentRefs(params.request.sessionId),
      }),
    }));
  }
  if (params.request.languageProvided) {
    sections.push(buildLanguagePrompt(params.request.language));
  }
  const channelExtPrompt = buildChannelExtensionPrompt(
    params.request.channelExtension,
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
