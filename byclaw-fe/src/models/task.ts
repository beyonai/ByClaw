import { listTasksByPage } from '@/service/task';
import { cloneDeep, get, pullAllBy, set, size } from 'lodash';

import { getRandomNumber } from '@/utils/math';

import { getDefaultPagination, type IPagination } from '@/utils/pageInfo';

import type { ITask } from '@/typescript/task';

export const theme = ['#165DFF', '#01B156', '#5E48FF'];

export interface ITaskState {
  tohandleList: ITask[];
  tohandleLoading: boolean;
  tohandlePagination: IPagination;
  noTohandleData: boolean;
  mycreateList: ITask[];
  mycreateLoading: boolean;
  mycreatePagination: IPagination;
  doneList: ITask[];
  doneLoading: boolean;
  donePagination: IPagination;
}
export default {
  namespace: 'task',
  state: {
    tohandleList: [],
    tohandleLoading: false,
    tohandlePagination: getDefaultPagination({ pageSize: 30 }),
    noTohandleData: true,
    mycreateList: [],
    mycreateLoading: false,
    mycreatePagination: getDefaultPagination({ pageSize: 30 }),
    doneList: [],
    doneLoading: false,
    donePagination: getDefaultPagination({ pageSize: 30 }),
  },
  effects: {
    *queryTohanleList({ payload }, { call, put, select }): any {
      const { tohandlePagination } = yield select((state: any) => state.task);
      const { queryOpt, ...restPayload } = payload;

      yield put({ type: 'save', payload: { tohandleLoading: true } });
      try {
        const res = yield call(
          listTasksByPage,
          {
            taskHandleType: 'TO_BE_PROCESSED',
            taskType: 'APPROVE',
            pageSize: tohandlePagination.pageSize,
            ...(restPayload || {}),
          },
          queryOpt
        );
        const { list = [], total, pageNum: newPageNum, totalPages } = res || {};

        const newList = list.map((item: ITask) => {
          let resPageObj = {};

          try {
            resPageObj = JSON.parse(item.resPage);
          } catch (e) {
            console.error(e);
          }

          return {
            ...item,
            resPageObj,
            theme: theme[getRandomNumber(0, size(theme) - 1)],
          };
        });

        const { tohandleList: prevList } = yield select((state: any) => state.task);

        if (payload.pageNum === 1) {
          yield put({
            type: 'save',
            payload: {
              tohandleList: [...newList],
              tohandlePagination: {
                pageIndex: newPageNum,
                pageCount: totalPages,
                total,
              },
              noTohandleData: newList.length === 0 && !payload.title,
            },
          });
        } else {
          yield put({
            type: 'save',
            payload: {
              tohandleList: [...prevList, ...newList],
              tohandlePagination: {
                ...tohandlePagination,
                pageIndex: newPageNum,
                pageCount: totalPages,
                total,
              },
            },
          });
        }
      } catch (error: any) {
      } finally {
        yield put({ type: 'save', payload: { tohandleLoading: false } });
      }
    },
    *queryMycreateList({ payload }, { call, put, select }): any {
      const { mycreatePagination } = yield select((state: any) => state.task);
      const { queryOpt, ...restPayload } = payload;

      yield put({ type: 'save', payload: { mycreateLoading: true } });
      try {
        const res = yield call(
          listTasksByPage,
          {
            taskHandleType: 'MY_INITIATED',
            taskType: 'APPROVE',
            pageSize: mycreatePagination.pageSize,
            ...(restPayload || {}),
          },
          queryOpt
        );
        const { list = [], total, pageNum: newPageNum, totalPages } = res || {};

        const newList = list.map((item: ITask) => {
          let resPageObj = {};

          try {
            resPageObj = JSON.parse(item.resPage);
          } catch (e) {
            console.error(e);
          }

          return {
            ...item,
            resPageObj,
            theme: theme[getRandomNumber(0, size(theme) - 1)],
          };
        });

        const { mycreateList: prevList } = yield select((state: any) => state.task);

        if (payload.pageNum === 1) {
          yield put({
            type: 'save',
            payload: {
              mycreateList: [...newList],
              mycreatePagination: {
                pageIndex: newPageNum,
                pageCount: totalPages,
                total,
              },
            },
          });
        } else {
          yield put({
            type: 'save',
            payload: {
              mycreateList: [...prevList, ...newList],
              mycreatePagination: {
                ...mycreatePagination,
                pageIndex: newPageNum,
                pageCount: totalPages,
                total,
              },
            },
          });
        }
      } catch (error: any) {
      } finally {
        yield put({ type: 'save', payload: { mycreateLoading: false } });
      }
    },
    *queryDoneList({ payload }, { call, put, select }): any {
      const { donePagination } = yield select((state: any) => state.task);
      const { queryOpt, ...restPayload } = payload;

      yield put({ type: 'save', payload: { doneLoading: true } });
      try {
        const res = yield call(
          listTasksByPage,
          {
            taskHandleType: 'PROCESSED',
            taskType: 'APPROVE',
            pageSize: donePagination.pageSize,
            ...(restPayload || {}),
          },
          queryOpt
        );
        const { list = [], total, pageNum: newPageNum, totalPages } = res || {};

        const newList = list.map((item: ITask) => {
          let resPageObj = {};

          try {
            resPageObj = JSON.parse(item.resPage);
          } catch (e) {
            console.error(e);
          }

          return {
            ...item,
            resPageObj,
            theme: theme[getRandomNumber(0, size(theme) - 1)],
          };
        });

        const { doneList: prevList } = yield select((state: any) => state.task);

        if (payload.pageNum === 1) {
          yield put({
            type: 'save',
            payload: {
              doneList: [...newList],
              donePagination: {
                pageIndex: newPageNum,
                pageCount: totalPages,
                total,
              },
            },
          });
        } else {
          yield put({
            type: 'save',
            payload: {
              doneList: [...prevList, ...newList],
              donePagination: {
                ...donePagination,
                pageIndex: newPageNum,
                pageCount: totalPages,
                total,
              },
            },
          });
        }
      } catch (error: any) {
      } finally {
        yield put({ type: 'save', payload: { doneLoading: false } });
      }
    },
    *taskDisabledBySessionId({ payload }, { put, select }): any {
      const { sessionId } = payload;
      const extParamsBySessionId = yield select(({ session }) => session.extParamsBySessionId);

      const beyondTaskId = get(extParamsBySessionId, `${sessionId}.beyondTaskId`);

      if (!beyondTaskId) return false;

      yield put({
        type: 'task/taskDisabled',
        payload: {
          taskId: beyondTaskId,
        },
      });

      return true;
    },
  },
  reducers: {
    save(state: ITaskState, action: { payload: Partial<ITaskState> }) {
      return {
        ...state,
        ...action.payload,
      };
    },
    taskDisabled(state: ITaskState, action: { payload: any }) {
      const { taskId } = action.payload;
      const { tohandleList } = state;

      if (!taskId) return state;

      const target = tohandleList.find((item) => `${item.taskId}` === `${taskId}`);

      if (target) {
        set(target, 'disabled', true);
      } else {
        return state;
      }

      return {
        ...state,
        tohandleList: [...tohandleList],
      };
    },
    updateTohanleItem(state: ITaskState, action: { payload: any }) {
      const { taskId, statusCd, targetTask } = action.payload;
      const { tohandleList, doneList } = state;

      const target = targetTask || tohandleList.find((item) => `${item.taskId}` === `${taskId}`);

      if (target) {
        if (statusCd === 'Completed') {
          doneList.unshift(cloneDeep(target));
        }

        pullAllBy(tohandleList, [target], 'taskId');

        return {
          ...state,
          tohandleList: [...tohandleList],
          doneList: [...doneList],
        };
      }

      return state;
    },
    cleanTohanleList(state: ITaskState, action: { payload: any }) {
      return {
        ...state,
        ...(action.payload || {}),
        tohandleList: [],
        tohandleLoading: false,
        tohandlePagination: getDefaultPagination({ pageSize: 30 }),
      };
    },
    cleanMycreateList(state: ITaskState) {
      return {
        ...state,
        mycreateList: [],
        mycreateLoading: false,
        mycreatePagination: getDefaultPagination({ pageSize: 30 }),
      };
    },
    cleanDoneList(state: ITaskState) {
      return {
        ...state,
        doneList: [],
        doneLoading: false,
        donePagination: getDefaultPagination({ pageSize: 30 }),
      };
    },
  },
};
