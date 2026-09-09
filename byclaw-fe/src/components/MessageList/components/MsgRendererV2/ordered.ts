import type { IMessageListItem } from '@/typescript/message';
import type { IMessage } from '@/typescript/message';
import { IMessageState } from '@/constants/message';

export type OrderedChannel = 'think' | 'answer';

export type OrderedItem = {
  item: IMessageListItem;
  channel: OrderedChannel;
};

export type OrderedGroup = {
  channel: OrderedChannel;
  items: IMessageListItem[];
  blockId: string;
};

export const validateOrderedItems = (items: IMessageListItem[]) => {
  const seqs = items.map((item) => item.seq);
  return seqs.every((seq) => typeof seq === 'number' && Number.isFinite(seq)) && new Set(seqs).size === seqs.length;
};

export const isV2Message = (message: IMessage) => {
  let metadata: Record<string, unknown> = {};
  try {
    metadata =
      typeof message.metadata === 'string' ? JSON.parse(message.metadata || '{}') : (message.metadata as any) || {};
  } catch (error) {
    return false;
  }
  if (metadata.messageRenderVersion !== 'v2') return false;
  return validateOrderedItems([...(message.thinkList || []), ...(message.messageList || [])]);
};

export const mergeOrderedItems = (thinkList: IMessageListItem[] = [], messageList: IMessageListItem[] = []) => {
  const items: OrderedItem[] = [
    ...thinkList.map((item) => ({
      item,
      channel: 'think' as const,
    })),
    ...messageList.map((item) => ({ item, channel: 'answer' as const })),
  ];
  return items.sort((left, right) => Number(left.item.seq) - Number(right.item.seq));
};

export const groupOrderedItems = (items: OrderedItem[]) => {
  const groups: OrderedGroup[] = [];
  items.forEach(({ item, channel }) => {
    const previous = groups[groups.length - 1];
    // A block ends only when the rendered channel changes; segment metadata does not affect it.
    if (previous?.channel === channel) {
      previous.items.push(item);
      return;
    }
    groups.push({ channel, items: [item], blockId: `${channel}_${item.seq}` });
  });
  return groups;
};

const terminalMessageStates = [IMessageState.Done, IMessageState.Error, IMessageState.Cancel, IMessageState.Timeout];

export const isThinkingGroupEnded = (hasNextGroup: boolean, messageState: IMessageState, activeThinkingEnded = false) =>
  hasNextGroup || activeThinkingEnded || terminalMessageStates.includes(messageState);
