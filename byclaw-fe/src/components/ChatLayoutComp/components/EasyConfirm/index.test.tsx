import { act, render, screen } from '@testing-library/react';
import { IMessageState, SSEMessageType } from '@/constants/message';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import type { IMessage } from '@/typescript/message';
import { collectEasyConfirmItems } from '@/components/MessagesComp/easyConfirm';
import EasyConfirm, { clearEasyConfirmInputDraft } from './index';
import type { DefaultValueSchema } from '@/components/QueryInput/RichInput/types';
import { ResourceType } from '@/components/QueryInput/RichInput/utils/constants';
import {
  clearAutomationCreationDraft,
  getAutomationCreationDraft,
  saveAutomationCreationDraft,
} from '@/pages/automation/drafts';
import { getAutomationFormInitialValues } from '@/pages/automation/schedule';

const mockEventListeners = new Map<string, (payload: unknown) => void>();
const mockMessageInfo = jest.fn();
let mockQueryInputProps: {
  inputDraft?: DefaultValueSchema;
  onInputDraftChange: (draft: DefaultValueSchema) => void;
  onSend: (payload: any) => void;
  onFileUploadSessionCreated: (sessionId: string) => void;
};

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
  default: (props: typeof mockQueryInputProps) => {
    mockQueryInputProps = props;
    return <div data-testid="query-input" />;
  },
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
  message: {
    info: (...args: unknown[]) => mockMessageInfo(...args),
  },
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
  beforeEach(() => {
    clearEasyConfirmInputDraft();
    mockEventListeners.clear();
    mockMessageInfo.mockClear();
  });

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

  it('sends one browser notification when a new pending interaction arrives', () => {
    const notifications: Array<{
      title: string;
      options?: NotificationOptions;
      onclick: (() => void) | null;
      close: jest.Mock;
    }> = [];
    class NotificationMock {
      static permission: NotificationPermission = 'granted';
      static requestPermission = jest.fn();

      onclick: (() => void) | null = null;
      close = jest.fn();

      constructor(public title: string, public options?: NotificationOptions) {
        notifications.push(this);
      }
    }
    const originalNotification = window.Notification;
    Object.defineProperty(window, 'Notification', { configurable: true, value: NotificationMock });
    const focusSpy = jest.spyOn(window, 'focus').mockImplementation(() => undefined);

    const emptyMessage = {
      ...createPendingMessage(),
      thinkList: [],
    };
    const props = {
      disabledInput: false,
      isBottom: true,
      cannotAt: false,
      disableInputDraft: true,
      queryInputProps: {},
      sessionId: 'session-1',
      onSend: jest.fn(),
      onCancel: jest.fn(),
      myAgentType: 1 as any,
      setMyAgentType: jest.fn(),
      messageState: IMessageState.Answer,
      updateMessage: (message: IMessage) => message,
    };
    const { rerender } = render(<EasyConfirm {...props} lastMsg={emptyMessage} />);

    rerender(<EasyConfirm {...props} lastMsg={createPendingMessage()} />);
    rerender(<EasyConfirm {...props} lastMsg={createPendingMessage()} />);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('easyConfirm.notification.title');
    expect(notifications[0].options).toMatchObject({
      body: 'easyConfirm.notification.body',
      tag: 'easy-confirm-session-1-pending-1',
    });

    notifications[0].onclick?.();
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(notifications[0].close).toHaveBeenCalledTimes(1);

    focusSpy.mockRestore();
    Object.defineProperty(window, 'Notification', { configurable: true, value: originalNotification });
  });
});

describe('session chat drafts', () => {
  const props = {
    disabledInput: false,
    isBottom: true,
    cannotAt: false,
    disableInputDraft: false,
    queryInputProps: {},
    sessionId: 'session-1',
    onSend: jest.fn(),
    onCancel: jest.fn(),
    myAgentType: 1 as any,
    setMyAgentType: jest.fn(),
    updateMessage: (message: IMessage) => message,
  };
  const draft: DefaultValueSchema = {
    text: '{{DIGITAL_EMPLOYEE_agent-1}} Compare {{DATA_SOURCE_17}} with this input',
    resourceList: [
      {
        id: 'DIGITAL_EMPLOYEE_agent-1',
        resourceType: ResourceType.digitalEmployee,
        resourceId: 'agent-1',
        resourceName: 'Employee One',
      },
      { id: 'DATA_SOURCE_17', resourceType: ResourceType.dataSource, resourceId: '17', resourceName: 'Analytics' },
    ],
  };

  beforeEach(() => {
    clearEasyConfirmInputDraft();
    jest.clearAllMocks();
  });

  it('restores text, employees and references only in their original session, including remounts', () => {
    const view = render(<EasyConfirm {...props} />);
    act(() => mockQueryInputProps.onInputDraftChange(draft));
    view.rerender(<EasyConfirm {...props} sessionId="session-2" />);
    expect(mockQueryInputProps.inputDraft).toBeUndefined();
    const secondDraft = { text: 'Second session input', resourceList: [] };
    act(() => mockQueryInputProps.onInputDraftChange(secondDraft));
    view.rerender(<EasyConfirm {...props} sessionId="" />);
    expect(mockQueryInputProps.inputDraft).toBeUndefined();
    act(() => mockQueryInputProps.onInputDraftChange({ text: 'New session input' }));
    view.rerender(<EasyConfirm {...props} />);
    expect(mockQueryInputProps.inputDraft).toEqual(draft);
    view.rerender(<EasyConfirm {...props} sessionId="session-2" />);
    expect(mockQueryInputProps.inputDraft).toEqual(secondDraft);
    view.unmount();
    const remounted = render(<EasyConfirm {...props} />);
    expect(mockQueryInputProps.inputDraft).toEqual(draft);
    remounted.rerender(<EasyConfirm {...props} sessionId="" />);
    expect(mockQueryInputProps.inputDraft?.text).toBe('New session input');
  });

  it('clears only the active session draft and keeps late callbacks scoped to their source', () => {
    const view = render(<EasyConfirm {...props} />);
    const updateFirstDraft = mockQueryInputProps.onInputDraftChange;
    act(() => updateFirstDraft(draft));
    view.rerender(<EasyConfirm {...props} sessionId="session-2" />);
    act(() => {
      mockQueryInputProps.onInputDraftChange({ text: 'Second session input' });
      updateFirstDraft({ ...draft, text: `${draft.text} latest` });
    });
    act(() => mockQueryInputProps.onInputDraftChange({ text: '', resourceList: [] }));
    view.rerender(<EasyConfirm {...props} />);
    expect(mockQueryInputProps.inputDraft?.text).toBe(`${draft.text} latest`);
    view.rerender(<EasyConfirm {...props} sessionId="session-2" />);
    expect(mockQueryInputProps.inputDraft).toBeUndefined();
  });

  it('clears sent content only in the sending session and retains its employees there', () => {
    const view = render(<EasyConfirm {...props} sessionId="session-2" />);
    act(() => mockQueryInputProps.onInputDraftChange({ text: 'Other unsent input' }));
    view.rerender(<EasyConfirm {...props} />);
    act(() => mockQueryInputProps.onInputDraftChange(draft));
    act(() => mockQueryInputProps.onSend({ queryQuestion: 'sent' }));
    view.rerender(<EasyConfirm {...props} />);
    expect(mockQueryInputProps.inputDraft).toBeUndefined();
    const retained = { text: '{{DIGITAL_EMPLOYEE_agent-1}}', resourceList: [draft.resourceList![0]] };
    act(() => mockQueryInputProps.onInputDraftChange(retained));
    view.rerender(<EasyConfirm {...props} sessionId="session-2" />);
    expect(mockQueryInputProps.inputDraft?.text).toBe('Other unsent input');
    view.rerender(<EasyConfirm {...props} sessionId="" />);
    expect(mockQueryInputProps.inputDraft).toBeUndefined();
    view.rerender(<EasyConfirm {...props} />);
    expect(mockQueryInputProps.inputDraft).toEqual(retained);
    expect(props.onSend).toHaveBeenCalledWith({ queryQuestion: 'sent' });
  });

  it('moves a new draft to its assigned session without remounting the uploading input', () => {
    const view = render(<EasyConfirm {...props} sessionId="" preserveInputOnSessionChange />);
    const originalInput = screen.getByTestId('query-input');
    act(() => {
      mockQueryInputProps.onInputDraftChange(draft);
      mockQueryInputProps.onFileUploadSessionCreated(props.sessionId);
    });
    view.rerender(<EasyConfirm {...props} preserveInputOnSessionChange />);
    expect(mockQueryInputProps.inputDraft).toEqual(draft);
    expect(screen.getByTestId('query-input')).toBe(originalInput);
    view.rerender(<EasyConfirm {...props} sessionId="" preserveInputOnSessionChange />);
    expect(mockQueryInputProps.inputDraft).toBeUndefined();
    expect(screen.getByTestId('query-input')).not.toBe(originalInput);
    view.rerender(<EasyConfirm {...props} />);
    expect(mockQueryInputProps.inputDraft).toEqual(draft);
  });

  it('does not transfer a new draft when navigating to an existing session', () => {
    const view = render(<EasyConfirm {...props} sessionId="" preserveInputOnSessionChange />);
    const originalInput = screen.getByTestId('query-input');
    act(() => mockQueryInputProps.onInputDraftChange(draft));
    view.rerender(<EasyConfirm {...props} preserveInputOnSessionChange />);
    expect(mockQueryInputProps.inputDraft).toBeUndefined();
    expect(screen.getByTestId('query-input')).not.toBe(originalInput);
    view.rerender(<EasyConfirm {...props} sessionId="" preserveInputOnSessionChange />);
    expect(mockQueryInputProps.inputDraft).toEqual(draft);
  });

  it('remounts when switching existing sessions even if preservation is enabled', () => {
    const view = render(<EasyConfirm {...props} preserveInputOnSessionChange />);
    const originalInput = screen.getByTestId('query-input');
    act(() => mockQueryInputProps.onInputDraftChange(draft));
    view.rerender(<EasyConfirm {...props} sessionId="session-2" preserveInputOnSessionChange />);
    expect(mockQueryInputProps.inputDraft).toBeUndefined();
    expect(screen.getByTestId('query-input')).not.toBe(originalInput);
    view.rerender(<EasyConfirm {...props} preserveInputOnSessionChange />);
    expect(mockQueryInputProps.inputDraft).toEqual(draft);
  });

  it('keeps a new scheduled task draft separate from a new ordinary task', () => {
    const automationDraft = { prompt: draft, values: getAutomationFormInitialValues() };
    saveAutomationCreationDraft(automationDraft);
    const view = render(<EasyConfirm {...props} sessionId="" />);
    expect(mockQueryInputProps.inputDraft).toBeUndefined();
    act(() => mockQueryInputProps.onInputDraftChange({ text: 'Ordinary task' }));
    view.unmount();
    render(<EasyConfirm {...props} sessionId="" />);
    expect(mockQueryInputProps.inputDraft?.text).toBe('Ordinary task');
    expect(getAutomationCreationDraft()).toEqual(automationDraft);
    act(() => mockQueryInputProps.onSend({ queryQuestion: 'Ordinary task' }));
    expect(getAutomationCreationDraft()).toEqual(automationDraft);
    clearAutomationCreationDraft();
  });

  it('isolates fixed employee pages from session drafts even when sending', () => {
    const view = render(<EasyConfirm {...props} />);
    act(() => mockQueryInputProps.onInputDraftChange(draft));
    view.rerender(<EasyConfirm {...props} disableInputDraft sessionId="employee-session" />);
    expect(mockQueryInputProps.inputDraft).toBeUndefined();
    act(() => {
      mockQueryInputProps.onInputDraftChange({ text: 'Private input' });
      mockQueryInputProps.onSend({ queryQuestion: 'Private input' });
    });
    view.rerender(<EasyConfirm {...props} />);
    expect(mockQueryInputProps.inputDraft).toEqual(draft);
  });
});
