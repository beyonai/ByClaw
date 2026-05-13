import { getAllNotice, batchReadNotice } from '../notice';
import { POST } from '@/service/common/request';

// Mock the request module
jest.mock('@/service/common/request', () => ({
  GET: jest.fn(),
  POST: jest.fn(),
}));

const mockPOST = POST as jest.Mock;

describe('Notice Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllNotice', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { pageNum: 1, pageSize: 10, isRead: 0 };
      getAllNotice(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/notification/getNotificationListByPage', payload, {
        responseCfg: {
          hideErrorTips: true,
        },
      });
    });

    it('should call POST with empty object when no payload provided', () => {
      getAllNotice();
      expect(mockPOST).toHaveBeenCalledWith(
        '/byaiService/notification/getNotificationListByPage',
        {},
        {
          responseCfg: {
            hideErrorTips: true,
          },
        }
      );
    });

    it('should call POST with different payload', () => {
      const payload = { pageNum: 2, pageSize: 20, isRead: 1 };
      getAllNotice(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/notification/getNotificationListByPage', payload, {
        responseCfg: {
          hideErrorTips: true,
        },
      });
    });
  });

  describe('batchReadNotice', () => {
    it('should call POST with correct endpoint and payload', () => {
      const payload = { noticeIds: ['notice1', 'notice2'] };
      batchReadNotice(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/notification/batchSetNotificationRead', payload);
    });

    it('should call POST with empty object when no payload provided', () => {
      batchReadNotice();
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/notification/batchSetNotificationRead', {});
    });

    it('should call POST with different payload', () => {
      const payload = { noticeIds: ['notice3', 'notice4', 'notice5'] };
      batchReadNotice(payload);
      expect(mockPOST).toHaveBeenCalledWith('/byaiService/notification/batchSetNotificationRead', payload);
    });
  });
});
