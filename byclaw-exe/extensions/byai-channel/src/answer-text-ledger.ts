// 已推送给前端的文本账本，用于 outbound.sendText 的去重判定。
//
// 背景：byai-channel 走"流式优先"——agent 的可见回复主要经 onAgentEvent 的 assistant 流
// emit。但 core 的 deliver→outbound.sendText 也会把同一份最终回复送来，直接投递就会重复。
// 反过来，有些可见内容只走 sendText、没有对应的流式输出：
//   - message 工具 action=send（无 assistant 流）；
//   - subagent 完成后 parent 只回 NO_REPLY 时，core 走 deliverTextCompletionDirect 直投
//     子任务原文（src/agents/subagent-announce-delivery.ts）。这两份内容必须投递。
// 单靠事件类型或调用来源都无法区分，唯一可靠的判据是"这段文本是否已经推给过前端"。
//
// 判据是"已推送"而非"进了答案通道"：子会话 assistant 流在 agent-event.ts 里映射为
// REASONING_LOG_DELTA，落思考通道而非答案区，但客户端已经收到。此时抑制 core 的重投只是
// 让这段内容留在思考区、不再进答案区，内容不丢；没流过则账本无条目，sendText 照常投答案区。
// 代价是子任务原文的展示位置可能从答案区变为思考区——这是刻意接受的取舍，优于推重复内容。
//
// 子会话组只做等值比对（父/推送组保留包含与前缀两向）：子任务报告通常很长，用包含判定会把
// parent 的最终答案当作它的子串一起抑制，那句答案就只以报告的一部分留在思考区，答案区空着。
//
// 账本按 sessionKey 下的「组」存放，一组一条文本，比对时逐组独立判定。不合并成单缓冲：
// 合并后跨组的两段文本会拼出谁都没发过的子串，把全新内容误判成重复。

const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_ANSWER_TEXT_LEDGER__";

/**
 * 单组文本上限。流式组按段落替换、推送组是单条整段，正常远低于此值；这里只兜住异常长
 * 输出，避免账本随会话无界增长。超限保留尾部：重复回声紧跟输出到达，尾部即去重窗口。
 */
const MAX_GROUP_CHARS = 200_000;

/**
 * 允许「账本条目是待判文本的前缀」这一向生效的最小长度（按规范化后字符数）。该方向用于兜住
 * core 在流式原文之后追加内容的情形，但短条目（如刚开始流的"好的"）会成为大量文本的前缀而
 * 误抑制答案。取值只需长到两段不同回复不可能共享这么多开头字符，又不高于常见整段回复长度。
 */
const MIN_PREFIX_MATCH_CHARS = 32;

/** 推送组的 key 前缀。与 runId 分组同处一个 Map，靠前缀区分来源。 */
const PUSHED_GROUP_KEY_PREFIX = "pushed:";

/**
 * 子会话流式组的 key 前缀。判定时据此只做等值比对，见 deliveredAnswerTextCovers。
 * 与 runId 同处一个 Map，加前缀避免父子同 runId 时互相覆盖。
 */
const CHILD_GROUP_KEY_PREFIX = "child:";

type AnswerTextLedgerStore = Map<string, Map<string, string>>;

function getStore(): AnswerTextLedgerStore {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_KEY]?: AnswerTextLedgerStore;
  };
  if (!globalStore[STORE_KEY]) {
    globalStore[STORE_KEY] = new Map<string, Map<string, string>>();
  }
  return globalStore[STORE_KEY];
}

function capGroupText(value: string): string {
  return value.length > MAX_GROUP_CHARS ? value.slice(value.length - MAX_GROUP_CHARS) : value;
}

function setGroupText(sessionKey: string, groupKey: string, text: string): void {
  const store = getStore();
  let groups = store.get(sessionKey);
  if (!groups) {
    groups = new Map<string, string>();
    store.set(sessionKey, groups);
  }
  groups.set(groupKey, capGroupText(text));
}

/**
 * 比对前的规范化：折叠所有空白为单个空格并 trim。core 在 deliver 前会做
 * stripInternalRuntimeScaffolding / flattenMarkdownDetails 等清洗
 * （src/infra/outbound/deliver-payload.ts），sendText 的文本与流式原文未必逐字相等，
 * 折叠空白能吸收其中最常见的换行/缩进差异。
 */
export function normalizeAnswerLedgerText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * 记录 assistant 流的当前段落快照，按 `runId` 分组、整段替换。父会话与子会话都记，各自的
 * run 天然落在不同组；`isChildSession` 决定该组用哪种比对强度（见
 * deliveredAnswerTextCovers）。
 *
 * 必须是替换而非追加：一个 run 内的 assistant 文本会被工具调用切成多段，段与段之间流式
 * 缓冲会重置（见 utils.ts 的 emitIncrementalText），而 core 最终只投递最后一段。若把各段
 * 追加成一条，账本就既不等于也不前缀于投递文本，重复内容会漏到客户端。
 */
export function recordStreamedAnswerSegment(params: {
  sessionKey: string | undefined;
  runId: string | undefined;
  segmentText: string;
  isChildSession: boolean;
}): void {
  const key = params.sessionKey?.trim();
  const runGroup = params.runId?.trim();
  if (!key || !runGroup || !params.segmentText) {
    return;
  }
  const group = params.isChildSession ? `${CHILD_GROUP_KEY_PREFIX}${runGroup}` : runGroup;
  setGroupText(key, group, params.segmentText);
}

/**
 * 记录本渠道经 sendText 主动推出去的整段文本，自成一组。
 *
 * 这类内容没有对应的答案流（message 工具、core 直投的子任务原文），记账后才能让 core 的
 * 重投命中去重；每条独占一组，避免与流式分组或彼此拼接出虚假子串。
 */
export function recordPushedAnswerText(sessionKey: string | undefined, text: string): void {
  const key = sessionKey?.trim();
  if (!key || !text) {
    return;
  }
  const groups = getStore().get(key);
  setGroupText(key, `${PUSHED_GROUP_KEY_PREFIX}${groups?.size ?? 0}`, text);
}

/**
 * 该文本是否已推给过前端。命中 → sendText 应抑制；未命中 → 是全新可见内容，必须投递。
 *
 * 逐组独立判定，父/推送组与子会话组强度不同：
 *   - 父会话流式组、推送组：条目包含待判文本（主路径，流式快照整段包住 core 的最终文本），
 *     或待判文本以条目开头（兜住 core 在流式原文之后追加内容，受 MIN_PREFIX_MATCH_CHARS
 *     约束，避免短条目吞掉答案）。代价是极短文本可能被历史输出包含而误判重复，可接受。
 *   - 子会话流式组：只认等值。子任务报告往往很长，包含判定会把 parent 的最终答案当成它的
 *     子串整段抑制，答案就只以报告的一部分留在思考区。等值足够挡住 core 用同一份原文的
 *     text-direct 重投（src/agents/subagent-announce-delivery.ts 直投的是 trim 后的原文，
 *     不加前后缀），又不会波及 parent 自己的回复。
 */
export function deliveredAnswerTextCovers(sessionKey: string | undefined, text: string): boolean {
  const normalized = normalizeAnswerLedgerText(text);
  if (!normalized) {
    return true; // 空文本没有可投递内容，按已覆盖处理。
  }
  const key = sessionKey?.trim();
  if (!key) {
    return false;
  }
  const groups = getStore().get(key);
  if (!groups) {
    return false;
  }
  for (const [groupKey, groupText] of groups) {
    const entry = normalizeAnswerLedgerText(groupText);
    if (!entry) {
      continue;
    }
    if (entry === normalized) {
      console.log("[byai-channel] deliveredAnswerTextCovers hit exact match");
      return true;
    }
    if (entry.length >= MIN_PREFIX_MATCH_CHARS && normalized.startsWith(entry)) {
      console.log("[byai-channel] deliveredAnswerTextCovers hit prefix match");
      return true;
    }
  }
  return false;
}

/** 请求结束/清理时回收该 sessionKey 的账本。 */
export function clearDeliveredAnswerText(sessionKey: string | undefined): void {
  const key = sessionKey?.trim();
  if (!key) {
    return;
  }
  getStore().delete(key);
}
