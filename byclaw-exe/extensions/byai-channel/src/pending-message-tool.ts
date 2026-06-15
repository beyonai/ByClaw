// message 工具发送的"待投递"标记。
//
// 背景：byai-channel 走"流式优先"——agent 的可见回复（主/子/announce）全部经
// onAgentEvent 的 assistant 流 emit。但 core 的 deliver→outbound.sendText 也会把同一份
// 最终回复（含 announce 直投）送来，造成重复。唯一真正"无 assistant 流、必须靠 sendText
// 投递"的可见内容是 message 工具 action=send。
//
// 权威信号：每次工具调用（含 message）都会在 onAgentEvent 发
//   stream:"tool", data:{ phase:"start", name:"message", toolCallId, args }
// （openclaw src/agents/embedded-agent-subscribe.handlers.tools.ts）。args 含发送文本。
// 我们在见到该事件时登记一条"待投递 message"，sendText 到来时按 sessionKey 配对消费：
//   命中 → 这是 message 工具的全新内容，应 emit；
//   未命中 → 是 agent 回复回声（已由 assistant 流发过），应抑制。
// agent 普通回复永远没有 name:"message" 的 tool 事件，故永不命中、永远抑制，零误判。

const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_PENDING_MESSAGE_TOOL_STORE__";

export interface PendingMessageToolSend {
  toolCallId: string;
  /** 规范化后的 args 发送文本，用于与 sendText.text 配对。 */
  text: string;
}

type PendingMessageToolStore = Map<string, PendingMessageToolSend[]>;

function getStore(): PendingMessageToolStore {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_KEY]?: PendingMessageToolStore;
  };
  if (!globalStore[STORE_KEY]) {
    globalStore[STORE_KEY] = new Map<string, PendingMessageToolSend[]>();
  }
  return globalStore[STORE_KEY];
}

/** 文本配对前的规范化：trim + 统一换行。 */
export function normalizePendingText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

/** onAgentEvent 见到 name:"message" 的 tool start 时登记一条待投递。 */
export function registerPendingMessageToolSend(
  sessionKey: string | undefined,
  send: PendingMessageToolSend,
): void {
  const key = sessionKey?.trim();
  if (!key || !send.toolCallId) {
    return;
  }
  const store = getStore();
  const queue = store.get(key) ?? [];
  queue.push({ toolCallId: send.toolCallId, text: normalizePendingText(send.text) });
  store.set(key, queue);
}

/**
 * sendText 到来时按 sessionKey 配对消费一条待投递 message。
 * 命中（确有 message 工具发起）→ 返回 true（应 emit）；无待投递 → false（应抑制）。
 *
 * 配对策略：优先精确/前缀匹配（core 可能对 args.text 二次清洗，sendText.text 与 args
 * 原文未必逐字相等）；都不匹配但队列非空时，退化取队首——message 工具发送与 sendText
 * 一一对应且 FIFO 有序，取队首是安全的兜底，避免清洗差异导致漏配。
 */
export function consumePendingMessageToolSend(
  sessionKey: string | undefined,
  text: string,
): boolean {
  const key = sessionKey?.trim();
  if (!key) {
    return false;
  }
  const store = getStore();
  const queue = store.get(key);
  if (!queue || queue.length === 0) {
    return false;
  }
  const normalized = normalizePendingText(text);
  let index = queue.findIndex(
    (entry) =>
      entry.text === normalized ||
      (entry.text.length > 0 &&
        (normalized.startsWith(entry.text) || entry.text.startsWith(normalized))),
  );
  if (index === -1) {
    index = 0; // FIFO 兜底：清洗差异时取队首。
  }
  queue.splice(index, 1);
  if (queue.length === 0) {
    store.delete(key);
  }
  return true;
}

/** 请求结束/清理时回收该 sessionKey 的待投递队列。 */
export function clearPendingMessageToolSends(sessionKey: string | undefined): void {
  const key = sessionKey?.trim();
  if (!key) {
    return;
  }
  getStore().delete(key);
}
