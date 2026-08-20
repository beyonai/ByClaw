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

  it('builds a nested delegation tree in protocol order and preserves children across status updates', () => {
    const thinkList: IMessageListItem[] = [
      {
        contentType: SSEMessageType.thinkStatusTitle,
        status: SSEEventStatus.query,
        objectType: 'tool_call',
        content: {
          substance: { title: '正在让数字员工处理：需求侦探', status: '_START_' },
          orderId: 'delegation-1',
          parentOrderId: '-1',
        },
      },
      {
        contentType: SSEMessageType.jsonBlock,
        status: SSEEventStatus.query,
        content: {
          substance: { title: 'Input', json: '{"task":"分析需求"}' },
          orderId: 'delegation-1:start',
          parentOrderId: 'delegation-1',
        },
      },
      {
        contentType: SSEMessageType.thinkStatusTitle,
        status: SSEEventStatus.query,
        objectType: 'tool_call',
        content: {
          substance: { title: '调用工具：read', status: '_START_' },
          orderId: 'delegation-1:tool:call-1',
          parentOrderId: 'delegation-1',
        },
      },
      {
        contentType: SSEMessageType.thinkText,
        status: SSEEventStatus.query,
        content: {
          substance: '正在分析需求',
          orderId: 'delegation-1:progress',
          parentOrderId: 'delegation-1',
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
        contentType: SSEMessageType.jsonBlock,
        status: SSEEventStatus.query,
        content: {
          substance: { title: 'Output', json: '{"content":"需求文档"}' },
          orderId: 'delegation-1:tool:call-1:output',
          parentOrderId: 'delegation-1:tool:call-1',
        },
      },
      {
        contentType: SSEMessageType.thinkStatusTitle,
        status: SSEEventStatus.query,
        objectType: 'tool_call',
        content: {
          substance: { title: '调用工具：read', status: '_DONE_' },
          orderId: 'delegation-1:tool:call-1',
          parentOrderId: 'delegation-1',
        },
      },
      {
        contentType: SSEMessageType.thinkStatusTitle,
        status: SSEEventStatus.query,
        content: {
          substance: { title: '数字员工输出', status: '_START_' },
          orderId: 'delegation-1:answer',
          parentOrderId: 'delegation-1',
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
      {
        contentType: SSEMessageType.thinkStatusTitle,
        status: SSEEventStatus.query,
        content: {
          substance: { title: '数字员工输出', status: '_DONE_' },
          orderId: 'delegation-1:answer',
          parentOrderId: 'delegation-1',
        },
      },
      {
        contentType: SSEMessageType.thinkStatusTitle,
        status: SSEEventStatus.query,
        objectType: 'tool_call',
        content: {
          substance: { title: '数字员工处理完成：需求侦探', status: '_DONE_' },
          orderId: 'delegation-1',
          parentOrderId: '-1',
        },
      },
      {
        contentType: SSEMessageType.jsonBlock,
        status: SSEEventStatus.query,
        content: {
          substance: { title: 'Output', json: '{"status":"completed"}' },
          orderId: 'delegation-1:result',
          parentOrderId: 'delegation-1',
        },
      },
    ];

    const result = transformList(thinkList, true);

    expect(result).toHaveLength(1);
    expect(result[0].content.orderId).toBe('delegation-1');
    expect(result[0].content.substance).toEqual({
      title: '数字员工处理完成：需求侦探',
      status: '_DONE_',
    });
    expect(result[0].children?.map((node) => node.content.orderId)).toEqual([
      'delegation-1:start',
      'delegation-1:tool:call-1',
      'delegation-1:progress',
      'delegation-1:answer',
      'delegation-1:result',
    ]);

    const toolNode = result[0].children?.[1];
    expect(toolNode.content.substance.status).toBe('_DONE_');
    expect(toolNode.children?.map((node) => node.content.orderId)).toEqual([
      'delegation-1:tool:call-1:input',
      'delegation-1:tool:call-1:output',
    ]);

    const answerNode = result[0].children?.[3];
    expect(answerNode.content.substance.status).toBe('_DONE_');
    expect(answerNode.children?.[0].content.orderId).toBe('delegation-1:answer:text');
  });
});
