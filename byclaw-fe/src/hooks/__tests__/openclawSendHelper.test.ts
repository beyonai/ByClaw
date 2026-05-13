jest.mock('@/utils/openClaw/openclawWebSocket', () => ({
  getOpenClawWebSocket: jest.fn(),
  OpenClawWebSocketClient: {
    toSsePayloadFromChat: jest.fn(() => ({
      sseRes: { message: { contentType: 'text' } },
      sseMsg: { event: 'answerDelta', data: '{}', id: '1' },
    })),
  },
}));

jest.mock('@/utils/openClaw/utils', () => ({
  generateFilePrompt: jest.fn((content: string) => `wrapped:${content}`),
}));

jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { POST } from '@/service/common/request';
import { generateFilePrompt } from '@/utils/openClaw/utils';
import {
  getOpenClawWebSocket,
  OpenClawWebSocketClient,
} from '@/utils/openClaw/openclawWebSocket';

import OpenclawSendHelper from '../useSseSender/openclaw/sendHelper';

const mockGetOpenClawWebSocket = getOpenClawWebSocket as jest.MockedFunction<typeof getOpenClawWebSocket>;

describe('hooks/useSseSender/openclaw/sendHelper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends chat through the websocket client and updates session after completion', async () => {
    const callback = jest.fn();
    const updateSessionRef = {
      current: jest.fn(),
    };

    mockGetOpenClawWebSocket.mockReturnValue({
      ensureConnected: jest.fn().mockResolvedValue(undefined),
      sendChat: jest.fn((_content: string, opts: any) => {
        opts.onChunk({ data: { delta: 'hello' } }, 'delta');
        opts.onChunk({ state: 'final' }, 'final');
        return {
          promise: Promise.resolve(),
          cancel: jest.fn(),
        };
      }),
      getRealSessionId: jest.fn(() => 'real-session-1'),
    } as any);

    const helper = new OpenclawSendHelper({
      agentInfo: {
        agentHomeUrl: 'https://agent.example.com:8080/?token=abc',
      } as any,
      updateSession: updateSessionRef as any,
    });

    const { promise } = helper.send(
      {
        chatContent: 'ask file',
        sessionId: 'session-1',
        files: [{ fileName: 'a.txt', fileUrl: '/tmp/a.txt', fileSize: 10 }],
      },
      { callback }
    );

    await expect(promise).resolves.toEqual({});
    await Promise.resolve();
    expect(generateFilePrompt).toHaveBeenCalled();
    expect((OpenClawWebSocketClient as any).toSsePayloadFromChat).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(
      { message: { contentType: 'text' } },
      { event: 'answerDelta', data: '{}', id: '1' }
    );
    expect(updateSessionRef.current).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        sessionContent: '',
      })
    );
    expect(POST).toHaveBeenCalledWith('/byaiService/open/api/v1/updateSession', {
      sessionId: 'real-session-1',
      sessionContent: '',
    });
  });

  it('rejects when the websocket client is not available', async () => {
    mockGetOpenClawWebSocket.mockReturnValue(null);

    const helper = new OpenclawSendHelper({
      agentInfo: {
        agentHomeUrl: 'https://agent.example.com:8080/?token=abc',
      } as any,
      updateSession: { current: jest.fn() } as any,
    });

    await expect(helper.send({ chatContent: 'hello' }, {}).promise).rejects.toThrow('OpenClaw WebSocket not connected');
  });
});
