import { listTasksByPage, createTaskConversation, updateTask, updateResCom, approveTask } from '../task';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('Task Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listTasksByPage', () => {
    it('should call POST with correct endpoint, data and queryOpt', () => {
      const data = { pageNum: 1, pageSize: 10 };
      const queryOpt = { timeout: 5000 };

      listTasksByPage(data, queryOpt);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/listTasksByPage', data, queryOpt);
    });

    it('should call POST with empty queryOpt when not provided', () => {
      const data = { pageNum: 1, pageSize: 10 };

      listTasksByPage(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/listTasksByPage', data, {});
    });
  });

  describe('createTaskConversation', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { taskId: 'task123', conversationId: 'conv456' };

      createTaskConversation(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/createTaskConversation', data);
    });
  });

  describe('updateTask', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { taskId: 'task123', status: 'completed' };

      updateTask(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/updateTask', data);
    });
  });

  describe('updateResCom', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { resourceId: 'res123', componentId: 'comp456', data: 'new data' };

      updateResCom(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/updateResCom', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      updateResCom();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/updateResCom', {});
    });
  });

  describe('approveTask', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { taskId: 'task123', approved: true, comment: 'Approved' };

      approveTask(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/approveTask', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      approveTask();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/approveTask', {});
    });
  });
});
