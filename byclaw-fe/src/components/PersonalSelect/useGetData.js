import { useCallback, useEffect, useState } from 'react';

import { last, uniqBy } from 'lodash';

import { dataItemTypeMap, listTypeMap } from '@/components/PersonnelModel';
import { getAgentListByPage } from '@/service/agent';
import { getOrgTree } from '@/service/orgMgr';
import { getUsersByOrgId } from '@/service/memberMgr';

import { agentHandler } from '@/utils/agent';

const useGetData = (props) => {
  const {
    listType,
    isOrg,
    defaultPagination,
    setPagination,
    pageNum,
    pageSize,
    setIsLoading,
    disabledList = [],
  } = props;

  // 树路径，组织、
  const [treePath, setTreePath] = useState([]);
  // 树数据，组织、
  const [treeData, setTreeData] = useState([]);
  // 成员列表
  const [memberList, setMemberList] = useState([]);
  // 数字员工列表
  const [agentList, setAgentList] = useState([]);
  // 公司信息
  const [companyInfo] = useState({});

  // 获取组织列表
  const getOrgList = useCallback((orgId) => {
    getOrgTree({ parentOrgId: orgId })
      .then((res) => {
        setTreeData(
          (res || []).map((item) => ({
            ...item,
            id: `${dataItemTypeMap.org.toLowerCase()}_${item.orgId}`,
            name: item.orgName,
            type: dataItemTypeMap.org,
            disabled: disabledList.includes(dataItemTypeMap.org), // 禁止选组织
          }))
        );
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  // 根据组织获取成员
  const getMemberList = useCallback(
    (params) => {
      getUsersByOrgId({ pageSize, ...params }).then((res) => {
        const { list = [], pageNum: newPageIndex, total: newTotal } = res || {};
        const temp =
          (list || []).map((item) => ({
            ...item,
            id: `${dataItemTypeMap.user.toLowerCase()}_${item.userId}`,
            uid: item.userId,
            name: item.userName,
            type: dataItemTypeMap.user,
            disabled: disabledList.includes(dataItemTypeMap.user),
          })) || [];
        setMemberList((pre) => [...pre, ...uniqBy(temp, 'userId')]);
        setPagination((pre) => ({
          ...pre,
          pageNum: Number(newPageIndex),
          total: Number(newTotal),
        }));
      });
    },
    [pageSize]
  );

  // 按数字员工
  const getAgentList = useCallback(
    (params) => {
      getAgentListByPage({ pageSize, ...params })
        .then((res) => {
          const { list = [], pageNum, total: newTotal } = res || {};
          setAgentList((pre) => [
            ...pre,
            ...(list || []).map((item) =>
              agentHandler({
                ...item,
                id: `${dataItemTypeMap.agent.toLowerCase()}_${item.id}`,
                uid: item.id,
                agentId: item.id,
                name: item.name,
                type: dataItemTypeMap.agent,
                disabled: disabledList.includes(dataItemTypeMap.agent),
              })
            ),
          ]);
          setPagination((pre) => ({
            ...pre,
            pageNum: Number(pageNum),
            total: Number(newTotal),
          }));
        })
        .finally(() => {
          setIsLoading(false);
        });
    },
    [pageSize]
  );

  // 多功能集中复用的非搜索状态下的查询方法
  const handleGetList = useCallback(
    (params = {}, loadMore = false) => {
      let newPageIndex = Number(pageNum) + 1;
      if (!loadMore) {
        setMemberList([]);
        setAgentList([]);
        setPagination(defaultPagination);
        newPageIndex = 1;
      }

      switch (listType) {
        case listTypeMap.agent:
          getAgentList({ pageNum: newPageIndex, ...params });
          break;

        case listTypeMap.org:
        default:
          getMemberList({
            pageNum: newPageIndex,
            orgId: params?.orgId ?? last(treePath)?.orgId,
            ...params,
          });
          break;
      }
    },
    [pageNum, listType, treePath, getMemberList, getAgentList]
  );

  useEffect(() => {
    setIsLoading(true);
    setTreePath([]);

    if (isOrg) {
      // 获取组织列表
      getOrgList(-1);
    } else {
      handleGetList();
    }
  }, [listType]);

  return {
    treePath,
    setTreePath,
    treeData,
    memberList,
    setMemberList,
    agentList,
    companyInfo,
    getOrgList,
    handleGetList,
  };
};

export default useGetData;
