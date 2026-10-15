import { act, fireEvent, render, screen } from '@testing-library/react';
import type { IMessage } from '@/typescript/message';
import { IMessageState, SSEMessageType } from '@/constants/message';
import { EventEmitter$Cls } from '@/utils/eventEmitter';
import ChatLayoutComp from '../index';

let mockMessages: IMessage[] = [];
const mockOpenVnc = jest.fn();
const mockDispatch = jest.fn();
let mockEventEmitter = new EventEmitter$Cls();
const mockSetDetailPanel = jest.fn();
const mockClearDetailPanel = jest.fn();
const mockGlobal = {
  EventEmitter: mockEventEmitter,
  sessionId: 'session-1',
  platform: 'pc',
  setAgentId: jest.fn(),
  setSessionId: jest.fn(),
};
const mockAppStore = {
  sandboxesInfo: [] as unknown[],
  getSandboxesInfoUrl: jest.fn(),
  setSiderCollapsed: jest.fn(),
  isSiderCollapsed: false,
};
const mockState = {
  employees: { agentList: [], employeesList: [] },
  session: {
    sessionList: [
      { sessionId: 'session-1', sessionName: '当前会话' },
      { sessionId: 'session-2', sessionName: '另一个会话' },
    ],
  },
  user: { userInfo: null },
};

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: any) => any) => selector(mockState),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
jest.mock('@/hooks/useGlobal', () => () => mockGlobal);
jest.mock('@/models/common/useAppStore', () => () => mockAppStore);
jest.mock('@/hooks/useVncOpener', () => () => mockOpenVnc);
jest.mock('@/layout/components/provider/global', () => ({ Platform: { pc: 'pc' } }));
jest.mock('@/layout/sider/siderContentContext', () => ({
  SiderContentContext: require('react').createContext({
    setDetailPanel: (...args: unknown[]) => mockSetDetailPanel(...args),
    clearDetailPanel: (...args: unknown[]) => mockClearDetailPanel(...args),
  }),
}));
jest.mock('@/hooks/useChat', () => () => ({
  messageList: mockMessages,
  getMessageList: () => mockMessages,
  setMessageList: jest.fn(),
  updateMessage: jest.fn(),
  deleteMessage: jest.fn(),
  cancelCurrentSession: jest.fn(),
  retrySessionMessageLoad: jest.fn(),
}));
jest.mock('../hooks/useEventEmitterHooks', () => () => ({
  multiChoicesList: [],
  setMultiChoicesList: jest.fn(),
}));
jest.mock('../ChatResourceWorkspace/useChatResourceProject', () => ({ useChatResourceProject: () => ({}) }));
jest.mock('@/utils', () => ({ isRootPage: () => false }));
jest.mock('@/utils/auth', () => ({ isAdminVip: () => false }));
jest.mock('@/utils/session', () => ({
  isNotificationSession: () => false,
  sessionHandler: (session: unknown) => session,
}));
jest.mock('@/utils/scopedSession', () => ({ isExternalChildSession: () => false }));
jest.mock('@/components/MessageList/utils', () => ({
  getResponseAgentInfo: jest.fn(),
  isMultiAgentResponsePayload: () => false,
}));
jest.mock('@/components/MessageList', () => ({
  __esModule: true,
  default: require('react').forwardRef(() => null),
}));
jest.mock('@/components/ReferenceSource', () => () => null);
jest.mock('../components/ForwardMessages', () => () => null);
jest.mock('../components/MultiChoices', () => () => null);
jest.mock('../components/EasyConfirm', () => () => null);
jest.mock('../ChatResourceWorkspace', () => () => null);
jest.mock('@/components/TaskTemplateModal/TaskTemplateEntry', () => () => null);
jest.mock('@/pages/workSpace/Achievements', () => ({ Trigger: require('react').forwardRef(() => null) }));
jest.mock('@/components/ChatAvatar', () => () => null);
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('../components/CreateTemplate', () => () => null);
jest.mock('@/components/NullableAntdCompWithAnim', () => () => null);
jest.mock('../ProjectSessionActions', () => () => null);
jest.mock('../ChildSessionNavigator', () => () => null);
jest.mock('../AgentTeamsHeaderActivity', () => () => null);

const employeeMessage = (msgId: string, browser = false, sessionId = 'session-1'): IMessage => {
  const browserMessage = {
    uuid: `${msgId}-browser`,
    contentType: SSEMessageType.toolCall,
    content: { substance: { title: 'browser_navigate', input: { url: 'https://example.com' } } },
    orginContent: '',
    status: '_DONE_' as any,
  };
  return {
    msgId,
    sessionId,
    creatorId: 'employee',
    fromBeyond: true,
    usage: '2',
    createTime: '2026-10-15T00:00:00Z',
    messageState: IMessageState.Done,
    isHistoryMsg: true,
    messageList: browser ? [browserMessage] : [],
  };
};

const renderChat = (sessionId = 'session-1') => <ChatLayoutComp sessionId={sessionId} isBottom readOnly />;

describe('chat remote computer entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventEmitter = new EventEmitter$Cls();
    jest.spyOn(mockEventEmitter, 'emit');
    mockGlobal.EventEmitter = mockEventEmitter;
    mockMessages = [];
    mockAppStore.sandboxesInfo = [];
  });

  it('restores the latest employee browser entry from history without opening it', () => {
    mockMessages = [employeeMessage('answer-1', true)];

    render(renderChat());

    expect(screen.getByTitle('common.remoteComputer')).toBeInTheDocument();
    expect(mockOpenVnc).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('hides an older browser entry when the latest employee message has no browser activity', () => {
    mockMessages = [employeeMessage('answer-1', true), employeeMessage('answer-2')];

    render(renderChat());

    expect(screen.queryByTitle('common.remoteComputer')).not.toBeInTheDocument();
  });

  it('keeps the latest employee entry when a user message is last in the list', () => {
    mockMessages = [
      employeeMessage('answer-1', true),
      { ...employeeMessage('query-2'), creatorId: 'user', fromBeyond: false, usage: '1' },
    ];

    render(renderChat());

    expect(screen.getByTitle('common.remoteComputer')).toBeInTheDocument();
  });

  it('does not restore browser activity from another conversation', () => {
    mockMessages = [employeeMessage('answer-1'), employeeMessage('answer-other', true, 'session-2')];

    render(renderChat());

    expect(screen.queryByTitle('common.remoteComputer')).not.toBeInTheDocument();
  });

  it('does not expose a stale browser entry when another drawer opens', () => {
    mockMessages = [employeeMessage('answer-1', true), employeeMessage('answer-2')];
    mockAppStore.sandboxesInfo = [{ status: 'RUNNING', instanceEndpoints: { vnc: 'https://example.com/vnc' } }];
    render(renderChat());

    act(() => mockEventEmitter.emit('beyond-main-driver-open-type', { drawerType: 'vnc' }));

    expect(screen.queryByTitle('common.remoteComputer')).not.toBeInTheDocument();
  });

  it('updates the entry when messages change without remounting the chat', () => {
    mockMessages = [employeeMessage('answer-1', true)];
    const view = render(renderChat());
    expect(screen.getByTitle('common.remoteComputer')).toBeInTheDocument();

    mockMessages = [...mockMessages, employeeMessage('answer-2')];
    view.rerender(renderChat());
    expect(screen.queryByTitle('common.remoteComputer')).not.toBeInTheDocument();

    mockMessages = [...mockMessages, employeeMessage('answer-3', true)];
    view.rerender(renderChat());
    expect(screen.getByTitle('common.remoteComputer')).toBeInTheDocument();
    expect(mockOpenVnc).not.toHaveBeenCalled();
  });

  it('keeps an opened desktop entry across new answers and permits reopening during another answer', () => {
    mockMessages = [employeeMessage('answer-1', true)];
    const view = render(renderChat());
    act(() => mockEventEmitter.emit('beyond-chat-vnc-opened', { sessionId: 'session-1' }));

    mockMessages = [...mockMessages, employeeMessage('answer-2')];
    view.rerender(renderChat());
    act(() => mockEventEmitter.emit('beyond-driver-close'));
    fireEvent.click(screen.getByTitle('common.remoteComputer'));
    const options = mockOpenVnc.mock.calls[0][0];

    mockMessages = [...mockMessages, employeeMessage('answer-3')];
    view.rerender(renderChat());
    expect(screen.getByTitle('common.remoteComputer')).toBeInTheDocument();
    expect(options.isCurrent()).toBe(true);
  });

  it('resets an opened desktop entry on A to B to A navigation', () => {
    mockMessages = [employeeMessage('answer-1')];
    const view = render(renderChat());
    act(() => mockEventEmitter.emit('beyond-chat-vnc-opened', { sessionId: 'session-1' }));
    expect(screen.getByTitle('common.remoteComputer')).toBeInTheDocument();

    mockMessages = [employeeMessage('answer-2', false, 'session-2')];
    view.rerender(renderChat('session-2'));
    expect(screen.queryByTitle('common.remoteComputer')).not.toBeInTheDocument();
    act(() => mockEventEmitter.emit('beyond-chat-vnc-opened', { sessionId: 'session-1' }));
    expect(screen.queryByTitle('common.remoteComputer')).not.toBeInTheDocument();

    mockMessages = [employeeMessage('answer-1')];
    view.rerender(renderChat());
    expect(screen.queryByTitle('common.remoteComputer')).not.toBeInTheDocument();
  });

  it('keeps pending opening during updates to the same answer and cancels it for a new answer', () => {
    mockMessages = [employeeMessage('answer-1', true)];
    const view = render(renderChat());

    fireEvent.click(screen.getByTitle('common.remoteComputer'));
    expect(mockOpenVnc).toHaveBeenCalledTimes(1);
    const options = mockOpenVnc.mock.calls[0][0];
    expect(options.isCurrent()).toBe(true);

    mockMessages = [{ ...mockMessages[0], updateKey: 'stream-update' }];
    view.rerender(renderChat());
    expect(options.isCurrent()).toBe(true);

    mockMessages = [...mockMessages, employeeMessage('answer-2', true)];
    view.rerender(renderChat());
    expect(options.isCurrent()).toBe(false);
  });
});
