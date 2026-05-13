import {
  getMessages,
  updateMesFeedback as likeOrDislike,
  delMessage,
  getContentFeedbackType,
  getForwardMessage,
  findAssiman,
  createGroupChat,
  addMessage,
  getMessageState,
} from '../message';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

import { GET, POST } from '@/service/common/request';

const mockGET = GET as jest.MockedFunction<typeof GET>;
const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('Message Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMessages', () => {
    it('should call POST with correct parameters', () => {
      const payload = {
        sessionId: 'session123',
        pageNum: 1,
        pageSize: 10,
        messageId: 'msg123',
      };

      getMessages(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/getMessages', payload);
    });

    it('should call POST with minimal parameters', () => {
      const payload = {
        sessionId: 'session123',
      };

      getMessages(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/getMessages', payload);
    });
  });

  describe('likeOrDislike', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { messageId: 'msg123', action: 'like' };

      likeOrDislike(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/updateMesFeedback', data, {
        responseCfg: {
          customHandle: true,
        },
      });
    });
  });

  describe('delMessage', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = { messageId: 'msg123' };

      delMessage(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/deleteMessage', data);
    });
  });

  describe('getContentFeedbackType', () => {
    it('should call GET with correct endpoint', () => {
      getContentFeedbackType();

      expect(mockGET).toHaveBeenCalledWith('/byaiService/assiman/getContentFeedbackType');
    });
  });

  describe('getForwardMessage', () => {
    it('should call GET with messageId in URL', () => {
      const messageId = 'msg123';
      const cancelToken = new AbortController();

      getForwardMessage(messageId, cancelToken);

      expect(mockGET).toHaveBeenCalledWith(`/byaiService/assiman/getForwardMessage/${messageId}`, {}, { cancelToken });
    });

    it('should call GET without cancelToken', () => {
      const messageId = 'msg123';

      getForwardMessage(messageId);

      expect(mockGET).toHaveBeenCalledWith(
        `/byaiService/assiman/getForwardMessage/${messageId}`,
        {},
        { cancelToken: undefined }
      );
    });
  });

  describe('findAssiman', () => {
    it('should call POST with payload', () => {
      const payload = { query: 'test', type: 'employee' };

      findAssiman(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/find', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      findAssiman();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/assiman/find', {});
    });
  });

  describe('createGroupChat', () => {
    it('should call POST with payload', () => {
      const payload = { name: 'Test Group', members: ['user1', 'user2'] };

      createGroupChat(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/createGroupChat', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      createGroupChat();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/createGroupChat', {});
    });
  });

  describe('addMessage', () => {
    it('should call POST with payload', () => {
      const payload = { content: 'Hello', sessionId: 'session123' };

      addMessage(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/addMessage', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      addMessage();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/addMessage', {});
    });
  });

  describe('getMessageState', () => {
    it('should call POST with resComIds', () => {
      const payload = { resComIds: ['comp1', 'comp2'] };

      getMessageState(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/menTaskController/getResComList', payload);
    });
  });
});
