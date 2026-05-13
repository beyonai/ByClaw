import { SSEEventStatus, SSEMessageType } from '@/constants/message';

import type { IMessageListItem } from '@/typescript/message';

import { transformList } from './util';

describe('ThinkingProcessRender transformList', () => {
  it('attaches nodes to the matched parentOrderId node instead of the current title node', () => {
    const thinkList: IMessageListItem[] = [
      {
        contentType: SSEMessageType.thinkRootTitle,
        status: SSEEventStatus.query,
        content: {
          substance: 'Root',
          orderId: 'root-1',
        },
      },
      {
        contentType: SSEMessageType.thinkTitle,
        status: SSEEventStatus.query,
        content: {
          substance: 'Section',
          orderId: 'title-1',
          parentOrderId: 'root-1',
        },
      },
      {
        contentType: SSEMessageType.thinkTaskPrepare,
        status: SSEEventStatus.query,
        content: {
          substance: 'Prepare',
          orderId: 'task-1',
          parentOrderId: 'title-1',
        },
      },
      {
        contentType: SSEMessageType.text,
        status: SSEEventStatus.query,
        content: {
          substance: 'nested text',
          orderId: 'text-1',
          parentOrderId: 'task-1',
        },
      },
    ];

    const result = transformList(thinkList, false);

    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(1);

    const titleNode = result[0].children[0];
    expect(titleNode.content.orderId).toBe('title-1');
    expect(titleNode.children).toHaveLength(1);

    const taskNode = titleNode.children[0];
    expect(taskNode.content.orderId).toBe('task-1');
    expect(taskNode.children).toHaveLength(1);
    expect(taskNode.children[0].content.orderId).toBe('text-1');
  });
});
