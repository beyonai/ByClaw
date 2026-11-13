import { get, set, isString } from 'lodash';
import type { IMessageListItem } from '@/typescript/message';
import { hydrateV2RuntimeState } from './messageV2Runtime';
import { updateExistingMessage } from './messageItemUpdate';

/** Shared segment accumulation for ordinary chat and compact response previews. */
export const appendV2Message = (newAnswerMsg: any, message: IMessageListItem, event: string) => {
  const channel = event.startsWith('reasoningLog') ? 'thinkList' : 'messageList';
  if (!get(newAnswerMsg, '_v2LastSegment')) {
    hydrateV2RuntimeState(newAnswerMsg);
  }
  const current = ((get(newAnswerMsg, channel, []) as IMessageListItem[]) || []).map((item) => ({
    ...item,
    content: { ...item.content },
  }));
  if (updateExistingMessage(current, message)) {
    set(newAnswerMsg, channel, current);
    return;
  }
  const previous = get(newAnswerMsg, '_v2LastSegment') as IMessageListItem | undefined;
  const previousChannel = get(newAnswerMsg, '_v2LastChannel');
  const incomingSeq = Number(message.seq);
  const existingSeqIndex = Number.isFinite(incomingSeq)
    ? current.findIndex((item) => Number(item.seq) === incomingSeq)
    : -1;
  const sameSegment =
    previous &&
    previousChannel === channel &&
    previous.eventType === event &&
    `${previous.contentType}` === `${message.contentType}` &&
    `${get(previous, 'content.orderId') || ''}` === `${get(message, 'content.orderId') || ''}`;
  if (existingSeqIndex >= 0 || sameSegment) {
    const targetIndex = existingSeqIndex >= 0 ? existingSeqIndex : current.length - 1;
    const target = current[targetIndex];
    if (target) {
      const oldSubstance = get(target, 'content.substance');
      const nextSubstance =
        isString(oldSubstance) && isString(get(message, 'content.substance'))
          ? `${oldSubstance}${get(message, 'content.substance')}`
          : get(message, 'content.substance');
      set(target, 'content.substance', nextSubstance);
      set(target, 'status', message.status);
      set(target, 'eventType', event);
      set(newAnswerMsg, channel, current);
      if (targetIndex === current.length - 1) {
        set(newAnswerMsg, '_v2LastSegment', target);
        set(newAnswerMsg, '_v2LastChannel', channel);
      }
      return;
    }
  }
  const nextSeq = Number(get(newAnswerMsg, '_v2NextSeq', 1));
  const nextItem = { ...message, seq: Number.isFinite(message.seq) ? message.seq : nextSeq, eventType: event };
  current.push(nextItem);
  set(newAnswerMsg, channel, current);
  set(newAnswerMsg, '_v2NextSeq', Math.max(nextSeq, Number(nextItem.seq) + 1));
  set(newAnswerMsg, '_v2LastSegment', nextItem);
  set(newAnswerMsg, '_v2LastChannel', channel);
};
