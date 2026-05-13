import { submitForm, toApproveForm, getAgentListByPage, validateTask } from '../agent';
import { GET, POST } from '@/service/common/request';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockGET = GET as jest.Mock;
const mockPOST = POST as jest.Mock;

describe('Agent Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('submitForm', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { formId: 'form1', data: { name: 'test' } };
      submitForm(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/submitForm', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      submitForm({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/submitForm', {});
    });
  });
  describe('toApproveForm', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { formId: 'form1', approved: true };
      toApproveForm(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/api/v1/employeeApply/approve', payload, {});
    });

    it('should call POST with cancelToken', () => {
      const payload = { formId: 'form1', approved: true };
      const cancelToken = new AbortController();
      toApproveForm(payload, cancelToken);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/api/v1/employeeApply/approve', payload, {
        cancelToken,
      });
    });

    it('should call POST with empty object when no payload provided', () => {
      toApproveForm({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/api/v1/employeeApply/approve', {}, {});
    });
  });

  describe('getAgentListByPage', () => {
    it('should call GET with correct endpoint and payload', () => {
      const payload = { pageNum: 1, pageSize: 10 };
      getAgentListByPage(payload);
      expect(mockGET).toHaveBeenCalledWith('/byaiService/api/v1/digitEmploy/canChatPage', payload, {});
    });

    it('should call GET with cancelToken', () => {
      const payload = { pageNum: 1, pageSize: 10 };
      const cancelToken = new AbortController();
      getAgentListByPage(payload, cancelToken);
      expect(mockGET).toHaveBeenCalledWith('/byaiService/api/v1/digitEmploy/canChatPage', payload, {
        cancelToken,
      });
    });

    it('should call GET with empty object when no payload provided', () => {
      getAgentListByPage({});
      expect(mockGET).toHaveBeenCalledWith('/byaiService/api/v1/digitEmploy/canChatPage', {}, {});
    });
  });

  describe('validateTask', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { taskId: 'task1', validation: 'valid' };
      validateTask(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/validateTask', payload, {});
    });

    it('should call POST with cancelToken', () => {
      const payload = { taskId: 'task1', validation: 'valid' };
      const cancelToken = new AbortController();
      validateTask(payload, cancelToken);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/validateTask', payload, { cancelToken });
    });

    it('should call POST with empty object when no payload provided', () => {
      validateTask({});
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/validateTask', {}, {});
    });
  });
});
