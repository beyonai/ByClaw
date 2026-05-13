import { message } from 'antd';
import {
  getMessageList,
  getProject,
  getAccessTerminal,
  getContentFeedbackType,
  getSuassList,
  getAgentList,
} from '@/pages/manager/service/ConversationMgr';
import { findUser } from '@/pages/manager/service/AuthorizeMgr';

type EffectCallback = (response: any) => void;

type EffectAction = {
  payload?: any;
  success?: EffectCallback;
  fail?: EffectCallback;
};

type SaveAction = {
  payload: Partial<ConversationState>;
};

type ConversationState = {
  projectList: any[];
  accessTerminalList: any[];
  userList: any[];
  responseObjList: any[];
  contentFeedbackType: any[];
};

type EffectGenerator = Generator<any, void, any>;

type SelectState = {
  conversationMgr: ConversationState;
};

type EffectHelpers = {
  call: (fn: (...args: any[]) => any, ...args: any[]) => any;
  put: (action: { type: string; payload?: any }) => any;
  select: (selector: (state: SelectState) => any) => any;
};

const normalizeResponse = (response: any) => {
  if (response && typeof response === 'object' && 'code' in response) {
    return response;
  }
  return { code: 0, data: response };
};

const getErrorText = (error: any) => (typeof error === 'string' ? error : error?.msg || error?.message || '请求失败');

export default {
  namespace: 'conversationMgr',

  state: {
    projectList: [],
    accessTerminalList: [],
    userList: [],
    responseObjList: [],
    contentFeedbackType: [],
  } as ConversationState,

  effects: {
    *getMessageList({ payload, success, fail }: EffectAction, { call }: EffectHelpers): EffectGenerator {
      try {
        const res = normalizeResponse(yield call(getMessageList, payload));
        if (res.code === 0) {
          success?.(res.data);
        } else {
          message.error(res?.msg);
          fail?.(res || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *getProject({ payload, success, fail }: EffectAction, { call, put }: EffectHelpers): EffectGenerator {
      try {
        const res = normalizeResponse(yield call(getProject, payload));
        if (res.code === 0) {
          yield put({
            type: 'save',
            payload: { projectList: res.data || [] },
          });
          success?.(res.data);
        } else {
          message.error(res?.msg);
          fail?.(res || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *getAccessTerminal({ payload, success, fail }: EffectAction, { call, put }: EffectHelpers): EffectGenerator {
      try {
        const res = normalizeResponse(yield call(getAccessTerminal, payload));
        if (res.code === 0) {
          yield put({
            type: 'save',
            payload: { accessTerminalList: res.data || [] },
          });
          success?.(res.data);
        } else {
          message.error(res?.msg);
          fail?.(res || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *findUser({ payload, success, fail }: EffectAction, { call, put, select }: EffectHelpers): EffectGenerator {
      try {
        const res = normalizeResponse(yield call(findUser, payload));
        if (res.code === 0) {
          const userList = (yield select(
            ({ conversationMgr }: SelectState) => conversationMgr.userList
          )) as ConversationState['userList'];
          const { rows = [] } = res?.data || {};
          yield put({
            type: 'save',
            payload: { userList: [...userList, ...rows] },
          });
          success?.(res.data);
        } else {
          message.error(res?.msg);
          fail?.(res || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *getSuassList({ payload, success, fail }: EffectAction, { call, put, select }: EffectHelpers): EffectGenerator {
      try {
        const res = normalizeResponse(yield call(getSuassList, payload));
        if (res.code === 0) {
          const responseObjList = (yield select(
            ({ conversationMgr }: SelectState) => conversationMgr.responseObjList
          )) as ConversationState['responseObjList'];
          const { rows = [] } = res?.data || {};
          yield put({
            type: 'save',
            payload: {
              responseObjList: [
                ...responseObjList,
                ...rows.map((item: any) => ({
                  ...item,
                  value: String(item.superassistId),
                  label: item.name,
                })),
              ],
            },
          });
          success?.(res.data);
        } else {
          message.error(res?.msg);
          fail?.(res || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *getAgentList({ payload, success, fail }: EffectAction, { call, put, select }: EffectHelpers): EffectGenerator {
      try {
        const res = normalizeResponse(yield call(getAgentList, payload));
        if (res.code === 0) {
          const responseObjList = (yield select(
            ({ conversationMgr }: SelectState) => conversationMgr.responseObjList
          )) as ConversationState['responseObjList'];
          const { rows = [] } = res?.data || {};
          yield put({
            type: 'save',
            payload: {
              responseObjList: [
                ...responseObjList,
                ...rows.map((item: any) => ({
                  ...item,
                  value: String(item.objId),
                  label: item.name,
                })),
              ],
            },
          });
          success?.(res.data);
        } else {
          message.error(res?.msg);
          fail?.(res || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
    *getContentFeedbackType({ payload, success, fail }: EffectAction, { call, put }: EffectHelpers): EffectGenerator {
      try {
        const res = normalizeResponse(yield call(getContentFeedbackType, payload));
        if (res.code === 0) {
          const { QUESTION = [], EFFECT = [], REPORT = [] } = res.data || {};
          yield put({
            type: 'save',
            payload: { contentFeedbackType: [...QUESTION, ...EFFECT, ...REPORT] },
          });
          success?.(res.data);
        } else {
          message.error(res?.msg);
          fail?.(res || {});
        }
      } catch (error) {
        const err = { msg: getErrorText(error) };
        message.error(err.msg);
        fail?.(err);
      }
    },
  },

  reducers: {
    save(state: ConversationState, { payload }: SaveAction) {
      return { ...state, ...payload };
    },
  },
};
