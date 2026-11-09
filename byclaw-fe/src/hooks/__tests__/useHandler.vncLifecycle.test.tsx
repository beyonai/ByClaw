import { act, render, renderHook, screen } from '@testing-library/react';
import MainDrawer from '@/components/MainDrawer';
import { formatStreamPayload } from '@/hooks/useSseSender/chatStream';
import useHandler from '@/hooks/useChat/useHandler';
import { clearChatRuntime, handleParsedChatStream, registerPendingChatContext } from '@/hooks/useChat/chatRuntime';
import type { IMessage } from '@/typescript/message';
import { EventEmitter$Cls } from '@/utils/eventEmitter';
import { useDesktopWorkspace } from '@/utils/desktopWorkspace';

let mockSessionId: string | undefined;
let mockEventEmitter = new EventEmitter$Cls();
const mockAppState = {
  getSandboxesInfoUrl: jest.fn(),
  setSiderCollapsed: jest.fn(),
};

jest.mock('@umijs/max', () => ({
  useDispatch: () => jest.fn(),
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  getIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ sessionId: mockSessionId, EventEmitter: mockEventEmitter }),
}));
jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: { getState: () => mockAppState },
}));
// Keep the registered stream context, handler, opener, event bus, workspace and drawer real.
jest.mock('@/components/MessagesComp/Iframe/IframeRender', () => ({
  __esModule: true,
  default: ({ url }: { url: string }) => <iframe title="remote desktop" src={url} />,
}));
jest.mock('@/components/Preview/Twins', () => ({ PreViewFile: () => null }));
jest.mock('@/pages/mobile/AuthPage', () => ({ __esModule: true, default: () => null }));

const registerStream = (flowHandler: (props: any) => any) => {
  const answer = {
    msgId: 'answer-a',
    messageId: 'answer-a',
    fromBeyond: true,
    messageList: [],
    thinkList: [],
  } as unknown as IMessage;
  registerPendingChatContext({
    clientRequestId: 'request-a',
    queryMsg: { msgId: 'query-a' } as IMessage,
    answerMsg: answer,
    flowHandler,
    getMessageList: () => [answer],
    updateMessage: (message) => message,
  });
  return answer;
};

const desktopRefs = [{ sandboxId: 'sandbox-a', instance: 'vnc' }];

const receiveTool = (
  sessionId: string,
  instanceRefs?: typeof desktopRefs,
  tool: { orderId: string; title: string; input?: Record<string, unknown> } = {
    orderId: 'browser-a',
    title: 'browser',
    input: { operation: 'open' },
  }
) => {
  const payload = {
    sessionId,
    contentType: '3015',
    objectType: 'tool_call',
    orderId: tool.orderId,
    ...(instanceRefs !== undefined ? { instanceRefs } : {}),
    choices: [{ delta: { content: JSON.stringify({ title: tool.title, input: tool.input }) } }],
  };
  handleParsedChatStream({
    eventName: 'reasoningLogDelta',
    formattedPayload: formatStreamPayload('reasoningLogDelta', payload),
    res: { sessionId },
    sseMsg: { event: 'reasoningLogDelta', data: JSON.stringify(payload) },
    rawMessage: { type: 'CHAT_STREAM', clientRequestId: 'request-a', sessionId, data: payload },
    clientRequestId: 'request-a',
    isError: false,
    isDone: false,
  } as any);
};

beforeEach(() => {
  clearChatRuntime();
  sessionStorage.clear();
  mockSessionId = undefined;
  mockEventEmitter = new EventEmitter$Cls();
  useDesktopWorkspace.setState({ owners: {}, visible: false, activeOwner: '', panel: '', revision: 0 });
  mockAppState.getSandboxesInfoUrl.mockResolvedValue([
    {
      sandboxId: 'sandbox-a',
      status: 'RUNNING',
      instanceEndpoints: { vnc: '/v1/sandboxes/sandbox-a/proxy/8081' },
    },
  ]);
  global.fetch = jest.fn().mockResolvedValue({ status: 200 });
});

afterEach(() => clearChatRuntime());

it.each([
  { refs: false, v2: false, input: { operation: 'open' } },
  { refs: true, v2: false, input: { operation: 'open' } },
  { refs: true, v2: true, input: { operation: 'open' } },
  { refs: true, v2: true, input: { operation: 'navigate', url: 'https://example.test/' } },
  { refs: true, v2: true, input: { operation: 'runGoal', goal: 'Read the page title' } },
])('opens the first new-chat desktop for $input.operation (refs=$refs, v2=$v2)', async ({ refs, v2, input }) => {
  const { result, rerender } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
  render(<MainDrawer />);
  const { browserHandler, messageHandler } = result.current;
  const answer = registerStream((props) => browserHandler(messageHandler(props)));
  if (v2) answer.metadata = JSON.stringify({ messageRenderVersion: 'v2' });

  // Initialization assigns an ID after the send registered its original stream callback.
  mockSessionId = 'chat-a';
  answer.sessionId = 'chat-a';
  rerender();
  if (refs) {
    await act(async () => receiveTool('chat-a', [], { orderId: 'browser-a', title: 'browser', input }));
    expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
    // The later instance update omits input and relies on the merged tool call.
    await act(async () => receiveTool('chat-a', desktopRefs, { orderId: 'browser-a', title: 'browser' }));
  } else {
    await act(async () => receiveTool('chat-a'));
  }

  expect(await screen.findByTitle('remote desktop')).toHaveAttribute(
    'src',
    'http://localhost/v1/sandboxes/sandbox-a/proxy/8081/?autoconnect=true&resize=scale&hideHeader=true'
  );
});

it.each([
  { title: 'sandbox_acquire', input: { template_key: 'general-tools', request_id: 'request-a' } },
  { title: 'sandbox_exec', input: { lease_id: 'lease-a', argv: ['wecom', 'contact', 'list'] } },
  { title: 'browser', input: { operation: 'status' } },
])('only associates a desktop for $title and leaves auto-open available for browser open', async (tool) => {
  mockSessionId = 'chat-a';
  const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
  render(<MainDrawer />);
  const answer = registerStream(result.current.browserHandler);
  answer.sessionId = 'chat-a';

  await act(async () => receiveTool('chat-a', desktopRefs, { ...tool, orderId: 'tool-a' }));

  expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
  expect(useDesktopWorkspace.getState().owners['["session","chat-a"]']?.refs).toEqual(desktopRefs);

  await act(async () => receiveTool('chat-a', desktopRefs));
  expect(await screen.findByTitle('remote desktop')).toBeInTheDocument();
});

it('does not open a late previous-chat tool through the retained stream callback after navigation', async () => {
  mockSessionId = 'chat-a';
  const { result, rerender } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
  render(<MainDrawer />);
  const answer = registerStream(result.current.browserHandler);
  answer.sessionId = 'chat-a';

  mockSessionId = 'chat-b';
  rerender();
  await act(async () => receiveTool('chat-a', desktopRefs));

  expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
  expect(useDesktopWorkspace.getState().visible).toBe(false);
});
