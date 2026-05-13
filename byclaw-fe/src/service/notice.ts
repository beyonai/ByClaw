import { POST } from '@/service/common/request';

// 获取所有通知 ----isRead: 0 未读，1 已读
export const getAllNotice = (payload = {}) =>
  POST<any>(
    '/byaiService/notification/getNotificationListByPage',
    {
      ...payload,
    },
    {
      responseCfg: {
        hideErrorTips: true,
      },
    }
  );

// 批量设置通知为已读
export const batchReadNotice = (payload = {}) =>
  POST<any>('/byaiService/notification/batchSetNotificationRead', {
    ...payload,
  });

// 分享
export const insertNotification = (payload = {}) =>
  POST<any>('/byaiService/notification/insertNotification', {
    ...payload,
  });
