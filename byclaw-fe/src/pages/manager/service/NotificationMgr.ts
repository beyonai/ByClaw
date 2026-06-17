import { POST } from '@/service/common/request';

export const BIZ_TYPE_SYSTEM = 0;
export const BIZ_TYPE_VERSION = 2;

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export function buildNotificationPayload(params: {
  values: any;
  bizType: number;
  isVersion: boolean;
  id?: string | number;
}) {
  const { values, bizType, isVersion, id } = params;
  if (isVersion) {
    return {
      id,
      bizType,
      title: values.title,
      content: values.content,
      extraInfo: values.versionNo,
    };
  }

  return {
    id,
    bizType,
    title: values.title,
    content: values.content,
    priority: values.priority,
    expireTime: values.expireTime?.format ? values.expireTime.format('YYYY-MM-DD HH:mm:ss') : values.expireTime,
  };
}

export async function queryNotificationPage(params: any) {
  return POST('/byaiService/notification/manage/page', { ...params }, withCustomHandle);
}

export async function querySystemNotificationPage(params: any) {
  return queryNotificationPage({
    ...params,
    bizType: BIZ_TYPE_SYSTEM,
  });
}

export async function getNotificationDetail(params: { id: string | number }) {
  return POST('/byaiService/notification/manage/detail', { ...params }, withCustomHandle);
}

export async function getLatestVersionNotification() {
  return POST<any>(
    '/byaiService/notification/version/latest',
    {},
    {
      responseCfg: {
        customHandle: true,
        priority: 'low',
      },
    }
  );
}

export async function createNotification(params: any) {
  return POST('/byaiService/notification/manage/create', { ...params }, withCustomHandle);
}

export async function updateNotification(params: any) {
  return POST('/byaiService/notification/manage/update', { ...params }, withCustomHandle);
}

export async function deleteNotification(params: { id: string | number }) {
  return POST('/byaiService/notification/manage/delete', { ...params }, withCustomHandle);
}
