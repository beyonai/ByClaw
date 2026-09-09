import { IMessageState, SSEEventStatus, SSEMessageType } from '@/constants/message';
import type { IMessageListItem } from '@/typescript/message';

import { groupOrderedItems, isThinkingGroupEnded, mergeOrderedItems, validateOrderedItems } from './ordered';

const item = (seq: number, contentType: SSEMessageType, substance: string): IMessageListItem =>
  ({
    seq,
    contentType,
    status: SSEEventStatus.done,
    content: { substance },
  } as IMessageListItem);

describe('ordered message helpers', () => {
  it('merges think and answer lists by the shared sequence', () => {
    const merged = mergeOrderedItems(
      [item(3, SSEMessageType.thinkText, 'think-2'), item(1, SSEMessageType.thinkText, 'think-1')],
      [item(2, SSEMessageType.text, 'answer')]
    );

    expect(merged.map(({ item: value, channel }) => `${channel}:${value.content.substance}`)).toEqual([
      'think:think-1',
      'answer:answer',
      'think:think-2',
    ]);
  });

  it('groups only adjacent items from the same channel', () => {
    const groups = groupOrderedItems(
      mergeOrderedItems(
        [item(1, SSEMessageType.thinkText, 'one'), item(3, SSEMessageType.thinkText, 'three')],
        [item(2, SSEMessageType.text, 'two')]
      )
    );

    expect(groups.map((group) => `${group.channel}:${group.items.length}`)).toEqual(['think:1', 'answer:1', 'think:1']);
  });

  it('keeps structured tool and status events inside the chronological thinking block', () => {
    const groups = groupOrderedItems(
      mergeOrderedItems(
        [
          item(1, SSEMessageType.thinkText, 'reasoning'),
          item(2, SSEMessageType.toolCall, 'read_file'),
          item(3, SSEMessageType.thinkStatusTitle, 'worker completed'),
          item(5, SSEMessageType.thinkText, 'summary reasoning'),
        ],
        [item(4, SSEMessageType.text, 'answer')]
      )
    );

    expect(groups.map((group) => `${group.channel}:${group.items.map(({ seq }) => seq).join(',')}`)).toEqual([
      'think:1,2,3',
      'answer:4',
      'think:5',
    ]);
  });

  it('keeps consecutive thinking segments in one block regardless of segment metadata', () => {
    const groups = groupOrderedItems(
      mergeOrderedItems(
        [
          {
            ...item(1, SSEMessageType.thinkText, 'one'),
            eventType: 'reasoningLogDelta',
            content: { orderId: 'a', substance: 'one' },
          },
          {
            ...item(2, SSEMessageType.thinkTitle, 'two'),
            eventType: 'reasoningLogDelta',
            content: { orderId: 'b', substance: 'two' },
          },
        ],
        []
      )
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].channel).toBe('think');
    expect(groups[0].items.map(({ seq }) => seq)).toEqual([1, 2]);
  });

  it('keeps the active thinking block open until another segment arrives or the message ends', () => {
    expect(isThinkingGroupEnded(false, IMessageState.Query)).toBe(false);
    expect(isThinkingGroupEnded(false, IMessageState.Answer)).toBe(false);
    expect(isThinkingGroupEnded(false, IMessageState.Answer, true)).toBe(true);
    expect(isThinkingGroupEnded(true, IMessageState.Answer)).toBe(true);
    expect(isThinkingGroupEnded(false, IMessageState.Done)).toBe(true);
    expect(isThinkingGroupEnded(false, IMessageState.Cancel)).toBe(true);
    expect(isThinkingGroupEnded(false, IMessageState.Error)).toBe(true);
    expect(isThinkingGroupEnded(false, IMessageState.Timeout)).toBe(true);
  });

  it('rejects missing, duplicate, and non-numeric sequence values', () => {
    expect(validateOrderedItems([item(1, SSEMessageType.text, 'ok')])).toBe(true);
    expect(validateOrderedItems([item(1, SSEMessageType.text, 'a'), item(1, SSEMessageType.thinkText, 'b')])).toBe(
      false
    );
    expect(validateOrderedItems([{ ...item(1, SSEMessageType.text, 'bad'), seq: undefined }])).toBe(false);
    expect(validateOrderedItems([{ ...item(1, SSEMessageType.text, 'bad'), seq: Number.NaN }])).toBe(false);
  });
});
