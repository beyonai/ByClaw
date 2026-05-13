import { getAllNotice, batchReadNotice } from '@/service/notice';
import { getDefaultPagination, type IPagination } from '@/utils/pageInfo';
import { size } from 'lodash';

import { ResourceTypeMap } from '@/constants/resource';

export interface INoticeItem {
  id: string | number;
  isRead: string;
  bizType: '0' | '1'; // 0-系统通知 1-业务通知
  content: string;
  createTime: string; // "2025-10-15 16:07:41"
  expireTime: string;
  isDeleted: string;
  priority: string;
  resourceBizType: (typeof ResourceTypeMap)[keyof typeof ResourceTypeMap];
  resourceId: string;
  senderId: string;
  targetId: string;
  title: string;
}
interface IState {
  allNoticeList: INoticeItem[];
  allNoticePagination: IPagination;
  unreadNoticeList: INoticeItem[];
  unreadNoticePagination: IPagination;
}

const PAGE_SIZE = 30;

export default {
  namespace: 'notice',
  state: {
    allNoticeList: [],
    allNoticePagination: getDefaultPagination({ pageSize: PAGE_SIZE }),
    unreadNoticeList: [],
    unreadNoticePagination: getDefaultPagination({ pageSize: PAGE_SIZE }),
  },
  effects: {
    *getAllNotice({ payload = {} }: any, { call, put, select }: any): any {
      const { pageNum, isRead } = payload;
      const { allNoticePagination, unreadNoticePagination } = yield select((state: any) => state.notice);

      try {
        const res = yield call(getAllNotice, {
          isRead,
          pageNum,
          pageSize: PAGE_SIZE,
        });
        const { records = [], total, current: newPageNum, totalPages } = res || {};

        const { allNoticeList: prevList } = yield select((state: any) => state.notice);
        const { unreadNoticeList: unreadPrevList } = yield select((state: any) => state.notice);

        if (pageNum === 1) {
          if (isRead === '0') {
            yield put({
              type: 'save',
              payload: {
                unreadNoticeList: [...records],
                unreadNoticePagination: {
                  pageIndex: Number(newPageNum),
                  pageCount: totalPages,
                  total,
                },
              },
            });
          } else {
            yield put({
              type: 'save',
              payload: {
                allNoticeList: [...records],
                allNoticePagination: {
                  pageIndex: Number(newPageNum),
                  pageCount: totalPages,
                  total,
                },
              },
            });
          }
        } else if (isRead === '0') {
          yield put({
            type: 'save',
            payload: {
              unreadNoticeList: [...unreadPrevList, ...records],
              unreadNoticePagination: {
                ...unreadNoticePagination,
                pageIndex: Number(newPageNum),
                pageCount: totalPages,
                total,
              },
            },
          });
        } else {
          yield put({
            type: 'save',
            payload: {
              allNoticeList: [...prevList, ...records],
              allNoticePagination: {
                ...allNoticePagination,
                pageIndex: Number(newPageNum),
                pageCount: totalPages,
                total,
              },
            },
          });
        }

        return records;
      } catch (error: any) {}

      return [];
    },
    *batchReadNotice({ payload = {} }: any, { call, put, select }: any): any {
      const { idList, read } = payload;

      try {
        yield call(batchReadNotice, payload);
        const { allNoticeList, unreadNoticeList, unreadNoticePagination } = yield select((state: any) => state.notice);

        if (read === 'ALL') {
          // 一键标记已读，未读数据清空，全部数据改状态
          yield put({
            type: 'save',
            payload: {
              allNoticeList: allNoticeList.map((item: any) => ({ ...item, isRead: '1' })),
              unreadNoticeList: [],
              unreadNoticePagination: getDefaultPagination({ pageSize: PAGE_SIZE }),
            },
          });
        } else if (idList && idList.length > 0) {
          // 单独标记已读，不走接口，只更新本地状态

          const idx = allNoticeList.findIndex((i: INoticeItem) => i.id === idList[0]);
          if (idx !== -1) {
            const target = { ...allNoticeList[idx], isRead: '1' };
            allNoticeList.splice(idx, 1);
            const firstNonTopIndex = allNoticeList.findIndex((i: INoticeItem) => `${i.isRead}` === '1');
            if (firstNonTopIndex === -1) {
              allNoticeList.push(target);
            } else {
              allNoticeList.splice(firstNonTopIndex, 0, target);
            }
          }

          // 更新未读列表：删除已标记的项
          const updatedUnreadList = unreadNoticeList.filter((item: any) => !idList.includes(item.id));

          yield put({
            type: 'save',
            payload: {
              allNoticeList,
              unreadNoticeList: updatedUnreadList,
              unreadNoticePagination: {
                ...unreadNoticePagination,
                total: unreadNoticePagination.total - 1,
              },
            },
          });

          if (size(updatedUnreadList) < PAGE_SIZE && size(updatedUnreadList) < unreadNoticePagination.total - 1) {
            yield put({
              type: 'getAllNotice',
              payload: {
                pageNum: 1,
                isRead: '0',
              },
            });
          }
        }
      } catch (error) {
        console.error('标记已读失败:', error);
      }
    },
  },

  reducers: {
    save(state: IState, action: { payload: Partial<IState> }) {
      return {
        ...state,
        ...action.payload,
      };
    },
  },
};
