import { getUsersByOrgId } from '../memberMgr';
import { POST } from '@/service/common/request';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockPOST = POST as jest.Mock;

describe('Member Manager Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUsersByOrgId', () => {
    it('should call POST with correct endpoint and params', async () => {
      const params = { orgId: 'org123', pageNum: 1, pageSize: 10 };
      await getUsersByOrgId(params);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/user/getUsersByOrgId', params);
    });

    it('should call POST with empty object when no params provided', async () => {
      await getUsersByOrgId({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/user/getUsersByOrgId', {});
    });

    it('should call POST with different orgId', async () => {
      const params = { orgId: 'org456', pageNum: 1, pageSize: 20 };
      await getUsersByOrgId(params);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/user/getUsersByOrgId', params);
    });

    it('should return the result from POST call', async () => {
      const mockResult = { success: true, data: [{ id: 1, name: 'User1' }] };
      mockPOST.mockResolvedValue(mockResult);

      const params = { orgId: 'org123' };
      const result = await getUsersByOrgId(params);

      expect(result).toEqual(mockResult);
    });
  });
});
