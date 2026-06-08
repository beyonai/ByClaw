import { useEffect } from 'react';
import { useSelector, useDispatch } from '@umijs/max';

import webSocketManager from '@/utils/websocket';

const useNotification = () => {
  const dispatch = useDispatch();

  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));

  useEffect(() => {
    if (!userInfo) {
      return;
    }

    const handleNotification = (message: { session?: any; data?: { session?: any } }) => {
      const session = message.session || message.data?.session;
      if (!session) {
        return;
      }
      if (`${userInfo.userId}` !== `${session.creatorId}`) {
        return;
      }

      dispatch({
        type: 'session/updateUnreadInfo',
        payload: {
          totalUnread: 1,
        },
      });
      dispatch({
        type: 'session/addNotificationSession',
        payload: session,
      });
    };

    webSocketManager.onMessage('NOTIFICATION', handleNotification);

    return () => {
      webSocketManager.offMessage('NOTIFICATION', handleNotification);
    };
  }, [dispatch, userInfo]);
};

export default useNotification;
