import { act, render, screen } from '@testing-library/react';
import { IMessageState, SSEMessageType } from '@/constants/message';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import type { IMessage } from '@/typescript/message';
import { collectEasyConfirmItems } from '@/components/MessagesComp/easyConfirm';
import EasyConfirm from './index';

const mockEventListeners = new Map<string, (payload: unknown) => void>();

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({
    EventEmitter: {
      on: (event: string, listener: (payload: unknown) => void) => mockEventListeners.set(event, listener),
      off: (event: string) => mockEventListeners.delete(event),
    },
  }),
}));

jest.mock('@/components/QueryInput', () => ({
  __esModule: true,
  default: () => <div data-testid="query-input" />,
}));

jest.mock('@/components/MessageList/lazyHandler', () => ({
  __esModule: true,
  default: {
    lazyComp: () =>
      function EasyConfirmTestComponent(props: {
        thinkListItem?: { uuid?: string };
        messageListItem?: { uuid?: string };
        presentation?: string;
      }) {
        return (
          <div
            data-testid={`easy-confirm-${props.thinkListItem?.uuid || props.messageListItem?.uuid}`}
            data-presentation={props.presentation}
          />
        );
      },
  },
}));

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

jest.mock('antd', () => ({
  Pagination: () => null,
  theme: {
    useToken: () => ({ token: { boxShadowTertiary: '' } }),
  },
}));

const createPendingMessage = (): IMessage =>
  ({
    creatorId: 'assistant',
    fromBeyond: true,
    msgId: 'message-1',
    messageState: IMessageState.Answer,
    createTime: '',
    thinkList: [
      {
        uuid: 'pending-1',
        contentType: SSEMessageType.thinkTaskUserInput,
        content: {
          substance: {
            formStatus: IFormStatus.INIT,
            pluginMachineFields: [],
          },
        },
        status: '_DONE_',
        orginContent: '',
      },
    ],
  } as IMessage);

describe('EasyConfirm', () => {
  it('renders pending message data even when no component registration event was emitted', () => {
    const lastMsg = createPendingMessage();

    render(
      <EasyConfirm
        disabledInput={false}
        isBottom
        cannotAt={false}
        disableInputDraft
        queryInputProps={{}}
        lastMsg={lastMsg}
        sessionId="session-1"
        onSend={jest.fn()}
        onCancel={jest.fn()}
        myAgentType={1 as any}
        setMyAgentType={jest.fn()}
        messageState={IMessageState.Answer}
        updateMessage={(message) => message}
      />
    );

    expect(screen.getByTestId('easy-confirm-pending-1')).toHaveAttribute('data-presentation', 'dock');
    expect(screen.queryByTestId('query-input')).not.toBeInTheDocument();
  });

  it('keeps the canonical v2 sequence after compatibility events arrive out of order', () => {
    const lastMsg = createPendingMessage();
    lastMsg.thinkList![0].seq = 3;
    lastMsg.messageList = [
      {
        uuid: 'answer-1',
        contentType: SSEMessageType.askUserQuestions,
        content: {
          substance: { questions: [] },
          formStatus: IFormStatus.INIT,
        },
        status: '_DONE_',
        orginContent: '',
        seq: 2,
      },
    ];
    const updateMessage = (message: IMessage) => message;

    render(
      <EasyConfirm
        disabledInput={false}
        isBottom
        cannotAt={false}
        disableInputDraft
        queryInputProps={{}}
        lastMsg={lastMsg}
        sessionId="session-1"
        onSend={jest.fn()}
        onCancel={jest.fn()}
        myAgentType={1 as any}
        setMyAgentType={jest.fn()}
        messageState={IMessageState.Answer}
        updateMessage={updateMessage}
      />
    );

    const descriptors = collectEasyConfirmItems(lastMsg, updateMessage);
    act(() => {
      mockEventListeners.get('beyond-easyconfirm-set-approvalform-item')?.([...descriptors].reverse());
    });

    expect(screen.getByTestId('easy-confirm-answer-1')).toBeInTheDocument();
  });
});
