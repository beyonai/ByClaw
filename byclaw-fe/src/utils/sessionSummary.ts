/**
 * 会话摘要中的思考态内容过滤（#291）。
 *
 * 历史数据里 session_content / messageContent 可能混入思考过程的标题行
 * （如「任务规划」「已思考结束」），这里只做保守过滤：
 * - 剔除 <think>...</think> 块；
 * - 删除整行等于思考标签的行（允许行首 markdown 标记与 ** 包裹）；
 * - 删除文本开头直接首尾相连的多个标签（如「任务规划企业资料」+ 换行）。
 * 正文中间出现的标签词不做处理，避免误伤。
 */

/**
 * 思考标签文案，必须与 locales 中对应 key 的值保持一致（由单测断言）：
 * thinkTitle.taskPlan / companyData / networkSearch / optimizeData / digitalEmployee / taskEnd，
 * thinkingProcess.done / thinkingProcess.thinking。
 */
export const THINKING_LABELS_ZH = [
  '任务规划',
  '企业资料',
  '联网检索',
  '优化资料',
  '数字员工',
  '任务结束',
  '已思考结束',
  '深度思考中...',
];

export const THINKING_LABELS_EN = [
  'Task Plan',
  'Company Data',
  'Network Search',
  'Optimize Data',
  'Digital Employee',
  'Task End',
  'Completed',
  'Thinking...',
];

const THINKING_LABELS = [...THINKING_LABELS_ZH, ...THINKING_LABELS_EN];

const LABEL_SET = new Set(THINKING_LABELS);

// 长标签优先匹配，避免短标签吞掉长标签的前缀
const LABELS_BY_LENGTH = [...THINKING_LABELS].sort((a, b) => b.length - a.length);

/** 去掉行首 markdown 标记（标题、引用、列表）与首尾的强调符号 */
const normalizeLine = (line: string) =>
  line
    .trim()
    .replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)+/, '')
    .replace(/^(\*\*|__|\*|_)(.*)\1$/, '$2')
    .trim();

const findLabelAtStart = (text: string) => LABELS_BY_LENGTH.find((label) => text.startsWith(label));

/** 判断一段文本是否完全由一个或多个首尾相连的思考标签组成，例如「任务规划企业资料」 */
const isLabelSequence = (text: string): boolean => {
  if (!text) return true;
  const matched = findLabelAtStart(text);
  return !!matched && isLabelSequence(text.slice(matched.length).trim());
};

/** 判断一行是否只包含思考标签 */
const isLabelOnlyLine = (line: string) => {
  const normalized = normalizeLine(line);
  if (!normalized) return false;
  return LABEL_SET.has(normalized) || isLabelSequence(normalized);
};

/**
 * 剥离文本开头连续出现的思考标签（换行被折叠成空格的历史数据）。
 * 标签之后必须是空白、文本结尾或另一个标签，才视为标签前缀，避免截掉正文开头的普通词语。
 */
const isLabelPrefix = (text: string, label: string) => {
  if (!text.startsWith(label)) return false;
  const after = text.slice(label.length);
  return !after || /^\s/.test(after) || !!findLabelAtStart(after);
};

const stripLeadingLabels = (text: string): string => {
  const matched = LABELS_BY_LENGTH.find((label) => isLabelPrefix(text, label));
  if (!matched) return text.trim();
  return stripLeadingLabels(text.slice(matched.length).trimStart());
};

export const stripThinkingContent = (input: unknown): string => {
  if (typeof input !== 'string' || !input.trim()) return '';

  let text = input.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // 未闭合的 <think>：其后全部是思考内容
  const openIndex = text.search(/<think>/i);
  if (openIndex >= 0) text = text.slice(0, openIndex);

  const lines = text.split(/\r?\n/).filter((line) => !isLabelOnlyLine(line));
  return stripLeadingLabels(lines.join('\n').trim());
};
