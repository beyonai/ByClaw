jest.mock('../openClaw/openclawWebSocket', () => ({
  getOpenClawWebSocket: jest.fn(),
}));

jest.mock('../openClaw/openclawMessage', () => ({
  convertOpenClawToIMessage: jest.fn(() => [{ msgId: '1' }]),
}));

import { getOpenClawWebSocket } from '../openClaw/openclawWebSocket';
import { setupOpenClawHistoryHook } from '../openClaw/openclawHistoryHook';

const mockGetOpenClawWebSocket = getOpenClawWebSocket as jest.MockedFunction<typeof getOpenClawWebSocket>;

describe('utils/openClaw/openclawHistoryHook', () => {
  it('installs request interceptor and serves mocked history through adapter', async () => {
    let installedInterceptor: Function | null = null;
    const instance = {
      interceptors: {
        request: {
          use: jest.fn((fn: Function) => {
            installedInterceptor = fn;
          }),
        },
      },
    } as any;

    mockGetOpenClawWebSocket.mockReturnValue({
      ensureConnected: jest.fn().mockResolvedValue(undefined),
      loadHistory: jest.fn().mockResolvedValue({
        sessionKey: 'main',
        messages: [{ role: 'assistant', content: 'hello' }],
      }),
      agentId: 'agent-1',
    } as any);

    setupOpenClawHistoryHook(instance);
    expect(instance.interceptors.request.use).toHaveBeenCalled();

    const config = (await installedInterceptor?.({
      params: { pageNum: 2 },
    })) as any;

    const response = await config.adapter(config);
    expect(response.data).toEqual({
      code: 0,
      msg: '',
      data: {
        list: [{ msgId: '1' }],
        pageNum: 2,
        pageSize: 1,
        total: 1,
      },
    });
  });

  it('falls back to original adapter when openclaw loading fails', async () => {
    let installedInterceptor: Function | null = null;
    const originalAdapter = jest.fn().mockResolvedValue({ ok: true });
    const instance = {
      interceptors: {
        request: {
          use: jest.fn((fn: Function) => {
            installedInterceptor = fn;
          }),
        },
      },
    } as any;

    mockGetOpenClawWebSocket.mockReturnValue({
      ensureConnected: jest.fn().mockRejectedValue(new Error('failed')),
      loadHistory: jest.fn(),
      agentId: 'agent-1',
    } as any);

    setupOpenClawHistoryHook(instance);
    const config = (await installedInterceptor?.({
      adapter: originalAdapter,
    })) as any;

    await expect(config.adapter(config)).resolves.toEqual({ ok: true });
    expect(originalAdapter).toHaveBeenCalled();
  });
});
