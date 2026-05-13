import { useCallback, useState } from 'react';
import { size } from 'lodash';

import { dataItemTypeMap, searchTypeMap } from '@/components/PersonnelModel';
import { getAgentListByPage } from '@/service/agent';
import { findAll, findUser } from '@/service/search';
import { getOrgTree } from '@/service/orgMgr';

import { agentHandler } from '@/utils/agent';

const useSearch = (props) => {
  const {
    searchKey,
    defaultPagination,
    setPagination,
    pageIndex,
    pageSize,
    setIsLoading,
    defaultSearchType = searchTypeMap.user,
    disabledList,
  } = props;

  // 搜索类型：只能选组织和成员，所以只能搜索综合、组织、成员
  const [searchType, setSearchType] = useState(defaultSearchType);
  // 搜索列表
  const [searchList, setSearchList] = useState([]);
  // 初始还是有搜索过，用于控制列表内容显示
  const [hasSearch, setHasSearch] = useState(false);

  // 综合搜索
  const searchAll = useCallback(() => {
    // pageSize得大于PersonnelModel的searchAllEachSize去查，数据有大于就能显示“查看更多”
    findAll({ keyword: searchKey, pageIndex: 1, pageSize: 5, type: 'all' })
      .then((res) => {
        const { userList, digitList } = res || {};

        const list = [];
        list.push(
          ...(userList?.map?.((ele) => ({
            ...ele,
            id: `${dataItemTypeMap.user.toLowerCase()}_${ele.userId}`,
            name: ele.userName,
            type: dataItemTypeMap.user,
            desc: ele.pathName,
          })) || [])
        );

        list.push(
          ...(digitList?.map?.((ele) => ({
            ...ele,
            id: `${dataItemTypeMap.agent.toLowerCase()}_${ele.id}`,
            name: ele.name,
            type: dataItemTypeMap.agent,
            desc: ele.intro,
          })) || [])
        );

        setSearchList(list);
        setHasSearch(true);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [searchKey, disabledList]);

  // 成员搜索
  const searchUser = useCallback(
    (params) => {
      findUser({
        keyword: searchKey,
        pageSize,
        pageIndex: params?.pageIndex,
      })
        .then((res) => {
          if (res?.code === 0) {
            const { rows, pageIndex: newPageIndex, total: newTotal } = res?.data || {};
            setSearchList((pre) => [
              ...pre,
              ...(rows || []).map((ele) => ({
                ...ele,
                id: `${dataItemTypeMap.user.toLowerCase()}_${ele.userId}`,
                name: ele.userName,
                type: dataItemTypeMap.user,
                desc: ele.pathName,
              })),
            ]);
            setPagination((pre) => ({
              ...pre,
              pageIndex: Number(newPageIndex),
              total: Number(newTotal),
            }));
            setHasSearch(true);
          }
        })
        .finally(() => {
          setIsLoading(false);
        });
    },
    [searchKey, pageSize]
  );

  // 数字员工搜索
  const searchAgent = useCallback(
    (params) => {
      getAgentListByPage({ name: searchKey, pageSize, pageNum: params?.pageIndex })
        .then((res) => {
          const { list, pageNum, total: newTotal } = res || {};
          setSearchList((pre) => [
            ...pre,
            ...(list || []).map((item) =>
              agentHandler({
                ...item,
                id: `${dataItemTypeMap.agent.toLowerCase()}_${item.id}`,
                name: item.name,
                type: dataItemTypeMap.agent,
              })
            ),
          ]);
          setPagination((pre) => ({
            ...pre,
            pageIndex: Number(pageNum),
            total: Number(newTotal),
          }));
          setHasSearch(true);
        })
        .finally(() => {
          setIsLoading(false);
        });
    },
    [searchKey, pageSize]
  );
  const searchOrg = useCallback(() => {
    getOrgTree({
      keyword: searchKey,
      containsParent: false,
    })
      .then((res) => {
        setSearchList(
          (res || []).map((item) => ({
            ...item,
            id: `${dataItemTypeMap.org.toLowerCase()}_${item.orgId}`,
            name: item.orgName,
            type: dataItemTypeMap.org,
          }))
        );

        setPagination((pre) => ({
          ...pre,
          pageIndex: 1,
          total: size(res || []),
        }));
        setHasSearch(true);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [searchKey]);

  // 多功能集中复用的搜索方法
  const handleSearch = useCallback(
    (key, loadMore = false) => {
      setSearchType(key);

      let newPageIndex = Number(pageIndex) + 1;
      if (!loadMore) {
        setIsLoading(true);
        setSearchList([]);
        setPagination(defaultPagination);
        newPageIndex = 1;
      }

      switch (key) {
        case searchTypeMap.agent:
          searchAgent({ pageIndex: newPageIndex });
          break;

        case searchTypeMap.user:
          searchUser({ pageIndex: newPageIndex });
          break;

        case searchTypeMap.org:
          searchOrg({ pageIndex: newPageIndex });
          break;

        case searchTypeMap.all:
        default:
          searchAll();
          break;
      }
    },
    [searchAll, searchUser, searchAgent, searchOrg, pageIndex]
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
