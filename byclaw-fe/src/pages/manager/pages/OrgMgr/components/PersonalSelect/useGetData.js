import { useCallback, useState, useEffect } from 'react';

import { message } from 'antd';
import { useDispatch } from 'umi';
import { last, uniqBy } from 'lodash';

import { dataItemTypeMap } from '@/pages/manager/components/PersonnelModel';

const useGetData = (props) => {
  const { defaultPagination, setPagination, pageNum, pageSize, setIsLoading } = props;

  const dispatch = useDispatch();

  // 树路径，组织、
  const [treePath, setTreePath] = useState([]);
  // 树数据，组织、
  const [treeData, setTreeData] = useState([]);
  // 成员列表
  const [memberList, setMemberList] = useState([]);
  // 公司信息
  const [companyInfo, setCompanyInfo] = useState({});

  // 获取组织列表
  const getOrgList = useCallback((orgId) => {
    setIsLoading(true);
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

  // 根据组织获取成员
  const getMemberList = useCallback(
    (orgId, loadMore = false) => {
      let tempPageIndex = pageNum + 1;
      if (!loadMore) {
        setMemberList([]);
        setPagination(defaultPagination);
        tempPageIndex = 1;
      }

      dispatch({
        type: 'memberMgr/getUsersByOrgId',
        payload: {
          pageSize,
          pageNum: tempPageIndex,
          orgId: orgId ?? last(treePath)?.orgId,
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
    [pageSize, pageNum, treePath]
  );

  useEffect(() => {
    // 获取组织列表
    getOrgList(-1);
    // 获取公司信息
    dispatch({
      type: 'sessionMgr/getEnterprise',
      payload: {},
    }).then((res) => {
      if (res && res.code === 0) {
        const result = { ...res?.data };
        setCompanyInfo(result);
      }
    });
  }, []);

  return {
    treePath,
    setTreePath,
    treeData,
    memberList,
    setMemberList,
    companyInfo,
    getOrgList,
    getMemberList,
  };
};

export default useGetData;
