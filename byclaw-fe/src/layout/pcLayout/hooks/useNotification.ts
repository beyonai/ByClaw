import { useEffect } from 'react';
import { useSelector, useDispatch } from '@umijs/max';

import { noop } from 'lodash';

import webSocketManager from '@/utils/websocket';

const useNotification = () => {
  const dispatch = useDispatch();

  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));

  // WebSocket 连接管理
  useEffect(() => {
    const onNotificationChange = (hasNotification: boolean) => {
      dispatch({
        type: 'session/updateUnreadInfo',
        payload: {
          totalUnread: Number(!!hasNotification),
        },
      });
    };

    const handleNewSession = (session: any) => {
      if (`${userInfo.userId}` !== `${session.creatorId}`) {
        return;
      }

      // 调用addSession action，该action会自动处理会话的添加或更新
      dispatch({
        type: 'session/addNotificationSession',
        payload: session,
      });
    };

    if (userInfo) {
      // 设置红点状态变化回调
      webSocketManager.setOnNotificationChange(onNotificationChange);
      webSocketManager.setOnAddNotificationSessionCb(handleNewSession);

      // 初始化 WebSocket 连接
      webSocketManager.init();
    }

    return () => {
      // 清理 WebSocket 连接
      webSocketManager.setOnNotificationChange(noop);
      webSocketManager.setOnAddNotificationSessionCb(noop);
      webSocketManager.disconnect();
    };
  }, [userInfo]);
};

export default useNotification;
