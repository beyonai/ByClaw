import { fireEvent, render, screen } from '@testing-library/react';
import { IMessageState, SSEEventStatus, SSEMessageType } from '@/constants/message';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import ThinkRewriteQuestion from './index';

const mockEmit = jest.fn();

jest.mock('@/components/MessagesComp/withEasyConfirm', () => ({
  __esModule: true,
  default: (Component: React.ComponentType<any>) => Component,
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({
    EventEmitter: { emit: mockEmit },
    layoutMode: undefined,
  }),
}));

jest.mock('@/hooks/useCountDown', () => ({
  __esModule: true,
  default: () => ({
    remainingTime: 0,
    isRunning: false,
    start: jest.fn(),
    reset: jest.fn(),
  }),
}));

jest.mock('@umijs/max', () => ({
  getLocale: () => 'zh-CN',
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

const createMessage = (itemCount = 1) => {
  const items: IMessageListItem[] = Array.from({ length: itemCount }, (_, index) => ({
    uuid: `rewrite-${index + 1}`,
    contentType: SSEMessageType.thinkRewriteQuestion,
    status: SSEEventStatus.done,
    orginContent: '',
    content: {
      metadata: '{}',
      substance: {
        query: `原问题 ${index + 1}`,
        paradigmList: [],
      },
    },
  }));
  const message = {
    creatorId: 'assistant',
    fromBeyond: true,
    msgId: 'message-1',
    messageId: 'message-1',
    messageState: IMessageState.Answer,
    createTime: '',
    thinkList: items,
  } as IMessage;
  return { items, message };
};

describe('ThinkRewriteQuestion', () => {
  beforeEach(() => {
    mockEmit.mockClear();
  });

  it('writes a completed form status back to the message before resuming', () => {
    const { items, message } = createMessage();
    const item = items[0];
    const updateMessageListItemContent = jest.fn();

    render(
      <ThinkRewriteQuestion
        message={message}
        messageIdx={0}
        thinkListItem={item}
        messageListItemContent={item.content as any}
        updateMessageListItemContent={updateMessageListItemContent}
      />
    );

    fireEvent.click(screen.getByText('common.confirm'));

    expect(updateMessageListItemContent).toHaveBeenCalledWith({
      ...item.content,
      formStatus: IFormStatus.FINISH,
    });
  });

  it('marks every rewrite item completed when the final question submits', () => {
    const { items, message } = createMessage(2);
    const currentItem = items[1];

    render(
      <ThinkRewriteQuestion
        message={message}
        messageIdx={1}
        thinkListItem={currentItem}
        messageListItemContent={currentItem.content as any}
        updateMessageListItemContent={jest.fn()}
      />
    );

    fireEvent.click(screen.getByText('common.confirm'));

    const updateCall = mockEmit.mock.calls.find(([event]) => event === 'beyond-update-message');
    expect(updateCall?.[1].message.thinkList).toEqual(
      items.map((item) => ({
        ...item,
        content: {
          ...item.content,
          formStatus: IFormStatus.FINISH,
        },
      }))
    );
  });

  it('does not show a submit button after another component instance completes the form', () => {
    const { items, message } = createMessage();
    const item = items[0];

    render(
      <ThinkRewriteQuestion
        message={message}
        messageIdx={0}
        thinkListItem={item}
        messageListItemContent={{ ...item.content, formStatus: IFormStatus.FINISH } as any}
        updateMessageListItemContent={jest.fn()}
      />
    );

    expect(screen.queryByText('common.confirm')).not.toBeInTheDocument();
  });
});
