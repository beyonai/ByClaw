jest.mock('@fortaine/fetch-event-source', () => ({
  fetchEventSource: jest.fn(),
}));

jest.mock('@umijs/max', () => ({
  getLocale: jest.fn(() => 'zh-CN'),
}));

jest.mock('@/utils/auth', () => ({
  getAuthSnapshot: jest.fn(() => ({
    sessionId: 'session-value',
    token: 'token-value',
    ssoToken: 'sso-token',
  })),
  ssotokenKey: 'x-sso-token',
  tokenKey: 'x-token',
}));

jest.mock('@/service/common/request', () => ({
  globalLogout: jest.fn(),
}));

jest.mock('@/utils/signature', () => ({
  generateSignature: jest.fn(() => ({ 'x-sign': 'sign-value' })),
}));

jest.mock('../useSseSender/util', () => ({
  answerDeltaHandler: jest.fn(() => ({ message: { contentType: 'text' } })),
  reasoningLogHandler: jest.fn(() => ({ message: { contentType: 'think' } })),
}));

jest.mock('@/utils/messgae', () => ({
  getMsgId: jest.fn(() => 'msg-1'),
}));

import { fetchEventSource } from '@fortaine/fetch-event-source';
import { setMultiTenancyConfig } from '@/utils/multiTenancy';
import { globalLogout } from '@/service/common/request';
import { generateSignature } from '@/utils/signature';
import { answerDeltaHandler } from '../useSseSender/util';

import SendHelper, { ERROR_STATUS } from '../useSseSender/sendHelper';

const mockFetchEventSource = fetchEventSource as jest.MockedFunction<typeof fetchEventSource>;

describe('hooks/useSseSender/sendHelper', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
    window.sessionStorage.removeItem('BYCLAW_TAB_ENTERPRISE');
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    window.sessionStorage.removeItem('BYCLAW_TAB_ENTERPRISE');
  });

  it.each(['2099-01-01T00:00:00Z', '2000-01-01T00:00:00Z'])(
    'ignores legacy enterprise storage with expiry %s for SSE routing',
    async (expiresAt) => {
      window.localStorage.setItem('SESSION', 'session-value');
      window.sessionStorage.setItem(
        'BYCLAW_TAB_ENTERPRISE',
        JSON.stringify({
          enterpriseId: '123',
          sessionId: 'session-value',
          tenantContextToken: 'legacy-context',
          expiresAt,
        })
      );
      mockFetchEventSource.mockResolvedValue();

      await expect(new SendHelper().send({}, {}).promise).resolves.toEqual({});
      expect(mockFetchEventSource.mock.calls[0][0]).toBe('/byaiService/chat/superAgentChat');
      expect(mockFetchEventSource.mock.calls[0][1].headers).not.toHaveProperty('X-Enterprise-Id');
      expect(mockFetchEventSource.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-Context');
    }
  );

  it('keeps forwarding an active stream after enterprise configuration changes', async () => {
    const callback = jest.fn();
    mockFetchEventSource.mockImplementation(async (_url, options: any) => {
      setMultiTenancyConfig(null);
      window.sessionStorage.setItem('BYCLAW_TAB_ENTERPRISE', '{"enterpriseId":"456"}');
      options.onmessage({ event: 'initMessage', id: '1', data: '{"messageId":"m1"}' });
      expect(options.signal.aborted).toBe(false);
    });

    await expect(new SendHelper().send({}, { callback }).promise).resolves.toEqual({});
    expect(callback).toHaveBeenCalledWith({ messageId: 'm1' }, expect.objectContaining({ event: 'initMessage' }));
  });

  it('sends SSE requests with auth and signature headers and forwards payloads to callback', async () => {
    const callback = jest.fn();

    mockFetchEventSource.mockImplementation(async (_url, options: any) => {
      options.onmessage({
        event: 'answerDelta',
        id: '1',
        data: JSON.stringify({
          messageId: 'm1',
          queryMessageId: 'q1',
          metadata: 'meta',
        }),
      });
      options.onmessage({
        event: 'appStreamResponse',
        id: '2',
        data: JSON.stringify({
          messageId: 'm1',
          queryMessageId: 'q1',
          relatedResources: ['r1'],
          relatedQuestions: ['q2'],
        }),
      });
    });

    const helper = new SendHelper('/custom-chat');
    const { promise } = helper.send({ foo: 'bar' }, { callback });

    await expect(promise).resolves.toEqual({});
    expect(generateSignature).toHaveBeenCalledWith('POST', {
      foo: 'bar',
      language: 'zh-CN',
    });
    expect(mockFetchEventSource).toHaveBeenCalledWith(
      '/custom-chat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          foo: 'bar',
          language: 'zh-CN',
        }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          language: 'zh-CN',
          accessTerminal: 'Web',
          'x-token': 'token-value',
          'x-sso-token': 'sso-token',
          'x-sign': 'sign-value',
        }),
      })
    );
    expect(answerDeltaHandler).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'm1',
        queryMessageId: 'q1',
      }),
      expect.objectContaining({ event: 'answerDelta' })
    );
  });

  it('triggers global logout when server responds with unauthorized status', async () => {
    mockFetchEventSource.mockImplementation(async (_url, options: any) => {
      await options.onopen({ status: 401 });
    });

    const helper = new SendHelper();
    const { promise } = helper.send({}, {});

    await expect(promise).rejects.toBe(ERROR_STATUS.NOAUTH);
    expect(globalLogout).toHaveBeenCalledWith(false, {
      sessionId: 'session-value',
      token: 'token-value',
      ssoToken: 'sso-token',
    });
  });
});
