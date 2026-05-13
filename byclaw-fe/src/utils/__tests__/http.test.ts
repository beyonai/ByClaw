jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

import http from '../http';
import { GET, POST } from '@/service/common/request';

const mockGET = GET as jest.MockedFunction<typeof GET>;
const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('utils/http', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses POST by default and prefixes byaiService', () => {
    http('/system/test', { body: { a: 1 } }, { timeout: 1000 });

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/test', { a: 1 }, { timeout: 1000 });
  });

  it('does not duplicate byaiService prefix', () => {
    http('/byaiService/system/test', { body: { a: 1 } });

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/test', { a: 1 }, undefined);
  });

  it('uses GET when method is GET', () => {
    http('/catalog/list', { method: 'GET', body: { pageNum: 1 } }, { cancelToken: 'x' });

    expect(mockGET).toHaveBeenCalledWith('/byaiService/catalog/list', { pageNum: 1 }, { cancelToken: 'x' });
  });
});
