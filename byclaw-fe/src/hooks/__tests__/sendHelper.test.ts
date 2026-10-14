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
import { globalLogout } from '@/service/common/request';
import { generateSignature } from '@/utils/signature';
import { setMultiTenancyConfig } from '@/utils/multiTenancy';
import { answerDeltaHandler } from '../useSseSender/util';

import SendHelper, { ERROR_STATUS } from '../useSseSender/sendHelper';

const mockFetchEventSource = fetchEventSource as jest.MockedFunction<typeof fetchEventSource>;

describe('hooks/useSseSender/sendHelper', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.setItem('SESSION', 'session-value');
    setMultiTenancyConfig({ ENABLE_MULTI_TENACY: '1' });
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.removeItem('SESSION');
    consoleLogSpy.mockRestore();
  });

  it.each(['2099-01-01T00:00:00Z', '2000-01-01T00:00:00Z'])(
    'sends and receives chat streams independently of legacy tenant storage: %s',
    async (expiresAt) => {
      window.sessionStorage.setItem(
        'BYCLAW_TAB_ENTERPRISE',
        JSON.stringify({
          enterpriseId: '123',
          sessionId: 'session-value',
          tenantContextToken: 'legacy-context',
          expiresAt,
        })
      );
      const callback = jest.fn();
      mockFetchEventSource.mockImplementation(async (_url, options: any) => {
        setMultiTenancyConfig(null);
        options.onmessage({ event: 'answerDelta', id: '1', data: JSON.stringify({ messageId: 'm1' }) });
      });

      await expect(new SendHelper().send({}, { callback }).promise).resolves.toEqual({});
      const options = mockFetchEventSource.mock.calls[0][1]!;
      expect(options.headers).toMatchObject({ 'x-token': 'token-value', 'x-sso-token': 'sso-token' });
      expect(options.headers).not.toHaveProperty('X-Enterprise-Id');
      expect(options.headers).not.toHaveProperty('X-Tenant-Context');
      expect(options.signal?.aborted).toBe(false);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: 'm1' }),
        expect.objectContaining({ event: 'answerDelta' })
      );
    }
  );

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
