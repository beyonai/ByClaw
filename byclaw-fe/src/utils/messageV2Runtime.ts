import { set } from 'lodash';

import type { IMessage, IMessageListItem } from '@/typescript/message';

type V2Channel = 'thinkList' | 'messageList';

type SequencedItem = {
  channel: V2Channel;
  item: IMessageListItem;
};

const getSequencedItems = (message: IMessage): SequencedItem[] => [
  ...(message.thinkList || []).map((item) => ({ channel: 'thinkList' as const, item })),
  ...(message.messageList || []).map((item) => ({ channel: 'messageList' as const, item })),
];

/** Rebuilds ephemeral v2 stream cursors after a running message is restored from persisted arrays. */
export const hydrateV2RuntimeState = (message: IMessage) => {
  const sequencedItems = getSequencedItems(message).filter(({ item }) => Number.isFinite(item.seq));
  const lastSegment = sequencedItems.reduce<SequencedItem | undefined>((latest, current) => {
    if (!latest || Number(current.item.seq) > Number(latest.item.seq)) return current;
    return latest;
  }, undefined);
  const nextSeq = lastSegment ? Number(lastSegment.item.seq) + 1 : 1;

  set(message, '_v2NextSeq', nextSeq);
  if (lastSegment) {
    set(message, '_v2LastSegment', lastSegment.item);
    set(message, '_v2LastChannel', lastSegment.channel);
  }

  return message;
};
