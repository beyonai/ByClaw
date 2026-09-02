import { IMessageState, SSEMessageType } from '@/constants/message';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import { collectEasyConfirmItems, hasPendingEasyConfirmItem } from './easyConfirm';

const createItem = (
  uuid: string,
  contentType: SSEMessageType,
  content: IMessageListItem['content']
): IMessageListItem => ({
  uuid,
  contentType,
  content,
  status: '_DONE_',
  orginContent: '',
});

const createMessage = (overrides: Partial<IMessage> = {}): IMessage =>
  ({
    creatorId: 'assistant',
    fromBeyond: true,
    msgId: 'message-1',
    messageState: IMessageState.Answer,
    createTime: '',
    ...overrides,
  } as IMessage);

describe('easyConfirm message extraction', () => {
  it('extracts a pending interaction from thinking data without rendering its component', () => {
    const pendingItem = createItem('pending-1', SSEMessageType.thinkTaskUserInput, {
      substance: {
        formStatus: IFormStatus.INIT,
        pluginMachineFields: [],
      },
    });
    const message = createMessage({ thinkList: [pendingItem] });

    const descriptors = collectEasyConfirmItems(message, (nextMessage) => nextMessage);

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({
      message,
      messageIdx: 0,
      thinkListItem: pendingItem,
      messageListItemContent: pendingItem.content,
    });
    expect(hasPendingEasyConfirmItem(message, [pendingItem])).toBe(true);
  });

  it('updates the original thinking item through the extracted descriptor', () => {
    const pendingItem = createItem('pending-1', SSEMessageType.askUserQuestions, {
      substance: { questions: [] },
      formStatus: IFormStatus.INIT,
    });
    const message = createMessage({ thinkList: [pendingItem] });
    const updateMessage = jest.fn((nextMessage: IMessage) => nextMessage);
    const [descriptor] = collectEasyConfirmItems(message, updateMessage);
    const finishedContent = {
      ...pendingItem.content,
      formStatus: IFormStatus.FINISH,
    };

    const nextMessage = descriptor.updateMessageListItemContent(finishedContent);

    expect(nextMessage.thinkList?.[0].content).toEqual(finishedContent);
    expect(message.thinkList?.[0].content).toBe(pendingItem.content);
    expect(updateMessage).toHaveBeenCalledWith(nextMessage);
  });

  it('excludes completed and non-answer interactions', () => {
    const completedItem = createItem('completed-1', SSEMessageType.thinkTaskUserInput, {
      substance: {
        formStatus: IFormStatus.FINISH,
        pluginMachineFields: [],
      },
    });
    const completedMessage = createMessage({ thinkList: [completedItem] });
    const queryingMessage = createMessage({
      messageState: IMessageState.Query,
      thinkList: [
        createItem('pending-1', SSEMessageType.thinkRewriteQuestion, {
          substance: { paradigmList: [] },
        }),
      ],
    });

    expect(collectEasyConfirmItems(completedMessage, (nextMessage) => nextMessage)).toEqual([]);
    expect(collectEasyConfirmItems(queryingMessage, (nextMessage) => nextMessage)).toEqual([]);
  });

  it('collects pending interactions from both answer and thinking lists', () => {
    const thinkingItem = createItem('thinking-1', SSEMessageType.approvalForm, {
      substance: [{ confirmed: undefined }],
    });
    const answerItem = createItem('answer-1', SSEMessageType.askUserQuestions, {
      substance: { questions: [] },
      formStatus: IFormStatus.INIT,
    });
    const message = createMessage({ thinkList: [thinkingItem], messageList: [answerItem] });

    const descriptors = collectEasyConfirmItems(message, (nextMessage) => nextMessage);

    expect(descriptors.map((item) => item.thinkListItem?.uuid || item.messageListItem?.uuid)).toEqual([
      'thinking-1',
      'answer-1',
    ]);
  });

  it('keeps an approval pending after every step is confirmed but before the final submit', () => {
    const approvalItem = createItem('approval-1', SSEMessageType.approvalForm, {
      substance: [{ confirmed: true }, { confirmed: false }],
    });
    const message = createMessage({ messageList: [approvalItem] });

    expect(collectEasyConfirmItems(message, (nextMessage) => nextMessage)).toHaveLength(1);
  });

  it('preserves the cross-channel sequence used by the v2 message renderer', () => {
    const thinkingItem = {
      ...createItem('thinking-1', SSEMessageType.thinkTaskUserInput, {
        substance: { formStatus: IFormStatus.INIT, pluginMachineFields: [] },
      }),
      seq: 3,
    };
    const answerItem = {
      ...createItem('answer-1', SSEMessageType.askUserQuestions, {
        substance: { questions: [] },
        formStatus: IFormStatus.INIT,
      }),
      seq: 2,
    };
    const message = createMessage({ thinkList: [thinkingItem], messageList: [answerItem] });

    const descriptors = collectEasyConfirmItems(message, (nextMessage) => nextMessage);

    expect(descriptors.map((item) => item.thinkListItem?.uuid || item.messageListItem?.uuid)).toEqual([
      'answer-1',
      'thinking-1',
    ]);
  });
});
