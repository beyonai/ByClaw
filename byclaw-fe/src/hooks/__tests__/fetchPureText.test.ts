jest.mock('@fortaine/fetch-event-source', () => ({
  fetchEventSource: jest.fn(),
}));

jest.mock('@umijs/max', () => ({
  getLocale: jest.fn(() => 'zh-CN'),
}));

jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

jest.mock('@/utils/math', () => ({
  generateUniqueId: jest.fn(() => 'request-1'),
}));

import { fetchEventSource } from '@fortaine/fetch-event-source';
import { POST } from '@/service/common/request';

import fetchPureText from '../useSseSender/fetchPureText';

const mockFetchEventSource = fetchEventSource as jest.MockedFunction<typeof fetchEventSource>;
const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('hooks/useSseSender/fetchPureText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('streams text chunks and resolves when DONE is received', async () => {
    const callback = jest.fn();

    mockFetchEventSource.mockImplementation(async (_url, options: any) => {
      options.onmessage({
        data: JSON.stringify({
          choices: [{ delta: { content: 'hello' } }],
        }),
        event: 'message',
        id: '1',
      });
      options.onmessage({
        data: '[DONE]',
        event: 'message',
        id: '2',
      });
    });

    const { promise } = fetchPureText({
      url: '/sse',
      body: { q: 'test' },
      callback,
    });

    await expect(promise).resolves.toBe('');
    expect(callback).toHaveBeenCalledWith('hello');
    expect(mockFetchEventSource).toHaveBeenCalledWith(
      '/sse',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          q: 'test',
          requestId: 'request-1',
          language: 'zh-CN',
        }),
        headers: {
          'Content-Type': 'application/json',
          language: 'zh-CN',
        },
        openWhenHidden: true,
      })
    );
  });

  it('cancels the request and falls back to POST when sendBeacon is unavailable', () => {
    const abort = jest.spyOn(AbortController.prototype, 'abort');
    Object.defineProperty(window.navigator, 'sendBeacon', {
      value: undefined,
      configurable: true,
    });
    mockFetchEventSource.mockImplementation(() => new Promise(() => undefined) as any);

    const { cancel } = fetchPureText({
      url: '/sse',
      body: { q: 'test' },
      callback: jest.fn(),
      timeout: 1000,
    });

    cancel('manual');

    expect(abort).toHaveBeenCalledWith('manual');
    expect(mockPOST).toHaveBeenCalledWith('knowledgeService/callDomainService/cancelSse', {
      requestId: 'request-1',
    });
  });
});
