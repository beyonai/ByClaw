import { useCallback, useState, useRef } from 'react';

import { useDispatch } from '@umijs/max';
import { findAll } from '@/pages/manager/service/OrgMgr';

import { dataItemTypeMap, searchTypeMap } from '@/pages/manager/components/PersonnelModel';

const useSearch = (props) => {
  const { searchKey, onlyUser, defaultPagination, setPagination, pageNum, pageSize, setIsLoading } = props;

  const dispatch = useDispatch();

  // 只能选成员时，也就只能搜索成员
  const initSearchTypeRef = useRef(onlyUser ? searchTypeMap.user : searchTypeMap.all);

  // 搜索类型
  const [searchType, setSearchType] = useState(initSearchTypeRef.current);
  // 搜索列表
  const [searchList, setSearchList] = useState([]);
  // 初始还是有搜索过，用于控制列表内容显示
  const [hasSearch, setHasSearch] = useState(false);

  // 综合搜索
  const handleFindAll = useCallback(() => {
    findAll({
      keyword: searchKey,
      pageSize: 10,
      pageNum: 1,
    })
      .then((res) => {
        const { orgList, userList, positionList, stationList } = res?.data || {};
        const tempOrgList =
          orgList?.map((ele) => ({
            ...ele,
            id: `${dataItemTypeMap.org.toLowerCase()}_${ele.orgId}`,
            name: ele.orgName,
            type: dataItemTypeMap.org,
            desc: ele.pathName,
          })) || [];
        const tempUserList =
          userList?.map((ele) => ({
            ...ele,
            id: `${dataItemTypeMap.user.toLowerCase()}_${ele.userId}`,
            name: ele.userName,
            type: dataItemTypeMap.user,
            desc: ele.pathName,
          })) || [];
        const tempPostList =
          positionList?.map((ele) => ({
            ...ele,
            id: `${dataItemTypeMap.post.toLowerCase()}_${ele.positionId}`,
            name: ele.positionName,
            type: dataItemTypeMap.post,
            desc: ele.positionDesc,
          })) || [];
        const tempStationList =
          stationList?.map((ele) => ({
            ...ele,
            id: `${dataItemTypeMap.station.toLowerCase()}_${ele.stationId}`,
            name: ele.stationName,
            type: dataItemTypeMap.station,
            desc: ele.pathName,
          })) || [];
        setSearchList([...tempOrgList, ...tempUserList, ...tempPostList, ...tempStationList]);
        setHasSearch(true);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [searchKey]);

  // 组织搜索
  const findOrg = useCallback(
    (params) => {
      findAll({
        keyword: searchKey,
        pageSize,
        pageNum: params?.pageNum,
      })
        .then((res) => {
          const { list = [], pageNum: newPageNum, total: newTotal } = res?.data || {};
          setSearchList((pre) => [
            ...pre,
            ...list.map((ele) => ({
              ...ele,
              id: `${dataItemTypeMap.org.toLowerCase()}_${ele.orgId}`,
              name: ele.orgName,
              type: dataItemTypeMap.org,
              desc: ele.pathName,
            })),
          ]);
          setPagination((pre) => ({
            ...pre,
            pageNum: newPageNum || params?.pageNum || 1,
            total: newTotal,
          }));
          setHasSearch(true);
        })
        .finally(() => {
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
          pageNum: params?.pageNum,
        },
        success: (res) => {
          const { list = [], pageNum: newPageNum, total: newTotal } = res?.data || {};
          setSearchList((pre) => [
            ...pre,
            ...list.map((ele) => ({
              ...ele,
              id: `${dataItemTypeMap.user.toLowerCase()}_${ele.userId}`,
              name: ele.userName,
              type: dataItemTypeMap.user,
              desc: ele.pathName,
            })),
          ]);
          setPagination((pre) => ({
            ...pre,
            pageNum: newPageNum || params?.pageNum || 1,
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

  // 岗位搜索
  const findPosition = useCallback(
    (params) => {
      dispatch({
        type: 'authorizeMgr/findPosition',
        payload: {
          keyword: searchKey,
          pageSize,
          pageNum: params?.pageNum,
        },
        success: (res) => {
          const { list = [], pageNum: newPageNum, total: newTotal } = res?.data || {};
          setSearchList((pre) => [
            ...pre,
            ...list.map((ele) => ({
              ...ele,
              id: `${dataItemTypeMap.post.toLowerCase()}_${ele.positionId}`,
              name: ele.positionName,
              type: dataItemTypeMap.post,
              desc: ele.positionDesc,
            })),
          ]);
          setPagination((pre) => ({
            ...pre,
            pageNum: newPageNum || params?.pageNum || 1,
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

  // 驻地搜索
  const findStation = useCallback(
    (params) => {
      dispatch({
        type: 'authorizeMgr/findStation',
        payload: {
          keyword: searchKey,
          pageSize,
          pageNum: params?.pageNum,
        },
        success: (res) => {
          const { list = [], pageNum: newPageNum, total: newTotal } = res?.data || {};
          setSearchList((pre) => [
            ...pre,
            ...list.map((ele) => ({
              ...ele,
              id: `${dataItemTypeMap.station.toLowerCase()}_${ele.stationId}`,
              name: ele.stationName,
              type: dataItemTypeMap.station,
            })),
          ]);
          setPagination((pre) => ({
            ...pre,
            pageNum: newPageNum || params?.pageNum || 1,
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

      let newPageNum = pageNum + 1;
      if (!loadMore) {
        setIsLoading(true);
        setSearchList([]);
        setPagination(defaultPagination);
        newPageNum = 1;
      }

      switch (key) {
        case searchTypeMap.station:
          findStation({ pageNum: newPageNum });
          break;

        case searchTypeMap.org:
          findOrg({ pageNum: newPageNum });
          break;

        case searchTypeMap.user:
          findUser({ pageNum: newPageNum });
          break;

        case searchTypeMap.post:
          findPosition({ pageNum: newPageNum });
          break;

        case searchTypeMap.all:
        default:
          handleFindAll();
          break;
      }
    },
    [handleFindAll, findOrg, findUser, findPosition, findStation, pageNum]
  );

  return {
    initSearchTypeRef,
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
