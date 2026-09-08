import { IMessageState, SSEEventStatus, SSEMessageType } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import { createMessage } from '@/utils/messgae';

const createTime = (value: string) => {
  const timestamp = Date.parse(value);
  return `${Number.isFinite(timestamp) ? timestamp : 0}`;
};

const historyItem = (
  messageId: string,
  block: IDesktopLocalHistoryBlock,
  contentType: SSEMessageType,
  substance: unknown,
  eventType: string
): IMessageListItem => ({
  content: { substance },
  contentType,
  status: SSEEventStatus.done,
  uuid: `${messageId}:${block.seq}`,
  orginContent: typeof substance === 'string' ? substance : JSON.stringify(substance),
  seq: block.seq,
  eventType,
});

/** Convert the stable Desktop protocol into the existing v2 message renderer. */
export const projectLocalHistoryPage = (page: IDesktopLocalHistoryPage, sessionId: string): IMessage[] => {
  let latestQueryId: string | undefined;
  return page.list.map((message) => {
    if (message.role === 'user') {
      latestQueryId = message.id;
      return createMessage({
        msgId: message.id,
        messageId: message.id,
        sessionId,
        createTime: createTime(message.createdAt),
        text: message.text || '',
        fromBeyond: false,
        messageState: IMessageState.Done,
        isHistoryMsg: true,
      });
    }

    const thinkList: IMessageListItem[] = [];
    const messageList: IMessageListItem[] = [];
    (message.blocks || []).forEach((block) => {
      if (block.type === 'reasoning') {
        thinkList.push(historyItem(message.id, block, SSEMessageType.thinkText, block.text, 'reasoningLogDelta'));
        return;
      }
      if (block.type === 'tool') {
        const substance = {
          title: block.name,
          input: block.input,
          output: block.output,
          status: block.status === 'done' ? SSEEventStatus.done : '_ERROR_',
          ...(block.truncated ? { description: '内容已截断' } : {}),
        };
        thinkList.push(historyItem(message.id, block, SSEMessageType.toolCall, substance, 'toolCall'));
        return;
      }
      messageList.push(historyItem(message.id, block, SSEMessageType.text, block.text, 'answerDelta'));
    });
    return createMessage({
      msgId: message.id,
      messageId: message.id,
      queryMsgId: message.queryId || latestQueryId,
      sessionId,
      createTime: createTime(message.createdAt),
      fromBeyond: true,
      messageState: IMessageState.Done,
      metadata: JSON.stringify({ messageRenderVersion: 'v2' }),
      messageList,
      thinkList,
      thinkDone: true,
      isHistoryMsg: true,
    });
  });
};
