import {
  catalogTree,
  getPriviledgeList,
  getResourceListByPage,
  type QueryDirAndFileByLevelParams,
  type QueryDirAndFileByLevelItem,
  queryAuthDoc,
  queryDirAndFileByLevel,
  queryResourceDetail,
} from '@/service/knowledgeCenter';
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

/** 知识中心 Tab：企业 enterprise / 个人 personal，对应 queryAuthDoc 的 ownerType */
export type KnowledgeCenterCatalogTab = 'enterprise' | 'personal';

type IState = {
  setState: (payload: any) => void;
  activeTab: KnowledgeCenterCatalogTab;
  resourceLoading: boolean;
  resourceList: any[];
  getResourceListByPage: (data: any) => Promise<any>;
  queryResourceDetail: (data: any) => Promise<any>;
  shareListLoading: boolean;
  shareList: any[];
  getBeShared: (data: any) => Promise<any>;
  directoryLoading: boolean;
  directoryList: any[];
  queryDirAndFileByLevel: (data: QueryDirAndFileByLevelParams) => Promise<any>;
  catalogTree: any[];
  getCatalogTree: (data: any) => Promise<any>;
  priviledgeData: {
    list: any[];
    pagination: {
      pageIndex: number;
      pageSize: number;
      total: number;
    };
  };
  getPriviledgeList: (data: any) => Promise<any>;
};

const useKnowledgeStore = create<IState>()(
  devtools(
    persist(
      (cacheSet) => {
        return {
          setState: (payload: any) => {
            cacheSet((state) => ({ ...state, ...payload }));
          },
          activeTab: 'enterprise',

          resourceLoading: false,
          resourceList: [],
          async getResourceListByPage(data: any) {
            cacheSet({ resourceLoading: true });
            try {
              const res = await getResourceListByPage(data);
              const rows = Array.isArray(res?.rows) ? res.rows : Array.isArray(res?.list) ? res.list : [];
              const pageInfo = {
                pageIndex: res?.pageIndex ?? res?.pageNum ?? 1,
                pageNum: res?.pageNum ?? res?.pageIndex ?? 1,
                pageSize: res?.pageSize ?? data?.pageSize ?? 10,
                total: res?.total ?? 0,
                totalPages: res?.totalPages ?? res?.totalPage ?? 0,
                totalPage: res?.totalPage ?? res?.totalPages ?? 0,
                pageCount: res?.pageCount ?? res?.totalPages ?? res?.totalPage ?? 0,
                ...(res?.pageInfo || {}),
              };
              cacheSet({ resourceList: rows });
              return pageInfo;
            } catch (e) {
              console.error(e);
              return undefined;
            } finally {
              cacheSet({ resourceLoading: false });
            }
          },

          async queryResourceDetail(data: any) {
            try {
              const res = await queryResourceDetail(data);
              return res;
            } catch (e) {
              console.error(e);
              return undefined;
            }
          },

          shareListLoading: false,
          shareList: [],
          async getBeShared(data: any) {
            cacheSet({ shareListLoading: true });
            try {
              const res = await queryAuthDoc(data);
              const { list = [], pageNum = 1, pageSize = 100, total = 0, totalPages = 0 } = res || {};
              cacheSet({ shareList: list || [] });
              return {
                pageIndex: pageNum,
                pageNum,
                pageSize,
                total,
                pageCount: totalPages,
                totalPages,
              };
            } catch (e) {
              console.error(e);
              return undefined;
            } finally {
              cacheSet({ shareListLoading: false });
            }
          },

          directoryLoading: false,
          directoryList: [],
          async queryDirAndFileByLevel(data: QueryDirAndFileByLevelParams) {
            cacheSet({ directoryLoading: true });
            try {
              const res = await queryDirAndFileByLevel(data);
              const raw = Array.isArray(res) ? res : [];
              const directoryList = raw.map((row: QueryDirAndFileByLevelItem) => ({
                ...row,
                collectionName: row.name,
              }));
              cacheSet({ directoryList });
            } catch (e) {
              console.error(e);
            } finally {
              cacheSet({ directoryLoading: false });
            }
          },

          catalogTree: [],
          async getCatalogTree(data: any) {
            try {
              const res = await catalogTree(data);
              cacheSet((state) => {
                return {
                  ...state,
                  catalogTree: res || [],
                };
              });
              return res;
            } catch (e) {
              console.error(e);
              return undefined;
            }
          },

          priviledgeData: {
            list: [],
            pagination: {
              pageIndex: 1,
              pageSize: 12,
              total: 0,
            },
          },
          async getPriviledgeList(data: any) {
            try {
              const res = await getPriviledgeList(data);
              const { rows = [], pageInfo } = res || {};
              cacheSet((state) => ({
                ...state,
                priviledgeData: {
                  list: data?.pageIndex === 1 ? rows : [...state.priviledgeData.list, ...rows],
                  pagination: { ...pageInfo },
                },
              }));
            } catch (e) {
              console.error(e);
            }
          },
        };
      },
      {
        name: 'knowledgeStore',
        partialize: () => ({}),
      }
    )
  )
);

export default useKnowledgeStore;
