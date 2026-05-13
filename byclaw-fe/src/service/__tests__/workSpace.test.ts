import {
  listTasksBySessionPage,
  superAgentChat,
  getWorkSpaceFile,
  querySessionMembers,
  qryByClawFileByUserCode,
} from '../workSpace';
import { POST } from '@/service/common/request';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockPOST = POST as jest.Mock;

describe('Work Space Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listTasksBySessionPage', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = {
        sessionId: 'session123',
        taskType: 'todo',
        pageNum: 1,
        pageSize: 10,
      };
      listTasksBySessionPage(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/listTasksBySessionPage', data);
    });

    it('should call POST with minimal required data', () => {
      const data = { sessionId: 'session123' };
      listTasksBySessionPage(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/listTasksBySessionPage', data);
    });

    it('should call POST with different sessionId', () => {
      const data = { sessionId: 'session456', pageNum: 2 };
      listTasksBySessionPage(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/listTasksBySessionPage', data);
    });
  });

  describe('superAgentChat', () => {
    it('should call POST with correct endpoint and tags', () => {
      const tags = ['tag1', 'tag2', 'tag3'];
      superAgentChat(tags);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/superAgentChat', tags);
    });

    it('should call POST with empty tags array', () => {
      const tags: string[] = [];
      superAgentChat(tags);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/superAgentChat', tags);
    });

    it('should call POST with single tag', () => {
      const tags = ['single-tag'];
      superAgentChat(tags);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/chat/superAgentChat', tags);
    });
  });

  describe('getWorkSpaceFile', () => {
    it('should call POST with correct endpoint and tags', () => {
      const payload = { taskId: 'task1', sessionId: 'session1', fileName: 'report' };
      getWorkSpaceFile(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/resource/getTaskFileList', payload);
    });

    it('should call POST with minimal payload', () => {
      const payload = { taskId: 'task2', sessionId: 'session2' };
      getWorkSpaceFile(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/resource/getTaskFileList', payload);
    });

    it('should keep optional matchMode field', () => {
      const payload = { taskId: 'task3', sessionId: 'session3', matchMode: 'exact' };
      getWorkSpaceFile(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/resource/getTaskFileList', payload);
    });
  });

  describe('querySessionMembers', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = {
        sessionId: '123',
        pageNum: 1,
        pageSize: 20,
        memName: 'John',
      };
      querySessionMembers(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/querySessionMembers', {
        ...data,
        sessionId: 123,
      });
    });

    it('should call POST with numeric sessionId', () => {
      const data = {
        sessionId: 456,
        pageNum: 1,
        pageSize: 10,
      };
      querySessionMembers(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/querySessionMembers', {
        ...data,
        sessionId: 456,
      });
    });

    it('should call POST with minimal data', () => {
      const data = { sessionId: '789' };
      querySessionMembers(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/querySessionMembers', {
        ...data,
        sessionId: 789,
      });
    });

    it('should convert string sessionId to number', () => {
      const data = { sessionId: '999' };
      querySessionMembers(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/querySessionMembers', {
        sessionId: 999,
      });
    });
  });

  describe('qryByClawFileByUserCode', () => {
    it('should call POST with userCode, keyword and sessionId', () => {
      const data = {
        userCode: 'adminvip',
        keyword: '会议',
        sessionId: '10014538',
      };
      qryByClawFileByUserCode(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/tool/qryByClawFileByUserCode', data);
    });

    it('should allow querying with only sessionId and userCode', () => {
      const data = {
        userCode: 'adminvip',
        sessionId: '10014538',
      };
      qryByClawFileByUserCode(data);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/tool/qryByClawFileByUserCode', data);
    });
  });
});
