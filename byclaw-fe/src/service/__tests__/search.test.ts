import { findAll, findUser, getUserSuas } from '../search';
import { GET, POST } from '@/service/common/request';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockGET = GET as jest.Mock;
const mockPOST = POST as jest.Mock;

describe('Search Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should call POST with correct endpoint and params', () => {
      const params = { keyword: 'test', type: 'all' };
      findAll(params);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/find', params);
    });

    it('should call POST with empty object when no params provided', () => {
      findAll({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/find', {});
    });

    it('should call POST with different params', () => {
      const params = { keyword: 'user', type: 'digit', pageNum: 1 };
      findAll(params);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/find', params);
    });
  });

  describe('findUser', () => {
    it('should call POST with correct endpoint and params', () => {
      const params = { keyword: 'john', orgId: 'org123' };
      findUser(params);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/auth/privilegeGrant/findUser', params);
    });

    it('should call POST with multiple params', () => {
      const param1 = { keyword: 'john' };
      const param2 = { orgId: 'org123' };
      findUser(param1, param2);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/auth/privilegeGrant/findUser', param1, param2);
    });

    it('should call POST with empty params', () => {
      findUser();
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/auth/privilegeGrant/findUser');
    });
  });

  describe('getUserSuas', () => {
    it('should call GET with correct endpoint and userId', () => {
      const params = { userId: 'user123' };
      getUserSuas(params);
      expect(mockGET).toHaveBeenCalledWith('/byaiService/assiman/getUserSuas?userId=user123');
    });

    it('should call GET with different userId', () => {
      const params = { userId: 'user456' };
      getUserSuas(params);
      expect(mockGET).toHaveBeenCalledWith('/byaiService/assiman/getUserSuas?userId=user456');
    });

    it('should call GET with additional params', () => {
      const params = { userId: 'user789', includeDetails: true };
      getUserSuas(params);
      expect(mockGET).toHaveBeenCalledWith('/byaiService/assiman/getUserSuas?userId=user789');
    });
  });
});
