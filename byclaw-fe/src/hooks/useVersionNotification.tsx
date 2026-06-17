import React, { useCallback, useEffect } from 'react';
import { useSelector } from '@umijs/max';

import { NotificationContentComp } from '@/pages/chat/components/BottomContent/systemNotification';
import useAppStore from '@/models/common/useAppStore';

import type { IVersionNotification } from '@/typescript/version';

export const VERSION_NOTIFICATION_READ_IDS_STORAGE_KEY = 'byclaw.versionNotification.readIds';

const getReadVersionNotificationIds = () => {
  try {
    const ids = JSON.parse(localStorage.getItem(VERSION_NOTIFICATION_READ_IDS_STORAGE_KEY) || '[]');
    return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

export const hasReadVersionNotification = (id?: string | number | null) => {
  if (id === undefined || id === null || String(id) === '') {
    return false;
  }

  return getReadVersionNotificationIds().includes(String(id));
};

export const saveReadVersionNotificationId = (id?: string | number | null) => {
  if (id === undefined || id === null || String(id) === '') {
    return;
  }

  const nextId = String(id);
  const ids = getReadVersionNotificationIds();
  if (ids.includes(nextId)) {
    return;
  }

  localStorage.setItem(VERSION_NOTIFICATION_READ_IDS_STORAGE_KEY, JSON.stringify([...ids, nextId]));
};

function useVersionNotification(eventEmitter: any) {
  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));

  const { getVersionNotification } = useAppStore();

  const inputTipsList = useCallback(
    (info: IVersionNotification) => {
      const onClick = () => {
        saveReadVersionNotificationId(info.id);
        eventEmitter.emit('beyond-main-driver-open-type', {
          drawerType: <NotificationContentComp {...info} />,
          canClose: true,
          title: info.title,
        });
      };

      eventEmitter.emit('beyond-titlewriter-set-assistanttips', {
        tips: '点击查看版本详情',
        onClick,
      });
    },
    [eventEmitter]
  );

  useEffect(() => {
    if (userInfo) {
      getVersionNotification().then((res) => {
        if (res) {
          if (hasReadVersionNotification(res.id)) {
            return;
          }

          inputTipsList(res);
        }
      });
    }
  }, [userInfo]);
}

export default useVersionNotification;
