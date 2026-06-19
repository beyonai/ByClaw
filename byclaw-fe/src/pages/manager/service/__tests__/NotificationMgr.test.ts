jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import {
  BIZ_TYPE_SYSTEM,
  BIZ_TYPE_VERSION,
  buildNotificationPayload,
  createNotification,
  deleteNotification,
  getNotificationDetail,
  getLatestVersionNotification,
  querySystemNotificationPage,
  queryNotificationPage,
  updateNotification,
} from '../NotificationMgr';
import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('manager/service/NotificationMgr', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queryNotificationPage posts query with customHandle config', () => {
    const payload = { pageNum: 1, pageSize: 10, bizType: 2 };
    queryNotificationPage(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/notification/manage/page', payload, {
      responseCfg: { customHandle: true },
    });
  });

  it('querySystemNotificationPage posts system notification query with customHandle config', () => {
    querySystemNotificationPage({ pageNum: 2, pageSize: 12 });
    expect(mockPOST).toHaveBeenCalledWith(
      '/byaiService/notification/manage/page',
      { pageNum: 2, pageSize: 12, bizType: BIZ_TYPE_SYSTEM },
      {
        responseCfg: { customHandle: true },
      }
    );
  });

  it('createNotification posts payload with customHandle config', () => {
    const payload = { title: 'v1.0.0', content: '# Release', bizType: 2 };
    createNotification(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/notification/manage/create', payload, {
      responseCfg: { customHandle: true },
    });
  });

  it('updateNotification posts payload with customHandle config', () => {
    const payload = { id: '1001', title: 'System', content: 'Notice', bizType: 0 };
    updateNotification(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/notification/manage/update', payload, {
      responseCfg: { customHandle: true },
    });
  });

  it('deleteNotification posts id with customHandle config', () => {
    const payload = { id: '1001' };
    deleteNotification(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/notification/manage/delete', payload, {
      responseCfg: { customHandle: true },
    });
  });

  it('getNotificationDetail posts id with customHandle config', () => {
    const payload = { id: '1001' };
    getNotificationDetail(payload);
    expect(mockPOST).toHaveBeenCalledWith('/byaiService/notification/manage/detail', payload, {
      responseCfg: { customHandle: true },
    });
  });

  it('getLatestVersionNotification posts empty payload with customHandle config', () => {
    getLatestVersionNotification();
    expect(mockPOST).toHaveBeenCalledWith(
      '/byaiService/notification/version/latest',
      {},
      {
        responseCfg: { customHandle: true, priority: 'low' },
      }
    );
  });

  it('buildNotificationPayload stores version number in version notification extraInfo', () => {
    const payload = buildNotificationPayload({
      id: '1001',
      bizType: BIZ_TYPE_VERSION,
      isVersion: true,
      values: {
        title: 'v1.0.0',
        content: '# Release',
        versionNo: '1.0.0',
        priority: 4,
        targetId: 2001,
        sendToChat: true,
        extraInfo: '{"ignored":true}',
      },
    });

    expect(payload).toEqual({
      id: '1001',
      bizType: BIZ_TYPE_VERSION,
      title: 'v1.0.0',
      content: '# Release',
      extraInfo: '1.0.0',
    });
  });

  it('buildNotificationPayload excludes unused system notification fields', () => {
    const payload = buildNotificationPayload({
      id: '1002',
      bizType: BIZ_TYPE_SYSTEM,
      isVersion: false,
      values: {
        title: '系统通知',
        content: '通知内容',
        priority: 3,
        expireTime: '2026-06-16 12:00:00',
        targetId: 2001,
        sendToChat: true,
        resourceBizType: 'agent',
        resourceId: 3001,
        extraInfo: '{"ignored":true}',
      },
    });

    expect(payload).toEqual({
      id: '1002',
      bizType: BIZ_TYPE_SYSTEM,
      title: '系统通知',
      content: '通知内容',
      priority: 3,
      expireTime: '2026-06-16 12:00:00',
    });
  });
});
