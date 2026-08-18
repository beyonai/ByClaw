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

  it('renders flattened delegated progress, tools, and output as independent top-level sections', () => {
    const thinkList: IMessageListItem[] = [
      {
        contentType: SSEMessageType.thinkTitle,
        status: SSEEventStatus.query,
        content: {
          substance: '派发需求：需求侦探',
          orderId: 'delegation-1:execution',
          parentOrderId: '-1',
        },
      },
      {
        contentType: SSEMessageType.thinkText,
        status: SSEEventStatus.query,
        content: {
          substance: '正在分析需求',
          orderId: 'delegation-1:progress',
          parentOrderId: 'delegation-1:execution',
        },
      },
      {
        contentType: SSEMessageType.thinkStatusTitle,
        status: SSEEventStatus.query,
        objectType: 'tool_call',
        content: {
          substance: { title: '[需求侦探] 调用工具：read', status: '_DONE_' },
          orderId: 'delegation-1:tool:call-1',
          parentOrderId: '-1',
        },
      },
      {
        contentType: SSEMessageType.jsonBlock,
        status: SSEEventStatus.query,
        content: {
          substance: { title: 'Input', json: '{"path":"/tmp/data"}' },
          orderId: 'delegation-1:tool:call-1:input',
          parentOrderId: 'delegation-1:tool:call-1',
        },
      },
      {
        contentType: SSEMessageType.thinkStatusTitle,
        status: SSEEventStatus.query,
        content: {
          substance: { title: '[需求侦探] 数字员工输出', status: '_DONE_' },
          orderId: 'delegation-1:answer',
          parentOrderId: '-1',
        },
      },
      {
        contentType: SSEMessageType.thinkText,
        status: SSEEventStatus.query,
        content: {
          substance: '需求结论',
          orderId: 'delegation-1:answer:text',
          parentOrderId: 'delegation-1:answer',
        },
      },
    ];

    const result = transformList(thinkList, true);

    expect(result.map((node) => node.content.orderId)).toEqual([
      'delegation-1:execution',
      'delegation-1:tool:call-1',
      'delegation-1:answer',
    ]);
    expect(result[0].children?.[0].content.orderId).toBe('delegation-1:progress');
    expect(result[1].children?.[0].content.orderId).toBe('delegation-1:tool:call-1:input');
    expect(result[2].children?.[0].content.orderId).toBe('delegation-1:answer:text');
  });
});
