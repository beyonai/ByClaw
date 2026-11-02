import { act, fireEvent, render, screen } from '@testing-library/react';
import type { IMessage } from '@/typescript/message';
import { SSEMessageType } from '@/constants/message';
import { EventEmitter$Cls } from '@/utils/eventEmitter';
import useVncOpener from '@/hooks/useVncOpener';
import VNC from '@/components/ChatLayoutComp/components/VNC';
import MainDrawer from '../index';

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
  default: { getState: () => mockAppState },
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
    mockEventEmitter = new EventEmitter$Cls();
    mockAppState.sandboxesInfo = [{ status: 'RUNNING', instanceEndpoints: { vnc: '/v1/sandboxes/test/proxy/8081' } }];
    mockAppState.getSandboxesInfoUrl.mockResolvedValue([]);
    // The opener probes the desktop before showing it; here it always answers.
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ type: 'basic', status: 200 });
  });

  it('keeps the icon after a new answer and real drawer close, then reopens the desktop', async () => {
    const view = render(<ChatDesktop latestMessage={browserAnswer} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Browser tool' })));
    expect(screen.getByTitle('remote desktop')).toHaveAttribute(
      'src',
      `${window.location.origin}/v1/sandboxes/test/proxy/8081/?autoconnect=true&resize=scale`
    );

    view.rerender(<ChatDesktop latestMessage={nextAnswer} />);
    fireEvent.click(screen.getByRole('img', { name: 'close' }));
    expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
    expect(screen.getByTitle('common.remoteComputer')).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByTitle('common.remoteComputer')));
    expect(screen.getByTitle('remote desktop')).toBeInTheDocument();
  });

  it('does not retain the icon for a failed desktop opening', async () => {
    mockAppState.sandboxesInfo = [];
    jest.useFakeTimers();
    try {
      const view = render(<ChatDesktop latestMessage={browserAnswer} />);
      await act(async () => fireEvent.click(screen.getByTitle('common.remoteComputer')));
      await act(async () => {
        await jest.runAllTimersAsync();
      });

      // The click is answered with a notice instead of an empty drawer.
      expect(await screen.findByText('common.remoteComputerUnavailable')).toBeInTheDocument();
      view.rerender(<ChatDesktop latestMessage={nextAnswer} />);
      expect(screen.queryByTitle('common.remoteComputer')).not.toBeInTheDocument();
      expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
