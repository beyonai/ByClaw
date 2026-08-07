import { shouldCompact } from "@earendil-works/pi-coding-agent";

export interface PiPreflightCompactionInput {
  enabled: boolean;
  messageTokens: number;
  systemPromptCharacters: number;
  pendingMessageCharacters: number;
  contextWindow: number;
  reserveTokens: number;
  keepRecentTokens: number;
}

/**
 * Pi 自带的自动压缩主要依据上一条 assistant usage；群聊增量在本轮 prompt 前才加入，
 * 因此额外计算 projected tokens。只有超过窗口预留线且确有旧历史可压缩时才触发。
 */
export function shouldPreflightCompact(
  input: PiPreflightCompactionInput,
): boolean {
  if (!input.enabled || input.messageTokens <= input.keepRecentTokens) {
    return false;
  }
  const projectedTokens =
    input.messageTokens +
    Math.ceil(input.systemPromptCharacters / 4) +
    Math.ceil(input.pendingMessageCharacters / 4);
  return shouldCompact(projectedTokens, input.contextWindow, {
    enabled: input.enabled,
    reserveTokens: input.reserveTokens,
    keepRecentTokens: input.keepRecentTokens,
  });
}
