import { useEffect } from 'react';
import { isEqual } from 'lodash';
import { useDispatch, useSelector } from '@umijs/max';

import { subscribeChatStream } from '@/hooks/useSseSender/chatStream';
import { clearChatRuntime, handleChatStreamError, handleParsedChatStream } from '@/hooks/useChat/chatRuntime';
import webSocketManager from '@/utils/websocket';

import type { ISession } from '@/typescript/session';

type State = {
  user: {
    userInfo?: {
      userId?: string | number;
    };
  };
};

type INotificationMessage = { session?: ISession; data?: { session?: ISession } };

let lastNotificationInfo: INotificationMessage | null = null;
export default function useGlobalChatRuntime() {
  const dispatch = useDispatch();
  const userInfo = useSelector((state: State) => state.user.userInfo);

  const userId = userInfo?.userId;

  useEffect(() => {
    if (!userId) {
      webSocketManager.disconnect();
      clearChatRuntime();
      return;
    }

    webSocketManager.init();

    return () => {
      webSocketManager.disconnect();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const unsubscribeChatStream = subscribeChatStream({
      match: () => true,
      onPayload: handleParsedChatStream,
    });

    const handleNotification = (message: INotificationMessage) => {
      const isSame = isEqual(lastNotificationInfo, message); // 幂等校验
      if (isSame) {
        return;
      }
      lastNotificationInfo = message;

      const session = message.session || message.data?.session;
      if (!session || `${userId}` !== `${session.creatorId}` || isSame) {
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

    webSocketManager.onMessage('ERROR', handleChatStreamError);
    webSocketManager.onMessage('NOTIFICATION', handleNotification);

    return () => {
      unsubscribeChatStream();
      webSocketManager.offMessage('ERROR', handleChatStreamError);
      webSocketManager.offMessage('NOTIFICATION', handleNotification);
    };
  }, [dispatch, userId]);
}
