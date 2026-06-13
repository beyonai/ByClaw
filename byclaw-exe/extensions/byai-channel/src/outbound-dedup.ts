// 会话上下文解析的纯函数。
//
// byai-channel 入站时把 to 拼成 `<agentId>:<sessionId>`（见 sdk-message-processor）。
// outbound.sendText 的 ctx 只有 to、没有 sessionId/sessionKey，需要从 to 反解。
// sendText 的去重见 pending-message-tool.ts（message 工具事件驱动）。

/** 入站时 to = `<agentId>:<sessionId>`（见 sdk-message-processor）。从 to 反解 sessionId。 */
export function parseSessionIdFromTo(to: string | undefined | null): string | undefined {
  const trimmed = to?.trim();
  if (!trimmed) {
    return undefined;
  }
  const sessionId = trimmed.split(':')[1]?.trim();
  return sessionId || undefined;
}

export function parseAgentIdFromTo(to: string | undefined | null): string | undefined {
  const trimmed = to?.trim();
  if (!trimmed) {
    return undefined;
  }
  const agentId = trimmed.split(':')[0]?.trim();
  return agentId || undefined;
}
