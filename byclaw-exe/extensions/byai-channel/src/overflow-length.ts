/**
 * 判别「上下文压力型 length 截断」：一轮以 `stopReason=length` 结束，且此时上下文已越过
 * OpenClaw 的自动压缩阈值——意味着 core 在下一条消息的 pre-prompt 必会触发 threshold 压缩。
 * 这类截断适合自动续跑（压缩腾出空间后续写），区别于「模型输出太长被 maxToken 切断」。
 *
 * 与 core `packages/agent-core/src/harness/compaction/compaction.ts` 的 `shouldCompact` 同源：
 *   contextTokens > contextWindow - reserveTokens
 * 其中 `calculateContextTokens` 取 `usage.totalTokens`。reserveTokens 的默认 floor 为 16384
 * （core `agent-settings.ts` DEFAULT_AGENT_COMPACTION_RESERVE_TOKENS_FLOOR），会被 ctxBudget 收窄；
 * byai 拿不到 core 解析后的精确 reserveTokens，用该默认并允许调用方覆盖。
 */
const DEFAULT_RESERVE_TOKENS = 16384;

export type ContextPressureUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  totalTokens?: number;
};

export function isContextPressureLength(params: {
  stopReason?: string;
  usage?: ContextPressureUsage;
  contextWindow?: number;
  reserveTokens?: number;
}): boolean {
  if (params.stopReason !== "length") {
    return false;
  }
  const window = params.contextWindow;
  // 缺有效窗口 ⇒ 无法对齐阈值，安全回退（绝不误判，避免错误触发自动续跑）。
  if (!window || window <= 0) {
    return false;
  }
  const total = resolveTotalTokens(params.usage);
  if (total <= 0) {
    return false;
  }
  const reserve = params.reserveTokens ?? DEFAULT_RESERVE_TOKENS;
  return total > Math.max(0, window - reserve);
}

function resolveTotalTokens(usage: ContextPressureUsage | undefined): number {
  if (!usage) {
    return 0;
  }
  if (typeof usage.totalTokens === "number") {
    return usage.totalTokens;
  }
  if (typeof usage.total === "number") {
    return usage.total;
  }
  return (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}
