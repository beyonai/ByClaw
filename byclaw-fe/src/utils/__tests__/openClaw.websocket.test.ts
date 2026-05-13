jest.mock('../messgae', () => ({
  getMsgId: jest.fn(() => 'msg-1'),
}));

jest.mock('../common', () => ({
  isDevelopment: jest.fn(() => false),
}));

import { SSEEventStatus, SSEMessageType } from '@/constants/message';

import {
  destroyOpenClawWebSocket,
  getOpenClawWebSocket,
  initOpenClawWebSocket,
  OpenClawWebSocketClient,
} from '../openClaw/openclawWebSocket';

describe('utils/openClaw/openclawWebSocket', () => {
  beforeEach(() => {
    destroyOpenClawWebSocket();
    Object.defineProperty(window, 'location', {
      value: {
        host: 'app.example.com',
      },
      configurable: true,
    });
  });

  afterEach(() => {
    destroyOpenClawWebSocket();
    jest.restoreAllMocks();
  });

  it('creates a singleton client and destroys it cleanly', () => {
    const clientA = initOpenClawWebSocket('https://agent.example.com:8080/?token=abc', 'agent-1');
    const clientB = initOpenClawWebSocket('https://agent.example.com:8080/?token=xyz', 'agent-2');

    expect(clientA).toBe(clientB);
    expect(getOpenClawWebSocket()).toBe(clientA);
    expect(clientA.getWsUrl()).toBe('wss://app.example.com/byaiService/openclaw');
    expect(clientA.getOriginUrl()).toBe('https://agent.example.com:8080/?token=abc');

    const closeSpy = jest.spyOn(clientA, 'close').mockImplementation(() => undefined);
    destroyOpenClawWebSocket();

    expect(closeSpy).toHaveBeenCalledWith(1000, 'user destroy instance');
    expect(getOpenClawWebSocket()).toBeNull();
  });

  it('rejects ensureConnected when token is missing', async () => {
    const client = new OpenClawWebSocketClient('https://agent.example.com:8080/', 'agent-1');

    await expect(client.ensureConnected()).rejects.toThrow('Token or password is required for WebSocket connect');
  });

  it('normalizes session aliases in loadHistory and clamps limit', async () => {
    const client = new OpenClawWebSocketClient('https://agent.example.com:8080/?token=abc', 'agent-1');
    const requestSpy = jest.spyOn(client, 'request').mockResolvedValue({
      sessionKey: 'session-main',
      sessionId: 'real-session',
      messages: [{ role: 'assistant', content: 'hello' }],
      thinkingLevel: 'deep',
      verboseLevel: 'high',
    } as any);

    (client as any).sessionDefaults = {
      defaultAgentId: 'agent-1',
      mainKey: 'default',
      mainSessionKey: 'session-main',
    };

    const result = await client.loadHistory('agent:agent-1:default', 5000);

    expect(requestSpy).toHaveBeenCalledWith('chat.history', {
      sessionKey: 'session-main',
      limit: 1000,
    });
    expect(result).toEqual({
      sessionKey: 'session-main',
      sessionId: 'real-session',
      messages: [{ role: 'assistant', content: 'hello' }],
      thinkingLevel: 'deep',
      verboseLevel: 'high',
    });
  });

  it('maps chat payloads into SSE-compatible delta, final and error payloads', () => {
    const deltaPayload = OpenClawWebSocketClient.toSsePayloadFromChat(
      {
        state: 'delta',
        data: { delta: 'hello' },
      },
      'delta'
    );

    expect(deltaPayload).toEqual({
      sseRes: {
        message: {
          contentType: SSEMessageType.text,
          content: {
            substance: 'hello',
          },
          status: SSEEventStatus.query,
        },
      },
      sseMsg: {
        data: JSON.stringify({
          state: 'delta',
          data: { delta: 'hello' },
        }),
        event: 'answerDelta',
        id: 'msg-1',
      },
    });

    const finalPayload = OpenClawWebSocketClient.toSsePayloadFromChat(
      {
        state: 'final',
        data: { delta: 'done' },
      },
      'final'
    );

    expect(finalPayload.sseRes.message.status).toBe(SSEEventStatus.done);
    expect(finalPayload.sseMsg.event).toBe('answerEnd');

    const errorPayload = OpenClawWebSocketClient.toSsePayloadFromChat(
      {
        state: 'error',
        errorMessage: 'boom',
      },
      'error'
    );

    expect(errorPayload).toEqual({
      sseRes: {
        message: {
          contentType: SSEMessageType.error,
          content: {
            substance: {
              msg: 'boom',
              traceback: '',
            },
          },
          status: SSEEventStatus.done,
        },
      },
      sseMsg: {
        data: JSON.stringify({
          state: 'error',
          errorMessage: 'boom',
        }),
        event: 'error',
        id: 'msg-1',
      },
    });
  });
});
