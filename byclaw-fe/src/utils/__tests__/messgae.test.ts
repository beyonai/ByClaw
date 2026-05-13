jest.mock('@/utils', () => ({
  getModelState: jest.fn(() => ({
    userInfo: {
      userId: 'u1',
      userName: 'Alice',
    },
  })),
}));

jest.mock('@/hooks/useSseSender/util', () => ({
  answerDeltaHandler: jest.fn((item: any) => ({
    message: item.mockMessage,
  })),
  reasoningLogHandler: jest.fn((item: any) => ({
    message: item.mockMessage,
  })),
}));

jest.mock('@/hooks/useChat/util', () => ({
  substanceHandler: jest.fn((message: any, last: any) => {
    if (last) {
      last.content.substance = `${last.content.substance}${message.content.substance}`;
      return undefined;
    }
    return message;
  }),
}));

import {
  checkAnswerMessageCanMemory,
  checkQueryMessageCanMemory,
  createMessage,
  fetchMessageHandler,
  getMessageText,
  getMsgId,
  initAnswerMessage,
  initQueryMessage,
  isTextContentType,
  multiChoicesHandler,
} from '../messgae';
import { IMessageState, ResourceFromType, SSEEventStatus, SSEMessageType } from '@/constants/message';
import { ResourceTypeMap } from '@/constants/resource';

describe('utils/messgae', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getMsgId uses crypto when available', () => {
    const getRandomValues = jest.fn((arr: Uint32Array) => {
      arr[0] = 123;
      return arr;
    });
    Object.defineProperty(window, 'crypto', {
      value: { getRandomValues },
      configurable: true,
    });

    expect(getMsgId()).toBe('123');
  });

  it('isTextContentType recognizes text and thinkText only', () => {
    expect(isTextContentType(SSEMessageType.text)).toBe(true);
    expect(isTextContentType(SSEMessageType.thinkText)).toBe(true);
    expect(isTextContentType(SSEMessageType.code)).toBe(false);
  });

  it('createMessage injects creator info and fallback msgId', () => {
    const message = createMessage({ text: 'hello', fromBeyond: false, messageState: IMessageState.Done } as any);
    expect(message.creatorId).toBe('u1');
    expect(message.creatorName).toBe('Alice');
    expect(message.msgId).toBeTruthy();
  });

  it('initQueryMessage and initAnswerMessage populate default message shapes', () => {
    expect(initQueryMessage({ text: 'hi', sessionId: 's1' })).toMatchObject({
      text: 'hi',
      fromBeyond: false,
      messageState: IMessageState.Done,
      sessionId: 's1',
    });

    expect(initAnswerMessage({ sessionId: 's1' })).toMatchObject({
      fromBeyond: true,
      messageState: IMessageState.Query,
      sessionId: 's1',
      messageList: [],
      thinkList: [],
      relatedQuestions: [],
    });
  });

  it('multiChoicesHandler selects neighbouring query/answer messages when available', () => {
    const list = [
      { msgId: 'q1', fromBeyond: false, messageState: IMessageState.Done },
      { msgId: 'a1', fromBeyond: true, messageState: IMessageState.Done },
      { msgId: 'q2', fromBeyond: false, messageState: IMessageState.Done },
    ] as any;

    expect(multiChoicesHandler(list[1], 1, list)).toEqual(['q1', 'a1']);
    expect(multiChoicesHandler(list[0], 0, list)).toEqual(['q1', 'a1']);
  });

  it('fetchMessageHandler converts user messages and parses resComIds', () => {
    const message = fetchMessageHandler({
      creatorId: 'u1',
      creatorName: 'Alice',
      usage: '1',
      messageId: 'm1',
      messageContent: JSON.stringify({ text: 'hello' }),
      resComIds: JSON.stringify([{ resComId: 'r1' }]),
      createTime: '100',
      sessionId: 's1',
    });

    expect(message).toMatchObject({
      fromBeyond: false,
      text: 'hello',
      msgId: 'm1',
      messageId: 'm1',
      sessionId: 's1',
      resComIds: [{ resComId: 'r1' }],
    });
  });

  it('fetchMessageHandler converts answer messages, inferLog, messageStruct and relatedResources', () => {
    const inferLog = JSON.stringify([
      {
        mockMessage: {
          contentType: SSEMessageType.thinkText,
          content: { substance: 'thought-1' },
        },
      },
      {
        mockMessage: {
          contentType: SSEMessageType.code,
          content: { substance: 'code-block' },
        },
      },
    ]);

    const messageStruct = JSON.stringify([
      {
        mockMessage: {
          contentType: SSEMessageType.text,
          content: { substance: 'hello' },
        },
      },
      {
        mockMessage: {
          contentType: SSEMessageType.code,
          content: { substance: 'print(1)' },
        },
      },
    ]);

    const relatedResources = JSON.stringify({
      resources: [{ id: 'kb1', type: ResourceFromType.DATASET }],
      resourceList: [{ resourceType: ResourceTypeMap.digitalEmployee }],
      files: [
        { fileId: '1', fileType: 'image', fileUrl: '/a.png', fileSize: 10, downloadUrl: '/d1' },
        { fileId: '2', fileType: 'file', fileUrl: '/a.txt', fileSize: 11, downloadUrl: '/d2' },
      ],
      extParams: { foo: 'bar' },
    });

    const message = fetchMessageHandler({
      creatorId: 'u2',
      creatorName: 'Bot',
      usage: '2',
      messageId: 'm2',
      messageStruct,
      inferLog,
      metadata: '{"agentId":"a1"}',
      relatedResources,
      createTime: '101',
      sessionId: 's1',
    });

    expect(message.fromBeyond).toBe(true);
    expect(message.thinkDone).toBe(true);
    expect(message.thinkList).toHaveLength(2);
    expect(message.messageList).toHaveLength(2);
    expect(message.resourceFrom).toEqual([{ id: 'kb1', type: ResourceFromType.DATASET }]);
    expect(message.resourceList).toEqual([{ resourceType: ResourceTypeMap.digitalEmployee }]);
    expect(message.imageList).toHaveLength(1);
    expect(message.fileList).toHaveLength(1);
    expect(message.extParams).toEqual({ foo: 'bar' });
  });

  it('getMessageText prefers text field and falls back to messageList text content', () => {
    expect(getMessageText({ text: 'hello', messageList: [] } as any)).toBe('hello');
    expect(
      getMessageText({
        messageList: [
          { contentType: SSEMessageType.code, content: { substance: 'ignore' } },
          { contentType: SSEMessageType.text, content: { substance: 'world' } },
        ],
      } as any)
    ).toBe('world');
  });

  it('checkQueryMessageCanMemory and checkAnswerMessageCanMemory enforce single agent rules', () => {
    expect(
      checkQueryMessageCanMemory({
        fromBeyond: false,
        resourceList: [{ resourceType: ResourceTypeMap.digitalEmployee }],
      } as any)
    ).toBe(true);

    expect(
      checkQueryMessageCanMemory({
        fromBeyond: false,
        metadata: JSON.stringify({ agentId: 'a1,a2' }),
      } as any)
    ).toBe(false);

    expect(
      checkAnswerMessageCanMemory({
        fromBeyond: true,
        metadata: JSON.stringify({ agentId: 'a1' }),
      } as any)
    ).toBe(true);
  });
});
