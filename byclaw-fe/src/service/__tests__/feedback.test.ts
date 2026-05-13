import { sendFeedback, uploadFeedbackFile } from '../feedback';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('Feedback Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendFeedback', () => {
    it('should call POST with correct endpoint and data', () => {
      const data = {
        content: 'This is feedback',
        type: 'bug',
        userId: 'user123',
      };

      sendFeedback(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/feedback/save', data, {
        responseCfg: {
          customHandle: true,
        },
      });
    });
  });

  describe('uploadFeedbackFile', () => {
    it('should call POST with correct endpoint, data and config', () => {
      const data = new FormData();
      data.append('file', 'feedback.txt');

      uploadFeedbackFile(data);

      expect(mockPOST).toHaveBeenCalledWith('/byaiService/system/feedback/uploadFeedbackFile', data, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        responseCfg: {
          customHandle: true,
        },
      });
    });
  });
});
