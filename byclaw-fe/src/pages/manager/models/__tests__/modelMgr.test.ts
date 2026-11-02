jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
  },
}));

jest.mock('@umijs/max', () => ({
  getIntl: () => ({
    formatMessage: ({ id }: { id: string }) => {
      const messages: Record<string, string> = {
        'modelMgr.error.requestFail': '请求失败',
      };
      return messages[id] || id;
    },
  }),
}));

jest.mock('@/pages/manager/service/ModelMgr', () => ({
  debugModelImageGeneration: jest.fn(),
  debugModelAsr: jest.fn(),
  debugModelTts: jest.fn(),
  debugModelStream: jest.fn(),
  deleteModel: jest.fn(),
  getModelDetail: jest.fn(),
  getModelListByPage: jest.fn(),
  setDefaultModel: jest.fn(),
  setModelStatus: jest.fn(),
  upsertModel: jest.fn(),
}));

import { debugModelImageGeneration, debugModelAsr, debugModelTts } from '@/pages/manager/service/ModelMgr';
import { message } from 'antd';
import modelMgrModel, { getErrorText, unwrapResponse } from '../modelMgr';

describe('manager/models/modelMgr', () => {
  const effects = (modelMgrModel as any).effects;
  const sagaHelpers = {
    call: (fn: any, ...args: any[]) => ({ type: 'call', fn, args }),
  };

  it.each([
    { code: -1, success: false, msg: 'upstream failed' },
    { code: 50010, msg: 'upstream failed' },
    { code: 0, success: false, msg: 'upstream failed' },
  ])('never resolves a failed LLM debug result through the success callback', (response) => {
    const success = jest.fn();
    const fail = jest.fn();
    const iterator = effects.debugModel({ payload: { id: '42' }, success, fail }, sagaHelpers);
    iterator.next();
    iterator.next(response);
    expect(success).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(response);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['debugModelAsr', debugModelAsr, { text: '识别结果' }],
    ['debugModelTts', debugModelTts, { format: 'mp3', byteLength: 2048 }],
  ])('%s exposes structured speech debug results', (effect, service, data) => {
    const success = jest.fn();
    const payload = { id: '42', input: '{}' };
    const iterator = effects[effect]({ payload, success }, sagaHelpers);
    expect(iterator.next().value).toEqual({ type: 'call', fn: service, args: [payload] });
    iterator.next({ code: 0, data });
    expect(success).toHaveBeenCalledWith({ output: JSON.stringify(data, null, 2) });
  });

  describe('unwrapResponse', () => {
    it('returns response objects with a code as-is', () => {
      const response = { code: 500, msg: 'failed' };
      expect(unwrapResponse(response)).toBe(response);
    });

    it('wraps plain values as successful responses', () => {
      expect(unwrapResponse({ rows: [] })).toEqual({ code: 0, data: { rows: [] } });
      expect(unwrapResponse('ok')).toEqual({ code: 0, data: 'ok' });
    });
  });

  describe('getErrorText', () => {
    it('returns default message for falsy errors', () => {
      expect(getErrorText(null)).toBe('请求失败');
      expect(getErrorText(undefined)).toBe('请求失败');
    });

    it('returns string errors directly', () => {
      expect(getErrorText('network error')).toBe('network error');
    });

    it('prefers msg over message fields', () => {
      expect(getErrorText({ msg: 'from msg', message: 'from message' })).toBe('from msg');
      expect(getErrorText({ message: 'from message' })).toBe('from message');
    });

    it('falls back to default message for unknown objects', () => {
      expect(getErrorText({ code: 500 })).toBe('请求失败');
    });
  });

  it('debugModelImageGeneration calls the image service and exposes JSON output to the debug panel', () => {
    const success = jest.fn();
    const payload = { id: 'image-model-1', input: '{"prompt":"whale"}' };
    const iterator = effects.debugModelImageGeneration({ payload, success }, sagaHelpers);

    expect(iterator.next().value).toEqual({
      type: 'call',
      fn: debugModelImageGeneration,
      args: [payload],
    });

    expect(
      iterator.next({
        code: 0,
        data: {
          base_resp: { status_code: 0 },
          data: { image_urls: ['https://example.test/whale.png'] },
        },
      })
    ).toEqual({ value: undefined, done: true });
    expect(success).toHaveBeenCalledWith({
      output: JSON.stringify(
        {
          base_resp: { status_code: 0 },
          data: { image_urls: ['https://example.test/whale.png'] },
        },
        null,
        2
      ),
    });
  });

  it('debugModelImageGeneration rejects retryable backend failures instead of resolving dispatchWithResult', () => {
    const success = jest.fn();
    const fail = jest.fn();
    const payload = { id: 'image-model-1', input: '{"param":{"prompt":"whale"}}' };
    const iterator = effects.debugModelImageGeneration({ payload, success, fail }, sagaHelpers);
    const response = { code: 50010, msg: 'upstream failed' };

    iterator.next();
    expect(iterator.next(response)).toEqual({ value: undefined, done: true });

    expect(success).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(response);
    expect(message.error).toHaveBeenCalledWith('upstream failed');
  });

  it('debugModelImageGeneration rejects thrown request errors', () => {
    const success = jest.fn();
    const fail = jest.fn();
    const iterator = effects.debugModelImageGeneration({ payload: {}, success, fail }, sagaHelpers);

    iterator.next();
    expect(iterator.throw(new Error('request aborted'))).toEqual({ value: undefined, done: true });

    expect(success).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith({ msg: 'request aborted' });
    expect(message.error).toHaveBeenCalledWith('request aborted');
  });

  it('rejects an aborted image request without showing an error toast', () => {
    const fail = jest.fn();
    const controller = new AbortController();
    const iterator = effects.debugModelImageGeneration({ payload: { signal: controller.signal }, fail }, sagaHelpers);

    iterator.next();
    controller.abort();
    expect(iterator.throw(new Error('request aborted'))).toEqual({ value: undefined, done: true });

    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ msg: 'request aborted' }));
    expect(message.error).not.toHaveBeenCalled();
  });

  it('rejects an Axios-canceled image request without showing an error toast', () => {
    const fail = jest.fn();
    const iterator = effects.debugModelImageGeneration({ payload: {}, fail }, sagaHelpers);
    const error = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' });

    iterator.next();
    expect(iterator.throw(error)).toEqual({ value: undefined, done: true });

    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ msg: 'canceled' }));
    expect(message.error).not.toHaveBeenCalled();
  });

  it('does not toast when an image error response races with modal cancellation', () => {
    const fail = jest.fn();
    const controller = new AbortController();
    const iterator = effects.debugModelImageGeneration({ payload: { signal: controller.signal }, fail }, sagaHelpers);
    const response = { code: 500, msg: 'upstream failed after cancel' };

    iterator.next();
    controller.abort();
    expect(iterator.next(response)).toEqual({ value: undefined, done: true });

    expect(fail).toHaveBeenCalledWith(response);
    expect(message.error).not.toHaveBeenCalled();
  });
});
