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
  sandboxesInfo: [{ sandboxId: 'sandbox', status: 'RUNNING', instanceEndpoints: { vnc: '/proxy/8081' } }],
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
      { sessionId: '11273519', sessionName: '上传会话' },
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
jest.mock('@/models/common/useAppStore', () => Object.assign(() => mockAppStore, { getState: () => mockAppStore }));
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
jest.mock('@/utils/auth', () => ({
  isAdminVip: () => false,
  getDesktopIdentitySnapshot: () => ({ account: 'user', enterpriseId: 'tenant' }),
  getAuthSnapshot: () => ({ sessionId: 'auth', token: '', ssoToken: '' }),
}));
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
    mockAppStore.getSandboxesInfoUrl.mockResolvedValue(mockAppStore.sandboxesInfo);
    sessionStorage.clear();
    mockEventEmitter = new EventEmitter$Cls();
    mockGlobal.EventEmitter = mockEventEmitter;
    mockGlobal.platform = 'pc';
    mockMessages = [];
  });
  it('hides the entry when there is no employee answer', () => {
    render(renderChat());
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
  });
  it.each(['', '11273519'])('hides the title and desktop entry in welcome mode with session ID "%s"', (sessionId) => {
    render(<ChatLayoutComp sessionId={sessionId} isBottom={false} preserveNewSessionView readOnly />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
    expect(mockOpenVnc).not.toHaveBeenCalled();
  });
  it('shows the draft title without a desktop entry and hides the title in welcome mode', () => {
    const view = render(<ChatLayoutComp sessionId="" isBottom={false} readOnly />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    view.rerender(<ChatLayoutComp sessionId="" isBottom readOnly />);
    expect(screen.getByText('New Chat')).toBeInTheDocument();
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
    view.rerender(renderChat());
    expect(screen.getByText('当前会话')).toBeInTheDocument();
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
    view.rerender(<ChatLayoutComp sessionId="" isBottom={false} readOnly />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
  });
  it('preserves explicit title hiding inside a conversation', () => {
    render(<ChatLayoutComp sessionId="session-1" isBottom hideChatTitle readOnly />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
  });
  it('preserves the existing mobile header boundary', () => {
    mockGlobal.platform = 'h5';
    render(renderChat());
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
  });
  it('restores history without automatically opening the workspace', async () => {
    mockMessages = [employeeMessage('answer-1', true)];
    render(renderChat());
    expect(await screen.findByTitle('远程桌面')).toBeInTheDocument();
    expect(mockOpenVnc).not.toHaveBeenCalled();
  });
  it('uses only the latest employee answer in the current session to show the entry', async () => {
    mockMessages = [employeeMessage('answer-1', true)];
    const view = render(renderChat());
    expect(await screen.findByTitle('远程桌面')).toBeInTheDocument();
    view.rerender(renderChat('session-2'));
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
    mockMessages = [...mockMessages, employeeMessage('answer-2')];
    view.rerender(renderChat());
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
    expect(mockOpenVnc).not.toHaveBeenCalled();
  });
  it('accepts numeric session IDs and preserves the manual entry when another panel is open', async () => {
    mockMessages = [employeeMessage('answer-1', true, '11273519')];
    render(renderChat(11273519 as unknown as string));
    act(() => mockEventEmitter.emit('beyond-main-driver-open-type', { drawerType: 'preview' }));
    fireEvent.click(await screen.findByTitle('远程桌面'));
    expect(mockOpenVnc).toHaveBeenCalledTimes(1);
  });
});
