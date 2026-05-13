import React, { useState, useMemo, useCallback } from 'react';

import { message, Breadcrumb, Input } from 'antd';
import { useDispatch, useSelector, useIntl } from '@umijs/max';
import { LeftOutlined } from '@ant-design/icons';
import { compact, isEmpty, size } from 'lodash';

import AntdIcon from '@/pages/manager/components/AntdIcon';
import PersonnelModel, { leftTypeMap, searchTypeMap } from '@/pages/manager/components/PersonnelModel';
import styles from './index.module.less';
import useSearch from './useSearch';
import useGetData from './useGetData';

const defaultPagination = { pageIndex: 1, pageSize: 15, total: 0 };

const DataPermissionModal = (props) => {
  const {
    visible,
    onCancel,
    redList, // 数据权限选中的值
    selectedOrg,
  } = props;

  const dispatch = useDispatch();
  const intl = useIntl();

  const confirmLoading = useSelector(({ loading }) => loading.effects['memberMgr/setDataPermission']);

  // 筛选关键词
  const [searchKey, setSearchKey] = useState('');
  // 左侧类型
  const [leftType, setLeftType] = useState(leftTypeMap.list);
  const isSearch = leftType === leftTypeMap.searchList;
  // 滚动分页
  const [pagination, setPagination] = useState(defaultPagination);
  const { pageIndex, pageSize, total } = pagination;
  const [isLoading, setIsLoading] = useState(false);

  const {
    treePath,
    setTreePath,
    treeData,
    memberList,
    setMemberList,
    selectedOrgs,
    companyInfo,
    getOrgList,
    getMemberList,
  } = useGetData({
    redList,
    defaultPagination,
    setPagination,
    pageIndex,
    pageSize,
    setIsLoading,
  });

  const { searchType, setSearchType, searchList, setSearchList, hasSearch, setHasSearch, handleSearch } = useSearch({
    searchKey,
    defaultPagination,
    setPagination,
    pageIndex,
    pageSize,
    setIsLoading,
  });

  // 当前列表是否有更多数据
  const hasMore = useMemo(() => {
    const currentList = isSearch ? searchList : memberList;
    return total > size(currentList);
  }, [isSearch, searchList, memberList, total]);

  const handleOk = useCallback(
    (value) => {
      if (!selectedOrg?.orgId) {
        return;
      }
      dispatch({
        type: 'memberMgr/setDataPermission',
        payload: {
          grantToObjId: selectedOrg?.orgId,
          grantToObjType: 'ORG',
          grantType: 'AVAILABLE_USE',
          redList: compact(
            value.userList?.map((item) => {
              if (!item?.id) {
                return null;
              }
              const ary = item.id.split('_');
              ary.shift();
              return {
                grantObjId: ary.join('_'),
                grantObjType: 'MAN_USER',
              };
            })
          ),
        },
        success: () => {
          message.success(intl.formatMessage({ id: 'common.success' }));
          onCancel?.();
        },
        fail: (res) => {
          message.error(res.msg);
        },
      });
    },
    [selectedOrg, intl, onCancel]
  );

  // 当前渲染的数据列表
  const dataList = useMemo(() => {
    if (isSearch) {
      // undefined标识无数据
      return hasSearch && !searchList.length ? undefined : searchList;
    }

    return [...treeData, ...memberList];
  }, [treeData, memberList, isSearch, searchList, hasSearch]);

  // 树层级信息，组织
  const treeLevelRender = useMemo(
    () => (
      <>
        <div className={styles.leftTopTitle}>{companyInfo?.comAcctName || ''}</div>
        <div className="ub ub-ac mb-8">
          {!isEmpty(treePath) && (
            <LeftOutlined
              className="mr-8"
              onClick={() => {
                getOrgList(-1);
                setTreePath([]);
                setMemberList([]);
              }}
            />
          )}
          <Breadcrumb separator=">">
            {treePath?.map((item, index) => (
              <Breadcrumb.Item
                key={item.orgId}
                onClick={async () => {
                  setTreePath(treePath.slice(0, index + 1));
                  getOrgList(item.orgId);
                  getMemberList(item.orgId);
                }}
                style={{ cursor: 'pointer' }}
              >
                {item.orgName}
              </Breadcrumb.Item>
            ))}
          </Breadcrumb>
        </div>
      </>
    ),
    [companyInfo, treePath, getOrgList, getMemberList]
  );

  // modal左边数据列表的上面内容
  const leftTopRender = useCallback(
    () => (
      <div className={styles.leftTop}>
        <div className="ub-ac mb-10 full-width" style={{ display: isSearch && 'inline-flex' }}>
          {isSearch && (
            <AntdIcon
              className="mr-8"
              type="icon-a-Returnfanhui"
              onClick={() => {
                setLeftType(leftTypeMap.list);
                setSearchKey('');
                setSearchType(searchTypeMap.user);
                setSearchList([]);
                setPagination(defaultPagination);
                setHasSearch(false);
              }}
            />
          )}
          <Input
            placeholder={intl.formatMessage({
              id: 'orgMgr.dataPermission.search',
            })}
            value={searchKey}
            allowClear
            suffix={<AntdIcon type="icon-a-Searchsousuo" onClick={() => handleSearch(searchType)} />}
            onChange={(e) => {
              const key = e.target.value.trim();
              setSearchKey(key);
              // 删除关键字为空时
              if (!key) {
                setSearchList([]);
                setPagination(defaultPagination);
                setHasSearch(false);
              }
            }}
            onFocus={() => setLeftType(leftTypeMap.searchList)}
            onPressEnter={() => handleSearch(searchType)}
          />
        </div>
        {!isSearch && treeLevelRender}
      </div>
    ),
    [isSearch, searchKey, searchType, handleSearch, treeLevelRender, intl]
  );

  return (
    <PersonnelModel
      open={visible}
      title={intl.formatMessage({ id: 'orgMgr.organization.dataPermission' })}
      dataList={dataList}
      value={selectedOrgs} // 传入初始选中值
      handleGetList={() => {
        getMemberList(undefined, true);
      }}
      onCancel={onCancel}
      onOk={(vals) => {
        handleOk({ userList: vals });
      }}
      isLoading={isLoading}
      confirmLoading={confirmLoading}
      onDrillOrg={(item) => {
        setTreePath([...treePath, item]);
        getOrgList(item.orgId);
        getMemberList(item.orgId);
        setSearchKey('');
      }}
      searchKey={searchKey}
      searchType={searchType}
      leftType={leftType}
      handleSearch={handleSearch}
      hasMore={hasMore}
      leftTopRender={leftTopRender}
    />
  );
};

export default DataPermissionModal;
