import {
  getUserSuas,
  updateBySuperassistId,
  getUserResourcePrivileges,
  saveResourcePrivilege,
  getUserAllAvailableResources,
} from '../assistantSetting';
import { GET, POST } from '@/service/common/request';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockGET = GET as jest.Mock;
const mockPOST = POST as jest.Mock;

describe('Assistant Setting Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserSuas', () => {
    it('should call GET with correct endpoint and userId', () => {
      const payload = { userId: 'user123' };
      getUserSuas(payload);
      expect(mockGET).toHaveBeenCalledWith('/byaiService/assiman/getUserSuas?userId=user123');
    });

    it('should call GET with different userId', () => {
      const payload = { userId: 'user456' };
      getUserSuas(payload);
      expect(mockGET).toHaveBeenCalledWith('/byaiService/assiman/getUserSuas?userId=user456');
    });
  });

  describe('updateBySuperassistId', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { superassistId: 'assist1', settings: { theme: 'dark' } };
      updateBySuperassistId(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/updateBySuperassistId', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      updateBySuperassistId({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/updateBySuperassistId', {});
    });
  });

  describe('getUserResourcePrivileges', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { userId: 'user123', resourceType: 'document' };
      getUserResourcePrivileges(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/getUserSelectedResourcePrivileges', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      getUserResourcePrivileges({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/getUserSelectedResourcePrivileges', {});
    });
  });

  describe('saveResourcePrivilege', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { userId: 'user123', privileges: ['read', 'write'] };
      saveResourcePrivilege(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/saveResourcePrivilege', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      saveResourcePrivilege({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/saveResourcePrivilege', {});
    });
  });

  describe('getUserAllAvailableResources', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { userId: 'user123', resourceType: 'all' };
      getUserAllAvailableResources(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/getUserAllAvailableResources', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      getUserAllAvailableResources({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/getUserAllAvailableResources', {});
    });
  });
});
