import { useCallback, useState } from 'react';

import { useDispatch } from 'umi';

import { dataItemTypeMap, searchTypeMap } from '@/pages/manager/components/PersonnelModel';

const useSearch = (props) => {
  const { searchKey, defaultPagination, setPagination, pageIndex, pageSize, setIsLoading } = props;

  const dispatch = useDispatch();

  // 搜索类型：只能选成员，所以只能搜索成员
  const [searchType, setSearchType] = useState(searchTypeMap.user);
  // 搜索列表
  const [searchList, setSearchList] = useState([]);
  // 初始还是有搜索过，用于控制列表内容显示
  const [hasSearch, setHasSearch] = useState(false);

  // 成员搜索
  const findUser = useCallback(
    (params) => {
      dispatch({
        type: 'authorizeMgr/findUser',
        payload: {
          keyword: searchKey,
          pageSize,
          pageIndex: params?.pageIndex,
        },
        success: (res) => {
          const { rows = [], pageIndex: newPageIndex, total: newTotal } = res?.data || {};
          setSearchList((pre) => [
            ...pre,
            ...rows.map((ele) => ({
              ...ele,
              id: `${dataItemTypeMap.user.toLowerCase()}_${ele.userId}`,
              name: ele.userName,
              type: dataItemTypeMap.user,
              desc: ele.pathName,
            })),
          ]);
          setPagination((pre) => ({
            ...pre,
            pageIndex: newPageIndex,
            total: newTotal,
          }));
          setHasSearch(true);
        },
      }).finally(() => {
        setIsLoading(false);
      });
    },
    [searchKey, pageSize]
  );

  // 多功能集中复用的搜索方法
  const handleSearch = useCallback(
    (key, loadMore = false) => {
      setSearchType(key);

      let newPageIndex = pageIndex + 1;
      if (!loadMore) {
        setIsLoading(true);
        setSearchList([]);
        setPagination(defaultPagination);
        newPageIndex = 1;
      }

      findUser({ pageIndex: newPageIndex });
    },
    [findUser, pageIndex]
  );

  return {
    searchType,
    setSearchType,
    searchList,
    setSearchList,
    hasSearch,
    setHasSearch,
    handleSearch,
  };
};

export default useSearch;
