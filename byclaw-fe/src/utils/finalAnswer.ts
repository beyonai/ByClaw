import { SSEMessageType } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';

/** 最终正文必须是有效文本，不能把完成标记或结构化卡片当成 Markdown。 */
export const getFinalContent = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim() || value.trim() === '[DONE]') return undefined;
  return value;
};

const normalizeText = (value: string) => value.replace(/\r\n?/g, '\n').trim();

/** 仅生成展示排除项，保留原始列表和 seq，避免卡片更新时覆盖完整消息数据。 */
export const getFinalAnswerProjection = (message: IMessage, finalContent?: string, ordered = false) => {
  const hiddenAnswerItems = new Set<IMessageListItem>();
  if (!finalContent) return { hiddenAnswerItems, hideText: false };

  const finalText = normalizeText(finalContent);
  const items = ordered
    ? [...(message.messageList || [])].sort((left, right) => Number(left.seq) - Number(right.seq))
    : message.messageList || [];
  const thinkingSeqs = ordered ? (message.thinkList || []).map((item) => Number(item.seq)) : [];
  let suffix = '';
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (`${item.contentType}` !== `${SSEMessageType.text}` || typeof item.content?.substance !== 'string') break;

    // V2 中两个回答片段之间的思考块会打断相邻性；不能跨块拼接后误删过程答复。
    const nextSeq = items[index + 1]?.seq;
    if (thinkingSeqs.some((seq) => seq > Number(item.seq) && seq < Number(nextSeq))) break;
    suffix = item.content.substance + suffix;
    if (normalizeText(suffix) === finalText) {
      items.slice(index).forEach((duplicate) => hiddenAnswerItems.add(duplicate));
      break;
    }
  }

  return {
    hiddenAnswerItems,
    hideText: typeof message.text === 'string' && normalizeText(message.text) === finalText,
  };
};
