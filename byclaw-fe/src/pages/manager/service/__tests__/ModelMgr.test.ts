jest.mock('@umijs/max', () => ({
  getLocale: jest.fn(() => 'zh-CN'),
}));

jest.mock('@/pages/manager/utils/auth', () => ({
  getSessionKey: jest.fn(() => 'session-1'),
  getssoToken: jest.fn(() => 'sso-token'),
  getToken: jest.fn(() => 'token-1'),
  ssotokenKey: 'SSO-TOKEN',
  tokenKey: 'Beyond-Token',
}));

jest.mock('@/pages/manager/utils/signature', () => ({
  generateSignature: jest.fn(() => ({
    'x-signature': 'signed',
  })),
}));

jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import {
  debugModelStream,
  deleteModel,
  getModelDetail,
  getModelListByPage,
  setModelStatus,
  upsertModel,
} from '../ModelMgr';
import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('manager/service/ModelMgr', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as any;
  });

  it('getModelListByPage calls POST with customHandle config', () => {
    const payload = { pageNum: 1, pageSize: 10 };
    getModelListByPage(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/new/model/getModelListByPage', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('getModelDetail calls POST with customHandle config', () => {
    const payload = { id: 'model-1' };
    getModelDetail(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/new/model/getModelDetail', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('upsertModel calls POST with customHandle config', () => {
    const payload = { modelCode: 'gpt-4o' };
    upsertModel(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/new/model/upsertModel', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('deleteModel calls POST with customHandle config', () => {
    const payload = { id: 'model-1' };
    deleteModel(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/new/model/deleteModel', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('setModelStatus calls POST with customHandle config', () => {
    const payload = { id: 'model-1', status: 'ENABLED' };
    setModelStatus(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/new/model/setModelStatus', payload, {
      responseCfg: {
        customHandle: true,
      },
    });
  });

  it('debugModelStream sends signed fetch request and returns json for non-stream response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn(() => 'application/json'),
      },
      json: jest.fn().mockResolvedValue({ code: 0, data: { success: true } }),
    });

    const payload = { modelCode: 'gpt-4o', signal: 'signal' as any };
    await expect(debugModelStream(payload)).resolves.toEqual({ code: 0, data: { success: true } });

    expect(global.fetch).toHaveBeenCalledWith('/byaiService/new/model/debugModelStream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Beyond-Token': 'token-1',
        'SSO-TOKEN': 'sso-token',
        'x-session-id': 'session-1',
        language: 'zh-CN',
        'x-signature': 'signed',
      },
      body: JSON.stringify({
        modelCode: 'gpt-4o',
        language: 'zh-CN',
      }),
      signal: 'signal',
    });
  });

  it('debugModelStream aggregates event-stream deltas and emits onDelta', async () => {
    const onDelta = jest.fn();
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
      encoder.encode('data: {"choices":[{"message":{"content":" World"}}]}\n\n'),
      encoder.encode('data: [DONE]\n\n'),
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn(() => 'text/event-stream'),
      },
      body: {
        getReader: () => ({
          read: jest
            .fn()
            .mockResolvedValueOnce({ value: chunks[0], done: false })
            .mockResolvedValueOnce({ value: chunks[1], done: false })
            .mockResolvedValueOnce({ value: chunks[2], done: false })
            .mockResolvedValueOnce({ value: undefined, done: true }),
        }),
      },
    });

    await expect(debugModelStream({ onDelta })).resolves.toEqual({
      code: 0,
      data: {
        output: 'Hello World',
        success: true,
      },
    });
    expect(onDelta).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onDelta).toHaveBeenNthCalledWith(2, ' World');
  });

  it('debugModelStream falls back to success payload when stream reader is missing', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      headers: {
        get: jest.fn(() => 'text/event-stream'),
      },
      body: {},
    });

    await expect(debugModelStream({})).resolves.toEqual({
      code: 0,
      data: {
        output: '',
        success: true,
      },
    });
  });
});
