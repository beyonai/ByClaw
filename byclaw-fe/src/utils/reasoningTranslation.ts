import type { IMessage, IMessageListItem } from '@/typescript/message';
import { IMessageState } from '@/constants/message';

export type ReasoningTranslation = {
  seq: number;
  text: string;
  sourceLength: number;
  revision: number;
  status: 'pending' | 'done' | 'failed';
};

/** Translation updates are snapshots, not append-only deltas. Ignore stale revisions on replay. */
export const applyReasoningTranslations = (message: IMessage, updates: unknown) => {
  if (!Array.isArray(updates)) return;
  const next = { ...message.reasoningTranslations };
  updates.forEach((update: ReasoningTranslation) => {
    if (!update || !Number.isFinite(update.seq) || !Number.isFinite(update.revision) || typeof update.text !== 'string')
      return;
    if (!next[update.seq] || update.revision > next[update.seq].revision) next[update.seq] = update;
  });
  message.reasoningTranslations = next;
};

/** Build render copies so original content remains available for accumulation and tool handling. */
export const translatedThinkingItems = (items: IMessageListItem[], message?: IMessage): IMessageListItem[] =>
  items.map((item) => {
    const live = message?.reasoningTranslations?.[item.seq as number];
    const persisted = item.reasoningTranslation;
    const translation = live && (!persisted || live.revision >= persisted.revision) ? live : persisted;
    if (!translation) return item;
    const terminal =
      message?.isHistoryMsg ||
      [IMessageState.Done, IMessageState.Error, IMessageState.Cancel, IMessageState.Timeout].includes(
        message?.messageState as IMessageState
      );
    const pending =
      translation.status === 'pending' ? (terminal ? '\n该段思考未完成中文转换。' : '\n正在转换中文…') : '';
    return { ...item, content: { ...item.content, substance: `${translation.text}${pending}` } };
  });
