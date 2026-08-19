import { themes } from '@/constants/theme';
import { size, omit } from 'lodash';

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

/** 通知会话由通知中心负责展示，不应进入普通聊天交互。 */
export const isNotificationSession = (session?: Pick<ISession, 'objectType'> | null) =>
  `${session?.objectType || ''}`.toLowerCase() === 'notification';

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

const getSessionTheme = (sessionId?: string | number) => {
  const themeCount = size(themes);
  if (!themeCount) return undefined;
  // 同一会话会被列表和详情分别标准化，默认主题色必须由会话 ID 稳定计算。
  const themeIndex = Array.from(`${sessionId || ''}`).reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    0
  );
  return themes[themeIndex % themeCount];
};

export const sessionHandler = (item: ISession, targetList?: ISession[]) => {
  const payload = {
    ...item,
    sessionId: `${item.sessionId || ''}`,
    avatar: item.avatar ? item.avatar : 'beyond/session.png',
    theme: item.avatar ? undefined : getSessionTheme(item.sessionId),
    sessionName: formatSessionName(item),
  };

  if (isNotificationSession(item)) {
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

/**
 * 会话第一页请求期间可能收到 createSession 事件，接口返回后需要保留这批本地新增会话，
 * 避免首次进入系统时列表响应覆盖刚发起的新聊天。
 */
export const getSessionsCreatedDuringRequest = (
  sessionsAtRequestStart: ISession[] = [],
  currentSessions: ISession[] = [],
  responseSessions: ISession[] = []
) => {
  const initialSessionIds = new Set(sessionsAtRequestStart.map((session) => `${session.sessionId}`));
  const responseSessionIds = new Set(responseSessions.map((session) => `${session.sessionId}`));

  return currentSessions.filter((session) => {
    const sessionId = `${session.sessionId}`;
    return !initialSessionIds.has(sessionId) && !responseSessionIds.has(sessionId);
  });
};
