import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import VNC from '@/components/ChatLayoutComp/components/VNC';
import MainDrawer from '@/components/MainDrawer';
import { formatStreamPayload } from '@/hooks/useSseSender/chatStream';
import useHandler from '@/hooks/useChat/useHandler';
import {
  clearChatRuntime,
  flushRestoredChatStreamBuffer,
  getRestoredStreamKey,
  handleParsedChatStream,
  registerPendingChatContext,
  startRestoringChatStream,
} from '@/hooks/useChat/chatRuntime';
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
  useSelector: (selector: (state: object) => unknown) => selector({}),
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  getIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ sessionId: mockSessionId, EventEmitter: mockEventEmitter }),
}));
jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: Object.assign(() => undefined, { getState: () => mockAppState }),
}));
// Keep the registered stream context, handler, opener, event bus, workspace and drawer real.
jest.mock('@/components/MessagesComp/Iframe/IframeRender', () => ({
  __esModule: true,
  default: ({ url }: { url: string }) => <iframe title="remote desktop" src={url} />,
}));
jest.mock('@/components/Preview/Twins', () => ({ PreViewFile: () => null }));
jest.mock('@/pages/mobile/AuthPage', () => ({ __esModule: true, default: () => null }));

const registerStream = (flowHandler: (props: any) => any, id = 'a', requestId = `request-${id}`) => {
  const answer = {
    msgId: `answer-${id}`,
    messageId: `answer-${id}`,
    fromBeyond: true,
    messageList: [],
    thinkList: [],
  } as unknown as IMessage;
  registerPendingChatContext({
    clientRequestId: requestId,
    queryMsg: { msgId: `query-${id}` } as IMessage,
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
  tool: { orderId: string; title: string; input?: Record<string, unknown>; output?: string; status?: string } = {
    orderId: 'browser-a',
    title: 'browser',
    input: { operation: 'open' },
  },
  { requestId = 'request-a', traceId }: { requestId?: string; traceId?: string } = {}
) => {
  const { orderId, ...substance } = tool;
  const payload = {
    sessionId,
    traceId,
    contentType: '3015',
    objectType: 'tool_call',
    orderId,
    ...(instanceRefs !== undefined ? { instanceRefs } : {}),
    choices: [{ delta: { content: JSON.stringify(substance) } }],
  };
  handleParsedChatStream({
    eventName: 'reasoningLogDelta',
    formattedPayload: formatStreamPayload('reasoningLogDelta', payload),
    res: { sessionId },
    sseMsg: { event: 'reasoningLogDelta', data: JSON.stringify(payload) },
    rawMessage: { type: 'CHAT_STREAM', clientRequestId: requestId, sessionId, data: payload },
    clientRequestId: requestId,
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
  }
  expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
  if (refs) {
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

it.each([
  { requested: true, exitCode: 0, opens: true, resultRefs: desktopRefs },
  { requested: true, exitCode: 0, opens: true, resultRefs: [] },
  { requested: true, exitCode: 1, opens: false },
  { requested: false, exitCode: 0, opens: false },
])(
  'opens a scripted desktop only after an opted-in success ($requested, $exitCode, $resultRefs)',
  async ({ requested, exitCode, opens, resultRefs = desktopRefs }) => {
    mockSessionId = 'chat-a';
    const { result, rerender } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    render(<MainDrawer />);
    const { browserHandler, messageHandler } = result.current;
    const answer = registerStream((props) => browserHandler(messageHandler(props)));
    answer.sessionId = 'chat-a';
    answer.metadata = JSON.stringify({ messageRenderVersion: 'v2' });
    const tool = { orderId: 'script-a', title: 'sandbox_exec' };

    await act(async () =>
      receiveTool('chat-a', desktopRefs, {
        ...tool,
        input: { lease_id: 'lease-a', argv: ['bash', 'start-browser.sh'], opts: requested ? { show_desktop: {} } : {} },
        status: '_START_',
      })
    );
    expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();

    await act(async () =>
      receiveTool('chat-a', resultRefs, {
        ...tool,
        output: JSON.stringify({ exitCode, stdout: '', stderr: '' }),
        status: '_DONE_',
      })
    );
    await waitFor(() => expect(Boolean(screen.queryByTitle('remote desktop'))).toBe(opens));
    if (resultRefs.length) return;

    mockSessionId = 'chat-b';
    rerender();
    await waitFor(() => expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument());

    mockSessionId = 'chat-a';
    rerender();
    render(
      <VNC sessionId="chat-a" messages={[answer, { ...answer, msgId: 'newer-text', thinkList: [], messageList: [] }]} />
    );
    expect(await screen.findByTitle('远程桌面')).toBeInTheDocument();
    expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
  }
);

it('opens a new reply after manual close and ignores further frames for the same reply', async () => {
  mockSessionId = 'chat-a';
  const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
  render(<MainDrawer />);
  const { browserHandler, messageHandler } = result.current;
  const receiveReply = (props: any) => browserHandler(messageHandler(props));
  const first = registerStream(receiveReply);
  first.sessionId = 'chat-a';
  first.metadata = JSON.stringify({ messageRenderVersion: 'v2' });
  first.messageId = undefined;

  await act(async () => receiveTool('chat-a', desktopRefs));
  expect(await screen.findByTitle('remote desktop')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('img', { name: 'close' })[0]);
  expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();

  first.messageId = 'server-assigned-a';
  await act(async () =>
    receiveTool('chat-a', desktopRefs, { orderId: 'another-tool-in-a', title: 'browser', input: { operation: 'open' } })
  );
  expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();

  const second = registerStream(receiveReply, 'b');
  second.sessionId = 'chat-a';
  second.metadata = first.metadata;
  await act(async () => receiveTool('chat-a', desktopRefs, undefined, { requestId: 'request-b' }));
  expect(await screen.findByTitle('remote desktop')).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('img', { name: 'close' })[0]);
  await act(async () => receiveTool('chat-a', desktopRefs));
  expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
});

it('keeps the same auto-open key when a live reply is restored with its server message ID', async () => {
  mockSessionId = 'chat-a';
  const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
  render(<MainDrawer />);
  const { browserHandler, messageHandler } = result.current;
  const receiveReply = (props: any) => browserHandler(messageHandler(props));
  const requestId = 'query-a_answer-a';
  const first = registerStream(receiveReply, 'a', requestId);
  first.sessionId = 'chat-a';
  first.messageId = 'server-assigned-a';

  await act(async () => receiveTool('chat-a', desktopRefs, undefined, { requestId }));
  expect(await screen.findByTitle('remote desktop')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('img', { name: 'close' })[0]);

  const reloaded = registerStream(receiveReply, 'a', requestId);
  reloaded.sessionId = first.sessionId;
  reloaded.msgId = first.messageId;
  reloaded.messageId = first.messageId;
  await act(async () => receiveTool('chat-a', desktopRefs, undefined, { requestId }));
  expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
});

it('registers desktop references during history restore and opens only a later live reply', async () => {
  mockSessionId = 'chat-a';
  const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
  render(<MainDrawer />);
  const { browserHandler, messageHandler } = result.current;
  const receiveReply = (props: any) => browserHandler(messageHandler(props));
  const answer = registerStream(receiveReply);
  answer.sessionId = 'chat-a';
  const traceId = 'restored-trace';
  const restoreKey = getRestoredStreamKey('chat-a', traceId);

  startRestoringChatStream(restoreKey);
  await act(async () => receiveTool('chat-a', desktopRefs, undefined, { traceId }));
  expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();

  await act(async () => flushRestoredChatStreamBuffer(restoreKey));
  expect(useDesktopWorkspace.getState().owners['["session","chat-a"]']?.refs).toEqual(desktopRefs);
  expect(screen.queryByTitle('remote desktop')).not.toBeInTheDocument();
  render(<VNC sessionId="chat-a" messages={[answer]} />);
  expect(await screen.findByTitle('远程桌面')).toBeInTheDocument();

  const next = registerStream(receiveReply, 'b');
  next.sessionId = 'chat-a';
  await act(async () => receiveTool('chat-a', desktopRefs, undefined, { requestId: 'request-b' }));
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
