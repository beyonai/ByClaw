jest.mock('dompurify', () => ({
  sanitize: jest.fn((value: string) => `safe:${value}`),
}));

jest.mock('@umijs/max', () => ({
  useDispatch: jest.fn(),
}));

const createHelperInstance = (name: string) => ({
  name,
  send: jest.fn(() => ({
    promise: Promise.resolve({ ok: true }),
    cancel: jest.fn(),
  })),
});

jest.mock('../useSseSender/sendHelper', () => {
  return jest.fn().mockImplementation((chatUrl?: string) => ({
    ...createHelperInstance('default'),
    chatUrl,
  }));
});

jest.mock('../useSseSender/openclaw/sendHelper', () => {
  return jest.fn().mockImplementation((config?: any) => ({
    ...createHelperInstance('openclaw'),
    config,
  }));
});

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('@/utils/openClaw/utils', () => ({
  isOpenClawAgent: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import { useDispatch } from '@umijs/max';
import DOMPurify from 'dompurify';

import SendHelper from '../useSseSender/sendHelper';
import OpenclawSendHelper from '../useSseSender/openclaw/sendHelper';
import useGlobal from '../useGlobal';
import { isOpenClawAgent } from '@/utils/openClaw/utils';

import useSend from '../useSseSender/useSend';

const mockUseDispatch = useDispatch as jest.Mock;
const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;
const mockIsOpenClawAgent = isOpenClawAgent as jest.MockedFunction<typeof isOpenClawAgent>;
const MockSendHelper = SendHelper as unknown as jest.Mock;
const MockOpenclawSendHelper = OpenclawSendHelper as unknown as jest.Mock;

describe('hooks/useSseSender/useSend', () => {
  let dispatch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    dispatch = jest.fn();
    mockUseDispatch.mockReturnValue(dispatch);
    mockUseGlobal.mockReturnValue({
      agentInfo: null,
    } as any);
    mockIsOpenClawAgent.mockReturnValue(false);
  });

  it('uses the default send helper and sanitizes outgoing text', async () => {
    const { result } = renderHook(() =>
      useSend({
        sessionId: 'session-1',
        language: 'en',
        chatUrl: '/chat/url',
      })
    );

    const callback = jest.fn();

    await act(async () => {
      const { promise } = result.current.send('<b>hello</b>', { foo: 'bar' }, { callback, traceId: 'trace-1' });
      await promise;
    });

    const helperInstance = MockSendHelper.mock.results.at(-1)?.value;
    expect(helperInstance.send).toHaveBeenCalledWith(
      {
        language: 'en',
        chatContent: 'safe:<b>hello</b>',
        relModelId: -1,
        accessTerminal: 'Web',
        sessionId: 'session-1',
        chatId: 'session-1',
        foo: 'bar',
      },
      expect.objectContaining({
        traceId: 'trace-1',
        callback: expect.any(Function),
      }),
      {
        useEventSource: false,
      }
    );
    expect(DOMPurify.sanitize).toHaveBeenCalledWith('<b>hello</b>');

    const wrappedCallback = helperInstance.send.mock.calls[0][1].callback;
    wrappedCallback({ message: 'payload' }, { event: 'answerDelta' });
    expect(callback).toHaveBeenCalledWith({ message: 'payload' }, { event: 'answerDelta' });
  });

  it('switches to the openclaw helper when the current agent is openclaw', async () => {
    mockUseGlobal.mockReturnValue({
      agentInfo: { agentId: 'agent-1', agentType: '013' },
    } as any);
    mockIsOpenClawAgent.mockReturnValue(true);

    const { result } = renderHook(() =>
      useSend({
        sessionId: 'session-2',
        chatUrl: '/chat/url',
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.send('hello');
    });

    expect(MockOpenclawSendHelper).toHaveBeenCalledWith({
      agentInfo: { agentId: 'agent-1', agentType: '013' },
      updateSession: expect.objectContaining({
        current: expect.any(Function),
      }),
    });

    const helperInstance = MockOpenclawSendHelper.mock.results.at(-1)?.value;
    expect(helperInstance.send).toHaveBeenCalled();
  });
});
