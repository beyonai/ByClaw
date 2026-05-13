import { useCallback, useState, useEffect } from 'react';

import { message } from 'antd';
import { useDispatch } from '@umijs/max';
import { isEmpty, last, uniqBy } from 'lodash';

import { listTypeMap, dataItemTypeMap } from '@/pages/manager/components/PersonnelModel';

const useGetData = (props) => {
  const { onlyUser, listType, isOrg, isStation, defaultPagination, setPagination, pageNum, pageSize, setIsLoading } =
    props;

  const dispatch = useDispatch();

  // 树路径，组织、驻地
  const [treePath, setTreePath] = useState([]);
  // 树数据，组织、驻地
  const [treeData, setTreeData] = useState([]);
  // 成员列表
  const [memberList, setMemberList] = useState([]);
  // 岗位列表
  const [postList, setPostList] = useState([]);
  // 公司信息
  const [companyInfo, setCompanyInfo] = useState({});

  // 获取组织列表
  const getOrgList = useCallback(
    (orgId) => {
      dispatch({
        type: 'orgMgr/getOrgTree',
        payload: { parentOrgId: orgId },
        success: (res) => {
          const { data = [] } = res || {};
          setTreeData(
            data.map((item) => ({
              ...item,
              id: `${dataItemTypeMap.org.toLowerCase()}_${item.orgId}`,
              name: item.orgName,
              type: dataItemTypeMap.org,
              disabled: onlyUser, // 只能选成员时，组织禁止勾选
            }))
          );
        },
        fail: (res) => {
          message.warning(res?.msg);
        },
      }).finally(() => {
        setIsLoading(false);
      });
    },
    [onlyUser]
  );

  // 根据组织获取成员
  const getMemberList = useCallback(
    (params) => {
      dispatch({
        type: 'memberMgr/getUsersByOrgId',
        payload: {
          pageSize,
          ...params,
        },
        success: (res) => {
          const { rows = [], pageNum: newPageIndex, total: newTotal } = res?.data || {};
          const temp = rows.map((item) => ({
            ...item,
            id: `${dataItemTypeMap.user.toLowerCase()}_${item.userId}`,
            name: item.userName,
            type: dataItemTypeMap.user,
          }));
          setMemberList((pre) => [...pre, ...uniqBy(temp, 'userId')]);
          setPagination((pre) => ({
            ...pre,
            pageNum: newPageIndex,
            total: newTotal,
          }));
        },
        fail: (res) => {
          message.warning(res?.msg);
        },
      });
    },
    [pageSize]
  );

  // 按岗位
  const getPostList = useCallback(
    (params) => {
      dispatch({
        type: 'memberMgr/searchPositionList',
        payload: {
          pageSize,
          ...params,
        },
        success: (res) => {
          const { rows = [], pageNum: newPageIndex, total: newTotal } = res?.data || {};
          setPostList((pre) => [
            ...pre,
            ...rows.map((ele) => ({
              ...ele,
              id: `${dataItemTypeMap.post.toLowerCase()}_${ele.positionId}`,
              name: ele.positionName,
              type: dataItemTypeMap.post,
            })),
          ]);
          setPagination((pre) => ({
            ...pre,
            pageNum: newPageIndex,
            total: newTotal,
          }));
        },
        fail: (res) => {
          message.warning(res?.msg);
        },
      }).finally(() => {
        setIsLoading(false);
      });
    },
    [pageSize]
  );

  // 获取驻地列表
  const getStationTree = useCallback((stationId) => {
    dispatch({
      type: 'orgMgr/getStationTree',
      payload: { parentStationId: stationId },
      success: (res) => {
        const { data = [] } = res || {};
        setTreeData(
          data.map((item) => ({
            ...item,
            id: `${dataItemTypeMap.station.toLowerCase()}_${item.stationId}`,
            name: item.stationName,
            type: dataItemTypeMap.station,
          }))
        );
      },
      fail: (res) => {
        message.warning(res?.msg);
      },
    }).finally(() => {
      setIsLoading(false);
    });
  }, []);

  // 多功能集中复用的非搜索状态下的查询方法
  const handleGetList = useCallback(
    (params = {}, loadMore = false) => {
      let newPageIndex = pageNum + 1;
      if (!loadMore) {
        setMemberList([]);
        setPostList([]);
        setPagination(defaultPagination);
        newPageIndex = 1;
      }

      switch (listType) {
        case listTypeMap.post:
          getPostList({ pageNum: newPageIndex, ...params });
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
    [pageNum, listType, treePath, getMemberList, getPostList]
  );

  useEffect(() => {
    setIsLoading(true);
    setTreePath([]);

    if (isOrg) {
      getOrgList(-1);
      // 获取公司信息
      if (isEmpty(companyInfo)) {
        dispatch({
          type: 'sessionMgr/getEnterprise',
          payload: {},
        }).then((res) => {
          if (res && res.code === 0) {
            const result = { ...res?.data };
            setCompanyInfo(result);
          }
        });
      }
    } else if (isStation) {
      getStationTree(-1);
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
    postList,
    companyInfo,
    getOrgList,
    getStationTree,
    handleGetList,
  };
};

export default useGetData;
