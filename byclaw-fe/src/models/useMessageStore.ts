import { orderBy, size, uniqBy, isEmpty, get, isNil } from 'lodash';

import { createMessage, fetchMessageHandler } from '@/utils/messgae';

import { getMessages, getMessageState } from '@/service/message';

import { IMessage } from '@/typescript/message';

const _INIT_PAGESIZE_ = 20;

const getInitMessageInfo = () => {
  return {
    list: [],
    pageNum: 1,
    pageSize: _INIT_PAGESIZE_,
    total: 1,
    pageRange: [1, 1] as [number, number],
  };
};

export const fetchMessage = async (param: {
  sessionId: string;
  pageNum?: number;
  pageSize?: number;
  fromMessageId?: string;
}) => {
  const res = await getMessages(param);
  const { list, pageNum, pageSize, total } = res;

  let cacheList: any[] = [];
  if (Array.isArray(list)) {
    // 后端同学说messageId时自增长的
    cacheList = orderBy(list, ['messageId'], ['asc']).map((item) => {
      const myMessage = fetchMessageHandler(item);

      return createMessage(myMessage);
    });
  }

  const resComIdsAll: string[] = [];
  cacheList.forEach((item) => {
    const resComId = get(item, 'resComIds.0.resComId');
    if (resComId) {
      resComIdsAll.push(resComId);
    }
    item.isHistoryMsg = true;
  });

  // 批量查询每个卡片的组件状态
  if (resComIdsAll && !isEmpty(resComIdsAll)) {
    const resComStates = await getMessageState({ resComIds: resComIdsAll });
    cacheList = cacheList.map((item) => {
      if (item.fromBeyond) {
        if (item.resComIds && Array.isArray(item.resComIds)) {
          const { resComId } = item.resComIds[0];
          // 查找卡片状态
          const resComObj = resComStates.find((item: any) => item.resComId === resComId);
          if (resComObj) {
            try {
              const jsonObj = JSON.parse(resComObj.resPage);
              return {
                ...item,
                resComState: jsonObj.disabled,
              };
            } catch (e) {
              console.log('e', e);
              return {
                ...item,
                resComState: false,
              };
            }
          }
        }
      }
      return item;
    });
  }

  return {
    list: cacheList,
    pageNum: Number(pageNum),
    pageSize: Number(pageSize),
    total: Number(total),
  };
};

export type IMessageInfo = {
  list: IMessage[];
  pageNum: number;
  pageSize: number;
  total: number;
  targetMessageId?: string;
  pageRange: [number, number];
};

export type IState = {
  sessionListMap: Map<string, IMessageInfo>;
};

export type IEffect = {
  setSessionMessage: (sessionId: string, messageListInfo: IMessageInfo) => void;
  updateSessionMessageList: (sessionId: string, messageList: IMessage[]) => void;
  getSessionMessage: (sessionId: string) => Promise<IMessageInfo>;
  getMoreSessionMessage: (sessionId: string) => Promise<IMessageInfo>;
  getSessionMessageByCache: (sessionId: string) => IMessageInfo;
  getLatestSessionMessage: (sessionId: string) => Promise<IMessageInfo | undefined>;
  cleanSessionMessage: (sessionId: string) => void;
};

const fetchingMoreMsgState: Record<string, boolean> = {};

const getSessionId = (action: { payload: { sessionId: string } }) => {
  const sid = action?.payload?.sessionId;
  if (!sid) return '';

  return sid;
};

export default {
  namespace: 'messageStore',

  state: {
    sessionListMap: new Map(),
  },

  effects: {
    *getSessionMessage(action: { payload: { sessionId: string } }, { put, select }): any {
      const sessionId = getSessionId(action);
      const mySessionListMap: IState['sessionListMap'] = yield select((state) => state.messageStore.sessionListMap);

      let cache = mySessionListMap.get(sessionId);

      if (!cache || isNil(cache.list)) {
        try {
          const originalCache: Partial<IMessageInfo> = cache ? { ...cache } : {};
          const pageNum = cache?.pageNum ?? 1;
          const pageRange = cache?.pageRange ?? ([1, 1] as [number, number]);
          cache = yield fetchMessage({
            // 缓存中有更新吗
            sessionId,
            pageNum,
            pageSize: _INIT_PAGESIZE_,
          });
          cache = {
            ...originalCache,
            ...cache!,
            pageRange: [Math.max(pageRange[0] || 1, pageNum), Math.min(pageRange[1] || 1, pageNum)],
          };

          yield put({
            type: 'setSessionMessage',
            payload: {
              sessionId,
              messageListInfo: cache,
            },
          });
        } catch (e) {
          console.error(e);
        }
      }

      return cache;
    },
    *getMoreSessionMessage(action: { payload: { sessionId: string; isPrev?: boolean } }, { put, select }): any {
      // isPrev ==== 往下翻页，即，pageNum减少
      const { isPrev } = action.payload;
      const sessionId = getSessionId(action);

      const mySessionListMap = yield select((state) => state.messageStore.sessionListMap);
      let cache = mySessionListMap.get(sessionId) || getInitMessageInfo();

      if (isPrev && cache.pageNum <= 1) {
        return null;
      }

      let hasCache = true;
      if (size(cache.list) < cache.total) {
        hasCache = false;
      }

      if (hasCache) {
        return cache;
      }

      const pageNum = isPrev ? cache.pageNum - 1 : cache.pageNum + 1;

      const key = `${sessionId}-${pageNum}`;
      if (fetchingMoreMsgState[key]) {
        return null;
      }
      fetchingMoreMsgState[key] = true;

      try {
        const res = yield fetchMessage({
          sessionId,
          pageNum,
          pageSize: cache.pageSize,
        });
        const pageRange = cache?.pageRange ?? ([1, 1] as [number, number]);

        cache = {
          ...res,
          hasMore: isPrev ? undefined : size(res.list) >= cache.pageSize,
          list: uniqBy(
            isPrev ? orderBy([...cache.list, ...res.list], ['messageId'], ['asc']) : [...res.list, ...cache.list],
            'messageId'
          ),
          pageRange: [Math.max(pageRange[0] || 1, pageNum), Math.min(pageRange[1] || 1, pageNum)],
        };

        yield put({
          type: 'setSessionMessage',
          payload: {
            sessionId,
            messageListInfo: cache,
          },
        });
      } catch (e) {
        console.error(e);
      }
      delete fetchingMoreMsgState[key];

      return cache;
    },
    *getLatestSessionMessage(action: { payload: { sessionId: string } }, { put }): any {
      const sessionId = getSessionId(action);

      let cache: IMessageInfo | undefined;
      try {
        cache = yield fetchMessage({
          sessionId,
          pageNum: 1,
          pageSize: _INIT_PAGESIZE_,
        });

        yield put({
          type: 'setSessionMessage',
          payload: {
            sessionId,
            messageListInfo: {
              ...cache,
              pageRange: [1, 1],
            },
          },
        });
      } catch (e) {
        console.error(e);
      }

      return cache;
    },
    *getSessionInfo(action: { payload: { sessionId: string } }, { select }): any {
      const sessionId = getSessionId(action);
      const mySessionListMap = yield select((state) => state.messageStore.sessionListMap);
      return mySessionListMap.get(sessionId);
    },
  },
  reducers: {
    save(state: IState, action: { payload: Partial<IState> }) {
      return {
        ...state,
        ...action.payload,
      };
    },
    setSessionMessage(state: IState, action: { payload: { sessionId: string; messageListInfo: IMessageInfo } }) {
      const sessionId = getSessionId(action);
      const { messageListInfo } = action.payload;

      const oldSessionListMap = state.sessionListMap;

      oldSessionListMap.set(sessionId, messageListInfo);

      return {
        ...state,
        sessionListMap: oldSessionListMap,
      };
    },
    updateSessionMessageList(state: IState, action: { payload: { sessionId: string; messageList: IMessage[] } }) {
      const sessionId = getSessionId(action);
      const { messageList } = action.payload;

      const oldSessionListMap = state.sessionListMap;

      const oldMessageInfo = oldSessionListMap.get(sessionId);

      if (oldMessageInfo) {
        oldSessionListMap.set(sessionId, {
          list: messageList,
          pageSize: oldMessageInfo.pageSize,
          pageNum: oldMessageInfo.pageNum,
          total: oldMessageInfo.total + (size(messageList) - size(oldMessageInfo.list)),
          pageRange: oldMessageInfo.pageRange,
        });
      } else {
        oldSessionListMap.set(sessionId, {
          list: messageList,
          pageNum: Math.floor(size(messageList) / _INIT_PAGESIZE_) || 1,
          pageSize: _INIT_PAGESIZE_,
          total: size(messageList),
          pageRange: [1, 1],
        });
      }

      return {
        ...state,
        sessionListMap: oldSessionListMap,
      };
    },
    getSessionMessageByCache(state: IState, action: { payload: { sessionId: string } }) {
      const sessionId = getSessionId(action);

      const mySessionListMap = state.sessionListMap;
      let cache = mySessionListMap.get(sessionId);

      if (!cache) {
        cache = getInitMessageInfo();
      }
      return cache;
    },
    setInitialSessionDataToLocateMsg(
      state: IState,
      action: {
        payload: { sessionId: string; index: number; total: number; targetMessageId?: string };
      }
    ) {
      const sessionId = getSessionId(action);
      const { index, total, targetMessageId } = action.payload;

      const pageSize = _INIT_PAGESIZE_;
      const pageNum = Math.ceil(Number(index) / pageSize);
      const { sessionListMap } = state;
      sessionListMap.set(sessionId, {
        pageNum,
        pageSize,
        total: Number(total),
        targetMessageId,
        pageRange: [pageNum, pageNum],
        // 故意的，把list设为undefined
      } as unknown as IMessageInfo);
      return state;
    },
    cleanSessionMessage(state: IState, action: { payload: { sessionId: string } }) {
      const sessionId = getSessionId(action);

      const oldSessionListMap = state.sessionListMap;

      oldSessionListMap.delete(sessionId);

      return {
        ...state,
        sessionListMap: oldSessionListMap,
      };
    },
  },
};
