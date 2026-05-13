import { findAssiman } from '@/service/message';
import { getDefaultPagination, paginationReducer } from '@/utils/pageInfo';
import { noop, size } from 'lodash';
import React, { useReducer, useState } from 'react';

import { ISession } from '@/typescript/session';

function useSearch() {
  const [isSearchLoading, setIsLoading] = React.useState(false);
  const [searchList, setSearchList] = useState<ISession[]>([]);
  const [searchKey, setSearchKey] = useState('');
  const [searchHasMore, setHasMore] = useState(true);

  const [paginationInfo, paginationDispatch] = useReducer(paginationReducer, getDefaultPagination({ pageSize: 20 }));

  const search = (keyword: string = '') => {
    if (isSearchLoading) return noop;

    const isSameKey = searchKey === keyword;
    setSearchKey(keyword);

    if (!searchHasMore && isSameKey) {
      return noop;
    }

    const payload = {
      keyword,
      type: 'session', // all:模糊发现中数字员工和企业员工,digit只模糊查询发现中的数字员工,user只模糊查询企业员工,session 只模糊搜索会话内容
      pageSize: paginationInfo.pageSize,
      pageIndex: paginationInfo.pageIndex,
    };

    if (!isSameKey) {
      Object.assign(payload, {
        pageIndex: 1,
      });
    }

    setIsLoading(true);

    return findAssiman({
      ...payload,
    })
      .then((res) => {
        const { sessionList } = res || {};

        paginationDispatch({
          type: 'change',
          item: {
            pageIndex: payload.pageIndex + 1,
          },
        });

        setHasMore(size(sessionList) >= paginationInfo.pageSize);

        if (isSameKey) {
          return [...searchList, ...sessionList];
        }

        return sessionList || [];
      })
      .then((newList) => {
        setSearchList(newList);
        return newList;
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const removeSearchListItem = (sessionId: string) => {
    if (!sessionId) return searchList;
    const newSessionList = searchList.filter((item: ISession) => `${item.sessionId}` !== sessionId);
    setSearchList([...newSessionList]);

    return newSessionList;
  };

  return {
    search,
    removeSearchListItem,
    searchList,
    isSearchLoading,
    searchKey,
    searchHasMore,
  };
}

export default useSearch;
