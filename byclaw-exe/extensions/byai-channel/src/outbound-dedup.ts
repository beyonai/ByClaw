// 会话上下文解析的纯函数。
//
// byai-channel 入站时把 to 拼成 `user:{sessionId}`（见 sdk-message-processor）。
// outbound.sendText 的 ctx 只有 to、没有 sessionId/sessionKey，需要从 to 反解。
// answer 去重逻辑见 session-context.ts 的 reserveStreamedAnswerDelta（assistant 流与
// sendText 共享同一 runId 权威缓冲做前缀 diff）。

/** 入站时 to = `user:{sessionId}`（见 sdk-message-processor）。从 to 反解 sessionId。 */
export function parseSessionIdFromTo(to: string | undefined | null): string | undefined {
  const trimmed = to?.trim();
  if (!trimmed) {
    return undefined;
  }
  const prefix = "user:";
  if (!trimmed.startsWith(prefix)) {
    return undefined;
  }
  const sessionId = trimmed.slice(prefix.length).trim();
  return sessionId || undefined;
}
