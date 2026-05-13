import {
  getChatSystemConfig,
  queryAllIndicator,
  queryKnowledgeBaseByUser,
  queryKnowledgeBaseView,
  queryKnowledgeBaseViewMeta,
  querySearchSuggestions,
} from '@/service/chatBI';
import { focusIndicatorItem, indicatorMeasureItem, knowledgeBaseListItem, SuggestionItem } from '@/typescript/chatbi';
import dayjs, { Dayjs } from 'dayjs';
import { cloneDeep, get, unset } from 'lodash';

import { IFile } from '@/typescript/file';

type State = {
  knowledgeBaseList: knowledgeBaseListItem[] | null;
  selectedKnowledgeInfo: knowledgeBaseListItem | null;
  lastAllIndicator: indicatorMeasureItem[] | null;
  lastAllMateData: indicatorMeasureItem[] | null;
  searchSuggestions: SuggestionItem[] | null;
  focusIndicator: focusIndicatorItem[] | null;
  indicatorValues: any;
  period: Dayjs;
  analysisSummary: string;
  analysisLoading: boolean;
  chatSystemConfig: Record<string, any>;

  tempFileList: IFile[];
  fileListBySessionId: Record<string, IFile[]>;
};

// class组件用的store
export default {
  namespace: 'chatBI',

  state: {
    // 知识库列表
    knowledgeBaseList: null,
    // 当前选中的知识库
    selectedKnowledgeInfo: null,
    // 指标
    lastAllIndicator: null,
    // 维度
    lastAllMateData: null,
    // 问法
    searchSuggestions: null,
    // 关注指标
    focusIndicator: null,
    // 关注指标的指标值、环比值
    indicatorValues: {},
    // 账期
    period: dayjs().subtract(1, 'day'),
    // 指标分析总结
    analysisSummary: '',
    analysisLoading: false,

    chatSystemConfig: {},

    tempFileList: [],
    fileListBySessionId: {},
  },

  effects: {
    *setState(action: { payload: Partial<State> }, { put }: any) {
      yield put({ type: 'save', payload: action.payload });
    },
    *getKnowledgeBaseByUser(_: any, { call, put }: any): any {
      const res = yield call(queryKnowledgeBaseByUser, {});
      const { createKnowledgeBaseList = [], publishKnowledgeBaseList = [] } = res || {};

      const knowledgeBaseList = createKnowledgeBaseList
        .map((ele: knowledgeBaseListItem) => ({ ...ele, privilegeType: '1' }))
        .concat(
          publishKnowledgeBaseList.filter(
            (ele: knowledgeBaseListItem) =>
              !createKnowledgeBaseList.find(
                (item: knowledgeBaseListItem) => item.knowledgeBaseId === ele.knowledgeBaseId
              )
          )
        );

      yield put({
        type: 'save',
        payload: { knowledgeBaseList },
      });
      return knowledgeBaseList;
    },
    *getAllIndicator({ payload }: any, { call, put }: any): any {
      const { knowledgeBaseId } = payload;
      const res = yield call(queryAllIndicator, {
        pageSize: 50,
        pageIndex: 1,
        knowledgeBaseId,
      });
      const { rows = [] } = res || {};

      yield put({
        type: 'save',
        payload: { lastAllIndicator: rows },
      });
    },
    *getKnowledge({ payload }: any, { call, put }: any): any {
      const { knowledgeBaseId } = payload;

      const viewList = yield call(queryKnowledgeBaseView, {
        knowledgeBaseId,
        pageSize: 1,
        pageIndex: 1,
      });

      const firstViewId = get(viewList, 'rows.0.viewId');
      if (!firstViewId) return;

      const metaDataList = yield call(queryKnowledgeBaseViewMeta, {
        viewId: firstViewId,
        knowledgeBaseId,
        metaDataType: 'dim',
        pageSize: 100,
        pageIndex: 1,
      });
      const { rows = [] } = metaDataList || {};

      yield put({
        type: 'save',
        payload: {
          lastAllMateData: rows.map((item: any) => {
            return {
              ...item,
              viewId: firstViewId,
              knowledgeBaseId,
            };
          }),
        },
      });
    },
    *getSearchSuggestions({ payload }: any, { call, put }: any): any {
      const { knowledgeBaseId } = payload;
      const res = yield call(querySearchSuggestions, {
        pageSize: 20,
        pageIndex: 1,
        knowledgeBaseId,
      });
      const { rows = [] } = res || {};

      yield put({
        type: 'save',
        payload: { searchSuggestions: rows },
      });
    },
    *getChatSystemConfig({ payload }: any, { call, put }: any): any {
      const resp = yield call(getChatSystemConfig, { ...payload });

      yield put({
        type: 'save',
        payload: {
          chatSystemConfig: {
            ...resp,
          },
        },
      });
    },
  },
  reducers: {
    save(state: State, action: { payload: Partial<State> }) {
      return {
        ...state,
        ...action.payload,
      };
    },
    updateLastAllIndicator(state: State, action: { payload: { knowledgeId: string; focus: number } }) {
      const { knowledgeId, focus } = action.payload;
      return {
        ...state,
        lastAllIndicator: (state.lastAllIndicator ?? []).map((it) => {
          if (it.knowledgeId === knowledgeId) {
            return { ...it, focus };
          }
          return it;
        }),
      };
    },
    unFollowUpdate(state: State, action: { payload: { knowledgeId: string } }) {
      const { knowledgeId } = action.payload;

      const newIndicatorValues = cloneDeep(state.indicatorValues);
      unset(newIndicatorValues, knowledgeId);

      return {
        ...state,
        focusIndicator: state.focusIndicator?.filter((it: focusIndicatorItem) => it.knowledgeId !== knowledgeId),
        indicatorValues: newIndicatorValues,
      };
    },
    setIndicatorValues(state: State, action: { payload: Partial<State> }) {
      return {
        ...state,
        indicatorValues: {
          ...state.indicatorValues,
          ...action.payload.indicatorValues,
        },
      };
    },
    setAnalysisSummary(state: State, action: { payload: Partial<State> & { isClear: boolean } }) {
      const { analysisSummary = '', isClear } = action.payload;
      return {
        ...state,
        ...action.payload,
        analysisSummary: isClear ? '' : state.analysisSummary + analysisSummary,
      };
    },
    updateFileListBySessionId(state: State, action: { payload: { sessionId: string; fileList?: IFile[] } }) {
      const { sessionId, fileList } = action.payload;

      if (!sessionId) {
        return {
          ...state,
          tempFileList: fileList || [],
        };
      }

      return {
        ...state,
        tempFileList: [],
        fileListBySessionId: { ...state.fileListBySessionId, [sessionId]: fileList },
      };
    },
    clearTempFileList(state: State, action: { payload: { sessionId: string } }) {
      const { sessionId } = action.payload;

      if (!sessionId) {
        return state;
      }

      return {
        ...state,
        tempFileList: [],
        fileListBySessionId: { ...state.fileListBySessionId, [sessionId]: state.tempFileList },
      };
    },
  },
};
