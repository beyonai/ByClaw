const mockOpenVnc = jest.fn();
let mockSessionId = 'session-a';

jest.mock('@umijs/max', () => ({ useDispatch: () => jest.fn() }));
jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: () => ({ sessionId: mockSessionId, EventEmitter: { emit: jest.fn() } }),
}));
jest.mock('../useVncOpener', () => ({
  __esModule: true,
  default: () => mockOpenVnc,
}));

import { renderHook } from '@testing-library/react';
import { formatStreamPayload } from '../useSseSender/chatStream';
import useHandler from '../useChat/useHandler';

const streamProps = (title: string | undefined, input: unknown, sessionId = 'session-a', output?: unknown) => ({
  sseRes: formatStreamPayload('reasoningLogDelta', {
    contentType: '3015',
    objectType: 'tool_call',
    orderId: 'tool-a',
    choices: [{ delta: { content: JSON.stringify({ title, input: JSON.stringify(input), output }) } }],
  }),
  newAnswerMsg: { fromBeyond: true, sessionId, messageId: 'answer-a', msgId: 'answer-a' },
});

describe('useHandler VNC stream integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionId = 'session-a';
  });

  it('requests a desktop for the DSH bash frame with cd and env before bycli', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    const props = streamProps('bash', {
      command:
        'cd /work && RUN=$(cat RUNPATH.txt) && env AGENT_ID="agent-a" bycli browser main open "https://example.test/"',
    });
    expect(result.current.browserHandler(props as any)).toBe(props);
    expect(mockOpenVnc).toHaveBeenCalledWith({ key: 'answer-a:tool-a' });
  });

  it('does not open for a different session or for an ordinary shell mention', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    result.current.browserHandler(
      streamProps('bash', { command: 'bycli browser main open example.test' }, 'session-b') as any
    );
    result.current.browserHandler(
      streamProps('bash', { command: 'echo "bycli browser main open example.test"' }) as any
    );
    expect(mockOpenVnc).not.toHaveBeenCalled();
  });

  it('keeps command recognition working when a tool title is missing', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    result.current.browserHandler(
      streamProps(undefined, { command: 'env AGENT_ID=a bycli browser main screenshot' }) as any
    );
    expect(mockOpenVnc).toHaveBeenCalledTimes(1);
  });

  it('does not treat a browser status probe as an open action', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    result.current.browserHandler(streamProps('browser', { operation: 'status' }) as any);
    expect(mockOpenVnc).not.toHaveBeenCalled();
  });

  it('uses the merged tool input when a status result frame only contains its title and output', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    const props: any = streamProps('browser', undefined, 'session-a', { status: 'ok' });
    props.newAnswerMsg.thinkList = [
      {
        contentType: '3015',
        content: {
          orderId: 'tool-a',
          substance: { title: 'browser', input: { operation: 'status' }, output: { status: 'ok' } },
        },
      },
    ];
    result.current.browserHandler(props);
    expect(mockOpenVnc).not.toHaveBeenCalled();
  });

  it('uses only the matching parallel tool when recovering browser input from a result frame', () => {
    const { result } = renderHook(() => useHandler({ addSession: jest.fn(), setSessionId: jest.fn() }));
    const props: any = streamProps('browser', undefined, 'session-a', { status: 'ok' });
    props.newAnswerMsg.thinkList = [
      {
        contentType: '3015',
        content: { orderId: 'tool-a', substance: { title: 'browser', input: { operation: 'navigate' } } },
      },
      {
        contentType: '3015',
        content: { orderId: 'tool-b', substance: { title: 'browser', input: { operation: 'status' } } },
      },
    ];
    result.current.browserHandler(props);
    expect(mockOpenVnc).toHaveBeenCalledWith({ key: 'answer-a:tool-a' });
  });
});
