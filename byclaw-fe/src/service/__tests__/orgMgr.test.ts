import { getOrgTree } from '../orgMgr';
import { POST } from '@/service/common/request';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockPOST = POST as jest.Mock;

describe('Organization Manager Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrgTree', () => {
    it('should call POST with correct endpoint and params', async () => {
      const params = { orgId: 'org123', includeChildren: true };
      await getOrgTree(params);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/organization/getOrgTree', params);
    });

    it('should call POST with empty object when no params provided', async () => {
      await getOrgTree({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/organization/getOrgTree', {});
    });

    it('should call POST with different params', async () => {
      const params = { orgId: 'org456', includeChildren: false, level: 2 };
      await getOrgTree(params);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/organization/getOrgTree', params);
    });

    it('should return the result from POST call', async () => {
      const mockResult = { success: true, data: [{ id: 1, name: 'Org1', children: [] }] };
      mockPOST.mockResolvedValue(mockResult);

      const params = { orgId: 'org123' };
      const result = await getOrgTree(params);

      expect(result).toEqual(mockResult);
    });
  });
});
