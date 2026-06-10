import { useCallback, useEffect, useMemo } from 'react';

import { useDispatch, useSelector } from '@umijs/max';

import { subscribeChatStream } from '@/hooks/useSseSender/chatStream';
import { getChatRunningStatus } from '@/service/message';
import {
  clearChatRuntime,
  handleChatStreamError,
  handleParsedChatStream,
  hydrateRunningSessions,
} from '@/hooks/useChat/chatRuntime';
import webSocketManager from '@/utils/websocket';

import type { RunningChatInfo } from '@/utils/chatSessionRuntimeManager';
import type { ISession } from '@/typescript/session';

type State = {
  user: {
    userInfo?: {
      userId?: string | number;
    };
  };
  session: {
    sessionList: ISession[];
  };
};

export default function useGlobalChatRuntime() {
  const dispatch = useDispatch();
  const { userInfo, sessionList } = useSelector((state: State) => ({
    userInfo: state.user.userInfo,
    sessionList: state.session.sessionList || [],
  }));

  const userId = userInfo?.userId;
  const sessionIds = useMemo(
    () =>
      sessionList
        .map((item) => item.sessionId)
        .filter(Boolean)
        .map((item) => `${item}`)
        .join(','),
    [sessionList]
  );

  const syncRunningStatus = useCallback(async () => {
    if (!userId || !sessionIds.length) {
      return;
    }

    try {
      const list: RunningChatInfo[] = await getChatRunningStatus({ sessionIds: sessionIds.split(',') });
      hydrateRunningSessions(list || []);
    } catch (error) {
      console.error(error);
    }
  }, [sessionIds, userId]);

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

    const handleNotification = (message: { session?: ISession; data?: { session?: ISession } }) => {
      const session = message.session || message.data?.session;
      if (!session || `${userId}` !== `${session.creatorId}`) {
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

  useEffect(() => {
    syncRunningStatus();
  }, [syncRunningStatus]);

  // useEffect(() => {
  //   if (!userId) {
  //     return;
  //   }

  //   const handleVisibilityChange = () => {
  //     if (document.visibilityState === 'visible') {
  //       syncRunningStatus();
  //     }
  //   };

  //   window.addEventListener('online', syncRunningStatus);
  //   document.addEventListener('visibilitychange', handleVisibilityChange);
  //   const timer = window.setInterval(syncRunningStatus, 30000);

  //   return () => {
  //     window.removeEventListener('online', syncRunningStatus);
  //     document.removeEventListener('visibilitychange', handleVisibilityChange);
  //     window.clearInterval(timer);
  //   };
  // }, [syncRunningStatus, userId]);
}
