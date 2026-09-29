/**
 * 会话级「思考强度」前端单一事实来源。
 *
 * 词表与能力规则必须与后端保持一致：
 * - byclaw-be `SessionModelSelectionService`（THINKING_LEVELS / isAllowedLevel）是强制方；
 * - byclaw-super `THINKING_LEVELS` 决定运行时合法取值（词表外的值会让整轮抛错）。
 */

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** 档位展示名（仅 UI 文案，不参与传输）。 */
export const THINKING_LEVEL_LABELS: Record<string, string> = {
  off: '关闭',
  minimal: '极简',
  low: '简略',
  medium: '适中',
  high: '深入',
  xhigh: '极深',
  adaptive: '自动',
  max: '极效',
};

/** 模型列表接口返回的 reasoningConfig 子集。 */
export type ModelReasoningConfig = {
  enabled?: boolean;
  capability?: string;
  defaultLevel?: string;
  supportedEfforts?: string[];
};

/** 「跟随默认 / 恢复默认」信号：与 relModelId 的 -1 语义一致，要求服务端清除本会话档位覆盖。 */
export const THINKING_LEVEL_DEFAULT_SIGNAL = '-1';

const OFF: ThinkingLevel = 'off';

export function normalizeThinkingLevel(value?: string | null): ThinkingLevel | undefined {
  const normalized = `${value ?? ''}`.trim().toLowerCase();
  return (THINKING_LEVELS as readonly string[]).includes(normalized) ? (normalized as ThinkingLevel) : undefined;
}
export function thinkingLevelLabel(value?: string | null): string {
  const level = normalizeThinkingLevel(value);
  return level ? THINKING_LEVEL_LABELS[level] || level : '';
}

/** 该模型是否支持会话级思考强度控制（capability 缺省或 unsupported 时不可控）。 */
export function isReasoningSelectable(reasoning?: ModelReasoningConfig): boolean {
  if (!reasoning || reasoning.enabled !== true) return false;
  const capability = `${reasoning.capability ?? ''}`.trim().toLowerCase();
  return capability !== '' && capability !== 'unsupported';
}

/**
 * 面板可选档位（升序）。
 *
 * - `off` 固定可选，不受 supportedEfforts 影响。
 * - supportedEfforts 非空时：`off + supportedEfforts`。
 * - supportedEfforts 为空时：使用后台「思考强度」下拉框的完整词表。
 */
export function thinkingLevelsFor(reasoning?: ModelReasoningConfig): ThinkingLevel[] {
  if (!isReasoningSelectable(reasoning)) return [];
  const declared = (reasoning?.supportedEfforts ?? [])
    .map((item) => normalizeThinkingLevel(item))
    .filter((level): level is ThinkingLevel => Boolean(level) && level !== OFF);
  if (declared.length === 0) return [...THINKING_LEVELS];
  const ordered = THINKING_LEVELS.filter((level) => level === OFF || declared.includes(level));
  return [...ordered];
}

/** 所有可调模型统一显示为分档能力。 */
export function thinkingCapabilityTag(reasoning?: ModelReasoningConfig): string | undefined {
  if (!isReasoningSelectable(reasoning)) return undefined;
  return '支持分档';
}

/** 所有能力类型共用同一个面板标题。 */
export function thinkingPanelTitle(): string {
  return '推理强度';
}

/** 该模型在当前选择下的默认档位（「跟随默认」时展示的位置）。 */
export function thinkingDefaultLevel(reasoning?: ModelReasoningConfig): ThinkingLevel | undefined {
  const levels = thinkingLevelsFor(reasoning);
  if (levels.length === 0) return undefined;
  const declared = normalizeThinkingLevel(reasoning?.defaultLevel);
  if (declared && levels.includes(declared)) return declared;
  return levels[levels.length - 1];
}

/** 面板底部提示文案。 */
export function thinkingPanelHint(params: {
  reasoning?: ModelReasoningConfig;
  preview: boolean;
  explicitLevel?: string;
}): string {
  if (params.preview) return '悬停预览，点击模型后可调整';
  if (params.explicitLevel) return '已应用，从下一条消息生效';
  return '当前跟随模型默认档位';
}

/**
 * 面板滑杆的当前取值：显式选择优先，其次是「跟随默认」对应的模型默认档位。
 *
 * @returns 档位；模型不支持时返回 undefined
 */
export function resolveThinkingPanelLevel(params: {
  reasoning?: ModelReasoningConfig;
  explicitLevel?: string;
}): ThinkingLevel | undefined {
  const levels = thinkingLevelsFor(params.reasoning);
  if (levels.length === 0) return undefined;
  const explicit = normalizeThinkingLevel(params.explicitLevel);
  if (explicit && levels.includes(explicit)) return explicit;
  return thinkingDefaultLevel(params.reasoning);
}
