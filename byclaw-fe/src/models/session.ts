import { compact, get as getSafe, isEmpty, merge, size, get, set, findLast, max, isString } from 'lodash';
import type { Effect, Reducer } from '@umijs/max';

import { getSearchList, qryConversations, removeConversation, updateConversation } from '@/service/layout';
import type { ISession } from '@/typescript/session';
import { getDefaultPagination, type IPagination } from '@/utils/pageInfo';
import { batchReadMessages } from '@/service/session';
import { getDcSystemConfigListByStandType as fetchDcSystemConfigListByStandType } from '@/pages/manager/service/session';
import { IMessageState, SSEMessageType } from '@/constants/message';

import { addSessionHandler, updateSessionHandler, formatByUpdateTime, sessionHandler } from '@/utils/session';
import { IMessage } from '@/typescript/message';
import type { IFile } from '@/typescript/file';

export interface ISessionState {
  sessionLoading: boolean;
  editLoading: boolean;
  delLoading: boolean;
  extParamsBySessionId: Record<string, unknown>;
  nextSessionRawFileCache: Array<File>;
  nextSessionIFileCache: Array<IFile>;

  hasNotification: boolean;

  unreadInfo: {
    totalUnread: number;
  };

  sessionList: ISession[]; // 表示全部类型的会话列表
  pagination: IPagination; // 表示全部类型的分页
  allLastSearchKeyword: string;
}

export interface SessionModelType {
  namespace: 'session';
  state: ISessionState;
  effects: {
    querySessionList: Effect;
    editSession: Effect;
    deleteSession: Effect;
    getSearchList: Effect;
    getDcSystemConfigListByStandType: Effect;
  };
  reducers: {
    save: Reducer<ISessionState>;
    updateState: Reducer<ISessionState>;
    updateUnreadInfo: Reducer<ISessionState>;
    saveExtParamsBySessionId: Reducer<ISessionState>;
    addSession: Reducer<ISessionState>;
    addNotificationSession: Reducer<ISessionState>;
    updateSession: Reducer<ISessionState>;
    updateSessionContent: Reducer<ISessionState>;
    myBatchReadMessages: Reducer<ISessionState>;
  };
}

const getSessionId = (payload: { sessionId: string }) => {
  const sid = payload?.sessionId;
  if (!sid) return '';

  return sid;
};

const sessionModel: SessionModelType = {
  namespace: 'session',

  state: {
    sessionLoading: false,
    editLoading: false,
    delLoading: false,

    extParamsBySessionId: {},
    nextSessionRawFileCache: [],
    nextSessionIFileCache: [],

    hasNotification: false,
    unreadInfo: {
      totalUnread: 0,
    },

    sessionList: [],
    pagination: getDefaultPagination({ pageSize: 25 }),
    allLastSearchKeyword: '',
  },

  reducers: {
    updateState(state: ISessionState, { payload }: { payload: Partial<ISessionState> }) {
      return { ...state, ...payload };
    },
    save(state: ISessionState, action: { payload: Partial<ISessionState> }) {
      return {
        ...state,
        ...action.payload,
      };
    },

    updateUnreadInfo(state: ISessionState, { payload }: { payload: Partial<ISessionState['unreadInfo']> }) {
      return {
        ...state,
        unreadInfo: {
          ...state.unreadInfo,
          ...payload,
        },
      };
    },

    saveExtParamsBySessionId(state: ISessionState, { payload }: any) {
      const { extParams, opt } = payload;
      const sessionId = getSessionId(payload);

      const { extParamsBySessionId } = state;
      const { isMerge } = opt || {};

      return {
        ...state,
        extParamsBySessionId: {
          ...extParamsBySessionId,
          [sessionId]: isMerge ? merge(getSafe(extParamsBySessionId, sessionId), extParams) : extParams,
        },
      };
    },

    addSession(state: any, { payload }: any) {
      const newSession = payload;

      const { sessionId } = newSession;

      const sessionTarget = state.sessionList.find((item) => `${item.sessionId}` === `${sessionId}`);

      if (sessionTarget) {
        return {
          ...sessionTarget,
          ...state,
        };
      }

      return addSessionHandler(state, newSession);
    },

    addNotificationSession(state: any, { payload }: any) {
      const newSession = payload;

      const { sessionId } = newSession;

      const hasSession = state.sessionList.find((item) => `${item.sessionId}` === `${sessionId}`);

      if (hasSession) {
        // 如果会话存在，更新会话信息并将其顶到第一条
        return updateSessionHandler(state, {
          ...hasSession,
          ...newSession,
          unreadCount: 1,
        });
      }

      return addSessionHandler(state, newSession);
    },

    updateSession(state = { sessionList: [] }, { payload }) {
      const newSession = payload;

      const newState = updateSessionHandler(state, newSession);

      return newState;
    },

    myBatchReadMessages(state: any, { payload }: any): any {
      const { messageIds } = payload;
      const sessionId = getSessionId(payload);

      const { sessionList } = state;
      const allList = [...sessionList];

      const target = allList.find((session) => `${session.sessionId}` === `${sessionId}`);

      if (!target) return state;

      const hasUnread = Number(get(target, 'unreadCount')) > 0;
      if (!hasUnread) return state;

      set(target, 'unreadCount', 0);
      set(target, 'mentionCount', 0);
      const newState = updateSessionHandler(state, { ...target });

      if (!isEmpty(messageIds) && sessionId) {
        batchReadMessages({
          sessionId,
          messageIds,
        });
      }

      return newState;
    },
    updateSessionContent(state: any, { payload }: { payload: { sessionId: string; messageList: IMessage[] } }): any {
      const { sessionList } = state;
      const sessionId = getSessionId(payload);

      const targetSession = sessionList.find((item) => `${item.sessionId}` === `${sessionId}`);
      if (!targetSession) return state;

      const lastMessage = findLast(payload.messageList, (item) => item?.messageState === IMessageState.Done);
      if (!lastMessage) return state;

      const newSession = {
        ...targetSession,
      };

      const { text, messageList, createTime } = lastMessage;

      let sessionContent = text;
      if (!sessionContent) {
        const textComp = messageList?.find((item) => `${item?.contentType}` === `${SSEMessageType.text}`);
        try {
          const substance = get(textComp, 'content.substance') || '';
          if (isString(substance)) {
            sessionContent = substance;
          } else {
            sessionContent = JSON.stringify(substance);
          }
        } catch (e) {
          console.error(e);
        }
      }

      Object.assign(newSession, {
        sessionContent,
        updateTime: createTime,
      });

      const newState = updateSessionHandler(state, newSession);

      return newState;
    },
  },

  effects: {
    *querySessionList({ payload }: any, { call, put, select }): any {
      const { searchKeyword = '', sessionType = 'all', pageNum } = payload;

      yield put({ type: 'updateState', payload: { sessionLoading: true } });
      try {
        const res = yield call(qryConversations, {
          ...payload,
          sessionType: sessionType === 'all' ? ['h_as'] : [sessionType],
        });

        const state = yield select((state: any) => state.session);

        const targetListName = 'sessionList';
        const targetPaginationName = 'pagination';
        const lastSearchKeywordName = 'allLastSearchKeyword';

        const targetList = state.sessionList;
        const targetPagination = state.pagination;

        const { list, total, pageNum: newPageNum, totalPages } = res || {};

        const mySessionList: ISession[] = (list || []).map((item: ISession) => {
          return sessionHandler(item, targetList);
        });

        // 构建更新的缓存数据
        let updatedList = compact(mySessionList);
        let updatedPagination = {
          ...targetPagination,
          pageIndex: Number(newPageNum),
          pageCount: Number(totalPages),
          total: Number(total),
        };

        if (pageNum !== 1) {
          updatedList = [...targetList, ...compact(mySessionList)];
        }
        updatedPagination = {
          ...updatedPagination,
          pageIndex: max([newPageNum, targetPagination.pageIndex]),
          total: isEmpty(mySessionList) ? size(updatedList) : updatedPagination.total,
        };

        // 准备更新 payload
        const updatePayload: any = {
          sessionLoading: false,
          [targetListName]: formatByUpdateTime(updatedList),
          [targetPaginationName]: updatedPagination,
          [lastSearchKeywordName]: searchKeyword,
        };

        yield put({
          type: 'updateState',
          payload: updatePayload,
        });
      } catch (error: any) {
        console.error(error?.message ?? error ?? '查询会话列表失败');
      } finally {
        yield put({ type: 'updateState', payload: { sessionLoading: false } });
      }
    },

    *editSession({ payload }, { call, put, select }) {
      yield put({ type: 'updateState', payload: { editLoading: true } });
      try {
        yield call(updateConversation, payload);
        const { sessionName } = payload;
        const sessionId = getSessionId(payload);
        const { sessionList } = yield select((state: any) => state.session);

        const updatePayload: any = {};
        // 更新主会话列表
        updatePayload.sessionList = sessionList.map((item: ISession) => {
          if (`${item.sessionId}` === `${sessionId}`) {
            return { ...item, sessionName, showEditName: false };
          }
          return item;
        });

        yield put({
          type: 'updateState',
          payload: updatePayload,
        });
      } catch (error) {
        console.error(error);
        const { sessionList } = yield select((state: any) => state.session);
        const sessionId = getSessionId(payload);
        // 出错时关闭编辑状态
        const updatePayload: any = {};
        updatePayload.sessionList = sessionList.map((item: ISession) => {
          if (`${item.sessionId}` === `${sessionId}`) {
            return { ...item, showEditName: false };
          }
          return item;
        });

        yield put({
          type: 'updateState',
          payload: updatePayload,
        });
      } finally {
        yield put({ type: 'updateState', payload: { editLoading: false } });
      }
    },

    *deleteSession({ payload: params }, { call, put, select }) {
      yield put({ type: 'updateState', payload: { delLoading: true } });
      // 是否同步删除会话（后端删除），默认是同步删除
      const { isSync = true, ...payload } = params;
      try {
        if (isSync) {
          yield call(removeConversation, payload);
        }
        const { sessionList, pagination } = yield select((state: any) => state.session);
        const sessionId = getSessionId(payload);
        // 从所有类型的会话列表中过滤掉被删除的会话
        const updatePayload: any = {
          sessionList: sessionList.filter((item: ISession) => `${item.sessionId}` !== `${sessionId}`),
        };

        // 只有当列表包含被删除的会话时，才减少对应的分页总数
        const sessionExisted = sessionList.some((item: ISession) => `${item.sessionId}` !== `${sessionId}`);

        // 更新分页信息，只在列表包含被删除会话时减少总数
        if (sessionExisted) {
          updatePayload.pagination = {
            ...pagination,
            total: pagination.total - 1,
          };
        }

        yield put({
          type: 'updateState',
          payload: updatePayload,
        });

        return sessionId;
      } catch (error) {
        console.log(error);
      } finally {
        yield put({ type: 'updateState', payload: { delLoading: false } });
      }

      return '';
    },

    // 模糊搜索
    *getSearchList({ payload, success, fail }: any, { call }: any): any {
      try {
        const response = yield call(getSearchList, payload);
        if (response) {
          success?.(response);
        } else {
          fail?.(response || {});
        }
      } catch (error) {
        console.error('模糊搜索失败:', error);
      }
    },

    *getDcSystemConfigListByStandType({ payload }: any, { call }: any): any {
      const response = yield call(fetchDcSystemConfigListByStandType, payload);
      return response;
    },
  },
};

export default sessionModel;
