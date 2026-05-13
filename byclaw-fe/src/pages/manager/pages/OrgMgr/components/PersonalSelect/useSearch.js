import { useCallback, useState } from 'react';

import { useDispatch } from 'umi';

import { dataItemTypeMap, searchTypeMap } from '@/pages/manager/components/PersonnelModel';

const useSearch = (props) => {
  const { searchKey, defaultPagination, setPagination, pageIndex, pageSize, setIsLoading } = props;

  const dispatch = useDispatch();

  // 搜索类型：只能选组织和成员，所以只能搜索综合、组织、成员
  const [searchType, setSearchType] = useState(searchTypeMap.all);
  // 搜索列表
  const [searchList, setSearchList] = useState([]);
  // 初始还是有搜索过，用于控制列表内容显示
  const [hasSearch, setHasSearch] = useState(false);

  // 综合搜索
  const findAll = useCallback(() => {
    dispatch({
      type: 'authorizeMgr/findAll',
      payload: { keyword: searchKey },
      success: (res) => {
        const { orgList, userList } = res?.data || {};
        const tempOrgList = orgList.map((ele) => ({
          ...ele,
          id: `${dataItemTypeMap.org.toLowerCase()}_${ele.orgId}`,
          name: ele.orgName,
          type: dataItemTypeMap.org,
          desc: ele.pathName,
        }));
        const tempUserList = userList.map((ele) => ({
          ...ele,
          id: `${dataItemTypeMap.user.toLowerCase()}_${ele.userId}`,
          name: ele.userName,
          type: dataItemTypeMap.user,
          desc: ele.pathName,
        }));
        setSearchList([...tempOrgList, ...tempUserList]);
        setHasSearch(true);
      },
    }).finally(() => {
      setIsLoading(false);
    });
  }, [searchKey]);

  // 组织搜索
  const findOrg = useCallback(
    (params) => {
      dispatch({
        type: 'authorizeMgr/findOrg',
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
              id: `${dataItemTypeMap.org.toLowerCase()}_${ele.orgId}`,
              name: ele.orgName,
              type: dataItemTypeMap.org,
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

      switch (key) {
        case searchTypeMap.org:
          findOrg({ pageIndex: newPageIndex });
          break;

        case searchTypeMap.user:
          findUser({ pageIndex: newPageIndex });
          break;

        case searchTypeMap.all:
        default:
          findAll();
          break;
      }
    },
    [findAll, findOrg, findUser, pageIndex]
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
