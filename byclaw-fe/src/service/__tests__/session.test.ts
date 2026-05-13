import { batchReadMessages, addForwardMessage, getTemplateSessionDetail } from '../session';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('Session Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('batchReadMessages', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { messageIds: ['msg1', 'msg2'], sessionId: 'session123' };

      batchReadMessages(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/batchReadMessages', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      batchReadMessages();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/batchReadMessages', {});
    });
  });

  describe('addForwardMessage', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = {
        originalMessageId: 'msg123',
        targetSessionId: 'session456',
        content: 'Forwarded message',
      };

      addForwardMessage(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/addForwardMessage', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      addForwardMessage();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/group/addForwardMessage', {});
    });
  });

  describe('getTemplateSessionDetail', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { templateId: 'template123', sessionId: 'session456' };

      getTemplateSessionDetail(payload);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/api/v1/template-sessions/getTemplateSessionDetail', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      getTemplateSessionDetail();

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/api/v1/template-sessions/getTemplateSessionDetail', {});
    });
  });
});
