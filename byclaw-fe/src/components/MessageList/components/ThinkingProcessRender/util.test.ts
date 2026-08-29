import { IMessageState, SSEEventStatus, SSEMessageType } from '@/constants/message';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';

import type { IMessage, IMessageListItem } from '@/typescript/message';

import { transformList } from './util';

describe('ThinkingProcessRender transformList', () => {
  it('keeps a status title expanded until an update with the same orderId reaches a terminal status', () => {
    const statusTitle: IMessageListItem = {
      contentType: SSEMessageType.thinkStatusTitle,
      status: SSEEventStatus.start,
      objectType: 'tool_call',
      content: {
        substance: { title: '数字员工正在处理', status: '_START_' },
        orderId: 'delegation-1',
        parentOrderId: '-1',
      },
    };
    const child: IMessageListItem = {
      contentType: SSEMessageType.thinkText,
      status: SSEEventStatus.query,
      content: {
        substance: '数字员工已就绪',
        orderId: 'delegation-1:progress',
        parentOrderId: 'delegation-1',
      },
    };

    const runningResult = transformList([statusTitle, child], false);

    expect(runningResult[0].isCollapsed).toBe(false);
    expect(runningResult[0].children?.[0].content.orderId).toBe('delegation-1:progress');
    expect(transformList([statusTitle, child], true)[0].isCollapsed).toBe(false);

    const completedStatusTitle: IMessageListItem = {
      ...statusTitle,
      status: SSEEventStatus.done,
      content: {
        ...statusTitle.content,
        substance: { title: '数字员工处理完成', status: '_DONE_' },
      },
    };
    const completedResult = transformList([statusTitle, child, completedStatusTitle], false);

    expect(completedResult[0].isCollapsed).toBe(true);
    expect(completedResult[0].content.substance).toEqual({ title: '数字员工处理完成', status: '_DONE_' });
    expect(completedResult[0].children?.[0].content.orderId).toBe('delegation-1:progress');
  });

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

  it('keeps every ancestor expanded when a nested EasyConfirm item is pending', () => {
    const thinkList: IMessageListItem[] = [
      {
        uuid: 'root',
        contentType: SSEMessageType.thinkRootTitle,
        status: SSEEventStatus.done,
        orginContent: '',
        content: {
          substance: 'Root',
          orderId: 'root-1',
        },
      },
      {
        uuid: 'title',
        contentType: SSEMessageType.thinkTitle,
        status: SSEEventStatus.done,
        orginContent: '',
        content: {
          substance: 'Section',
          orderId: 'title-1',
          parentOrderId: 'root-1',
        },
      },
      {
        uuid: 'pending',
        contentType: SSEMessageType.askUserQuestions,
        status: SSEEventStatus.done,
        orginContent: '',
        content: {
          formStatus: IFormStatus.INIT,
          substance: { questions: [] },
          orderId: 'pending-1',
          parentOrderId: 'title-1',
        },
      },
    ];
    const message = {
      creatorId: 'assistant',
      fromBeyond: true,
      msgId: 'message-1',
      messageId: 'message-1',
      messageState: IMessageState.Answer,
      createTime: '',
      thinkList,
    } as IMessage;

    const result = transformList(thinkList, true, message.messageId, message);
    const titleNode = result[0].children?.[0];

    expect(result[0]).toMatchObject({ isCollapsed: false, shouldOpen: true });
    expect(titleNode).toMatchObject({ isCollapsed: false, shouldOpen: true });
  });
});
