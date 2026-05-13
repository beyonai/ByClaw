import { themes } from '@/constants/theme';
import { size, omit } from 'lodash';
import { getRandomNumber } from '@/utils/math';

import type { ISessionState } from '@/models/session';
import type { ISession } from '@/typescript/session';

export const formatByUpdateTime = (sessionList: ISession[]) => {
  return sessionList.sort((a, b) => {
    return Number(b.updateTime) - Number(a.updateTime);
  });
};

export const updateSessionHandler = (state: ISessionState, newSession: ISession) => {
  const { sessionList } = state;

  const newState: any = {};

  const sessionTarget = sessionList.find((item) => `${item.sessionId}` === `${newSession.sessionId}`);
  if (sessionTarget) {
    Object.assign(sessionTarget, newSession);
    newState.sessionList = formatByUpdateTime([...sessionList]);
  }

  return { ...state, ...newState };
};

export const formatSessionName = (item: ISession) => {
  return item.sessionName;
};

const SESSION_OBJECT_MAP: Record<string, { objectId: string; objectType: string }> = {};

export const setSessionObjectTypeMap = (sessionId: string, objectId: number | string, objectType: string) => {
  SESSION_OBJECT_MAP[sessionId] = {
    objectType,
    objectId: `${objectId}`,
  };
};

export const getSessionObjectTypeMap = (sessionId: string) => {
  return SESSION_OBJECT_MAP[sessionId];
};

export const sessionHandler = (item: ISession, targetList?: ISession[]) => {
  const payload = {
    ...item,
    sessionId: `${item.sessionId || ''}`,
    avatar: item.avatar ? item.avatar : 'beyond/session.png',
    theme: item.avatar ? undefined : themes[getRandomNumber(0, size(themes) - 1)],
    sessionName: formatSessionName(item),
  };

  if (item.objectType === 'Notification') {
    Object.assign(payload, {
      ...item,
      avatar: 'beyond/noticeHead.png',
    });
  }

  if (item.objectId && item.objectType) {
    setSessionObjectTypeMap(item.sessionId, item.objectId, item.objectType);
  }

  const hasSession = targetList?.find((item) => `${item?.sessionId}` === `${payload?.sessionId}`);
  if (hasSession) {
    Object.assign(hasSession, { ...omit(payload, ['theme']) });
    return hasSession;
  }

  return payload;
};

export const addSessionHandler = (state: ISessionState, newSession: Omit<ISession, 'updateTime'>) => {
  const mySession = sessionHandler(
    {
      updateTime: `${Date.now()}`,
      ...newSession,
      sessionName: newSession.sessionName || 'New Chat',
    },
    state.sessionList
  );

  const sessionList = [mySession, ...(state.sessionList || [])];

  const newState = {
    ...state,
    sessionList,
  };

  return newState;
};
