import {
  getAllDigitalEmployees,
  queryMyCreatedAndSubscribedAgentsV2 as getAllEmployees,
  queryMyCreated as getMyEmployees,
  getDigitEmployDir,
  queryCatalogTree,
  getCompositeAppInfo,
  setDefaultDigitalEmployee,
} from '../digitalEmployees';
import { GET, POST } from '@/service/common/request';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockGET = GET as jest.Mock;
const mockPOST = POST as jest.Mock;

describe('Digital Employees Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllDigitalEmployees', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { pageNum: 1, pageSize: 10 };
      getAllDigitalEmployees(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/api/v1/digitEmploy/discover', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      getAllDigitalEmployees();
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/api/v1/digitEmploy/discover', {});
    });
  });

  describe('getAllEmployees', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { userId: 'user123', pageNum: 1 };
      getAllEmployees(payload);
      expect(mockPOST).toHaveBeenCalledWith(
        '/byaiService/api/v2/digitEmploy/queryMyCreatedAndSubscribedAgents',
        payload,
        {
          cancelToken: undefined,
        }
      );
    });

    it('should call POST with cancelToken', () => {
      const payload = { userId: 'user123', pageNum: 1 };
      const cancelToken = new AbortController();
      getAllEmployees(payload, cancelToken);
      expect(mockPOST).toHaveBeenCalledWith(
        '/byaiService/api/v2/digitEmploy/queryMyCreatedAndSubscribedAgents',
        payload,
        {
          cancelToken,
        }
      );
    });

    it('should call POST with empty object when no payload provided', () => {
      getAllEmployees();
      expect(mockPOST).toHaveBeenCalledWith(
        '/byaiService/api/v2/digitEmploy/queryMyCreatedAndSubscribedAgents',
        {},
        {
          cancelToken: undefined,
        }
      );
    });
  });

  describe('getMyEmployees', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { userId: 'user123', pageNum: 1, pageSize: 10 };
      getMyEmployees(payload);
      expect(mockPOST).toHaveBeenCalledWith(
        '/byaiService/auth/privilegeGrant/queryPersonalDigitalEmployeeList',
        payload,
        {
          cancelToken: undefined,
        }
      );
    });

    it('should call POST with cancelToken', () => {
      const payload = { userId: 'user123', pageNum: 1, pageSize: 10 };
      const cancelToken = new AbortController();
      getMyEmployees(payload, cancelToken);
      expect(mockPOST).toHaveBeenCalledWith(
        '/byaiService/auth/privilegeGrant/queryPersonalDigitalEmployeeList',
        payload,
        {
          cancelToken,
        }
      );
    });

    it('should call POST with empty object when no payload provided', () => {
      getMyEmployees({});
      expect(mockPOST).toHaveBeenCalledWith(
        '/byaiService/auth/privilegeGrant/queryPersonalDigitalEmployeeList',
        {},
        {
          cancelToken: undefined,
        }
      );
    });
  });

  describe('getDigitEmployDir', () => {
    it('should call GET with correct endpoint and payload', () => {
      const payload = { type: 'all', status: 'active' };
      getDigitEmployDir(payload);
      expect(mockGET).toHaveBeenCalledWith('/byaiService/api/v1/digitEmployDir/all', payload);
    });

    it('should call GET with empty object when no payload provided', () => {
      getDigitEmployDir();
      expect(mockGET).toHaveBeenCalledWith('/byaiService/api/v1/digitEmployDir/all', {});
    });
  });

  describe('queryCatalogTree', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { catalogType: 1, parentId: 'parent1' };
      queryCatalogTree(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/digitalEmployeeController/queryCatalogTree', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      queryCatalogTree();
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/digitalEmployeeController/queryCatalogTree', {});
    });
  });

  describe('getCompositeAppInfo', () => {
    it('should call the details endpoint when resourceId exists', async () => {
      const params = { resourceId: 'agent1', extra: 'ignored' };
      await getCompositeAppInfo(params);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/digitalEmployeeController/findDetailsById', {
        resourceId: 'agent1',
      });
    });

    it('should fall back to the generic info endpoint when resourceId is absent', async () => {
      const params = { pageNum: 1 };
      await getCompositeAppInfo(params);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/api/v1/digitEmploy/getCompositeAppInfo', params);
    });

    it('should return the result from POST call', async () => {
      const mockResult = { success: true, data: { resourceId: 'agent1' } };
      mockPOST.mockResolvedValue(mockResult);

      const params = { id: 'agent1' };
      const result = await getCompositeAppInfo(params);

      expect(result).toEqual(mockResult);
    });
  });

  describe('setDefaultDigitalEmployee', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { resourceId: 'agent1' };
      setDefaultDigitalEmployee(payload);
      expect(mockPOST).toHaveBeenCalledWith(
        '/byaiService/digitalEmployeeController/setDefaultDigitalEmployee',
        payload
      );
    });
  });
});
