jest.mock('antd', () => ({
  message: {
    error: jest.fn(),
  },
}));

jest.mock('@/pages/manager/service/ModelMgr', () => ({
  debugModelStream: jest.fn(),
  deleteModel: jest.fn(),
  getModelDetail: jest.fn(),
  getModelListByPage: jest.fn(),
  setModelStatus: jest.fn(),
  upsertModel: jest.fn(),
}));

import { getErrorText, unwrapResponse } from '../modelMgr';

describe('manager/models/modelMgr', () => {
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
});
