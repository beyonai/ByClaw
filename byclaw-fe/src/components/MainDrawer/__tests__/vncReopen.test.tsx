import { act, fireEvent, render, screen } from '@testing-library/react';
import type { IMessage } from '@/typescript/message';
import { SSEMessageType } from '@/constants/message';
import { EventEmitter$Cls } from '@/utils/eventEmitter';
import useVncOpener from '@/hooks/useVncOpener';
import VNC from '@/components/ChatLayoutComp/components/VNC';
import MainDrawer from '../index';
import { useDesktopWorkspace } from '@/utils/desktopWorkspace';

let mockEventEmitter = new EventEmitter$Cls();
const mockAppState = {
  sandboxesInfo: [] as unknown[],
  getSandboxesInfoUrl: jest.fn(),
  setSiderCollapsed: jest.fn(),
};

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  getIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/hooks/useGlobal', () => () => ({ EventEmitter: mockEventEmitter }));
jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: Object.assign((select: any) => select(mockAppState), { getState: () => mockAppState }),
}));
// Remote iframe loading is the boundary; opener, event bus, entry, and drawer stay real.
jest.mock('@/components/MessagesComp/Iframe/IframeRender', () => ({
  __esModule: true,
  default: ({ url }: { url: string }) => <iframe title="remote desktop" src={url} />,
}));
jest.mock('@/components/Preview/Twins', () => ({ PreViewFile: () => null }));
jest.mock('@/pages/mobile/AuthPage', () => ({ __esModule: true, default: () => null }));

const browserAnswer = {
  msgId: 'answer-1',
  sessionId: 'session-1',
  fromBeyond: true,
  messageList: [
    {
      contentType: SSEMessageType.toolCall,
      content: { substance: { title: 'browser', input: { operation: 'navigate' } } },
    },
  ],
} as IMessage;
const nextAnswer = { ...browserAnswer, msgId: 'answer-2', messageList: [] };

const ChatDesktop = ({ latestMessage }: { latestMessage: IMessage }) => {
  const openVnc = useVncOpener('session-1');
  return (
    <>
      <button type="button" onClick={() => openVnc({ key: 'tool-1' })}>
        Browser tool
      </button>
      <VNC sessionId="session-1" latestDigitalEmployeeMessage={latestMessage} />
      <MainDrawer />
    </>
  );
};

describe('chat VNC reopening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    localStorage.removeItem('enterpriseId');
    useDesktopWorkspace.setState({ owners: {}, visible: false, activeOwner: '', panel: '', revision: 0 });
    mockEventEmitter = new EventEmitter$Cls();
    mockAppState.sandboxesInfo = [
      { sandboxId: 'test', status: 'RUNNING', instanceEndpoints: { vnc: '/v1/sandboxes/test/proxy/8081' } },
    ];
    mockAppState.getSandboxesInfoUrl.mockImplementation(() => Promise.resolve(mockAppState.sandboxesInfo));
    // The opener probes the desktop before showing it; here it always answers.
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ type: 'basic', status: 200 });
  });

  it('keeps an open desktop available when a text answer hides the title entry', async () => {
    const view = render(<ChatDesktop latestMessage={browserAnswer} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Browser tool' })));
    expect(screen.getByTitle('remote desktop')).toHaveAttribute(
      'src',
      `${window.location.origin}/v1/sandboxes/test/proxy/8081/?autoconnect=true&resize=scale&hideHeader=true`
    );

    view.rerender(<ChatDesktop latestMessage={nextAnswer} />);
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
    expect(screen.getByTitle('remote desktop')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('img', { name: 'close' })[0]);
    expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();

    view.rerender(<ChatDesktop latestMessage={{ ...browserAnswer, msgId: 'answer-3' }} />);
    const desktopButton = await screen.findByTitle('远程桌面');
    await act(async () => fireEvent.click(desktopButton));
    expect(screen.getByTitle('remote desktop')).toBeInTheDocument();
  });

  it('keeps the entry hidden when the latest answer needs a desktop but none exists', async () => {
    mockAppState.sandboxesInfo = [];
    await act(async () => {
      render(<ChatDesktop latestMessage={browserAnswer} />);
    });
    expect(mockAppState.getSandboxesInfoUrl).toHaveBeenCalled();
    expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
    expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
  });

  it('keeps the desktop for unchanged identity and unloads it on a real tenant change', async () => {
    render(<ChatDesktop latestMessage={browserAnswer} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Browser tool' })));
    expect(screen.getByTitle('remote desktop')).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event('byclaw-auth-change')));
    expect(screen.getByTitle('remote desktop')).toBeInTheDocument();

    act(() => {
      localStorage.setItem('enterpriseId', 'new-tenant');
      window.dispatchEvent(new Event('byclaw-auth-change'));
    });
    expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
    expect(useDesktopWorkspace.getState().owners).toEqual({});
  });

  it('unloads the desktop when the chat leaves while the global drawer remains mounted', async () => {
    const ChatEntry = () => {
      const openVnc = useVncOpener('session-1');
      return <button onClick={() => openVnc({ key: 'live-tool' })}>Open desktop</button>;
    };
    const Host = ({ chatVisible }: { chatVisible: boolean }) => (
      <>
        {chatVisible && <ChatEntry />}
        <MainDrawer />
      </>
    );
    const view = render(<Host chatVisible />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open desktop' })));
    expect(screen.getByTitle('remote desktop')).toBeInTheDocument();
    view.rerender(<Host chatVisible={false} />);
    expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
  });
});
