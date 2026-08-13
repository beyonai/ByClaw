import { SSEEventStatus, SSEMessageType } from '@/constants/message';
import { updateExistingMessage } from '@/utils/messageItemUpdate';

import type { IMessageListItem } from '@/typescript/message';

const toolCall = (seq: number, orderId: string, substance: Record<string, unknown>) =>
  ({
    seq,
    contentType: SSEMessageType.toolCall,
    status: substance.status as never,
    content: { orderId, substance },
  } as IMessageListItem);

describe('stateful message item updates', () => {
  it('merges tool call fields in place and preserves the first sequence', () => {
    const first = toolCall(1, 'tool-A', { title: 'Bash', input: 'uname -m', status: SSEEventStatus.start });
    const list = [first, { seq: 2, contentType: SSEMessageType.text, content: { substance: 'between' } } as never];

    const updated = updateExistingMessage(
      list,
      toolCall(3, 'tool-A', { output: 'arm64', status: SSEEventStatus.done })
    );

    expect(updated).toBe(true);
    expect(list).toHaveLength(2);
    expect(list[0].seq).toBe(1);
    expect(list[0].content.substance).toEqual({
      title: 'Bash',
      input: 'uname -m',
      output: 'arm64',
      status: SSEEventStatus.done,
    });
  });

  it('does not update a different orderId', () => {
    const list = [toolCall(1, 'tool-A', { title: 'Bash' })];

    expect(updateExistingMessage(list, toolCall(2, 'tool-B', { output: 'other' }))).toBe(false);
    expect(list[0].content.substance).toEqual({ title: 'Bash' });
  });

  it('replaces a think status title with the same orderId in place', () => {
    const list = [
      {
        seq: 1,
        contentType: SSEMessageType.thinkStatusTitle,
        content: { orderId: 'status-A', substance: { title: 'Running', status: SSEEventStatus.start } },
      } as IMessageListItem,
      { seq: 2, contentType: SSEMessageType.thinkText, content: { substance: 'details' } } as IMessageListItem,
    ];

    const updated = updateExistingMessage(list, {
      seq: 3,
      contentType: SSEMessageType.thinkStatusTitle,
      content: { orderId: 'status-A', substance: { title: 'Done', status: SSEEventStatus.done } },
    } as IMessageListItem);

    expect(updated).toBe(true);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      seq: 1,
      content: { substance: { title: 'Done', status: SSEEventStatus.done } },
    });
  });
});
