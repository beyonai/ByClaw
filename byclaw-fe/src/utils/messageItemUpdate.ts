import { get, isPlainObject, set } from 'lodash';

import { SSEMessageType } from '@/constants/message';
import type { IMessageListItem } from '@/typescript/message';

type MergeSubstance = (current: unknown, incoming: unknown) => unknown;

const replaceSubstance: MergeSubstance = (_current, incoming) => incoming;
const mergeObjectSubstance: MergeSubstance = (current, incoming) =>
  isPlainObject(current) && isPlainObject(incoming) ? { ...current, ...incoming } : incoming;

const inPlaceUpdateStrategies = new Map<string, MergeSubstance>([
  [`${SSEMessageType.thinkStatusTitle}`, replaceSubstance],
  [`${SSEMessageType.toolCall}`, mergeObjectSubstance],
  [`${SSEMessageType.editDiff}`, replaceSubstance],
]);

export const supportsInPlaceUpdate = (item?: Partial<IMessageListItem>) =>
  inPlaceUpdateStrategies.has(`${item?.contentType}`);

export const isSameUpdatableMessage = (left?: Partial<IMessageListItem>, right?: Partial<IMessageListItem>) => {
  if (!supportsInPlaceUpdate(left) || `${left?.contentType}` !== `${right?.contentType}`) return false;
  const leftOrderId = get(left, 'content.orderId');
  const rightOrderId = get(right, 'content.orderId');
  return Boolean(leftOrderId) && `${leftOrderId}` === `${rightOrderId}`;
};

export const mergeUpdatableMessage = (target: IMessageListItem, incoming: IMessageListItem) => {
  const mergeSubstance = inPlaceUpdateStrategies.get(`${target.contentType}`);
  if (!mergeSubstance) return target;
  const substance = mergeSubstance(get(target, 'content.substance'), get(incoming, 'content.substance'));
  set(target, 'content', { ...incoming.content, ...target.content, substance });
  if (incoming.status !== undefined) target.status = incoming.status;
  return target;
};

/** Updates a stateful message in its original list position and preserves the first frame's seq. */
export const updateExistingMessage = (list: IMessageListItem[], incoming: IMessageListItem) => {
  const target = list.find((item) => isSameUpdatableMessage(item, incoming));
  if (!target) return false;
  mergeUpdatableMessage(target, incoming);
  return true;
};
