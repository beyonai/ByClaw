// @ts-nocheck
import React, { useCallback, useState, useMemo } from 'react';

import { Breadcrumb, Input, Button, Tabs, Space } from 'antd';
import { ClusterOutlined, ContactsOutlined, LeftOutlined } from '@ant-design/icons';
import { isEmpty, size } from 'lodash';
import { useIntl } from '@umijs/max';

import AntdIcon from '@/pages/manager/components/AntdIcon';
import PersonnelModel, {
  listTypeMap,
  leftTypeMap,
  searchTypeMap,
  searchTypeOpts,
} from '@/pages/manager/components/PersonnelModel';
import useGetData from './useGetData';
import useSearch from './useSearch';

import styles from './index.module.less';

const defaultPagination = { pageIndex: 1, pageSize: 15, total: 0 };

const AddAuthModal = (props) => {
  const { onCancel, onOk, value, title, onlyUser = false, showPost = true, showStation = false } = props;

  const intl = useIntl();

  // 筛选关键词
  const [searchKey, setSearchKey] = useState('');
  // 添加类型
  const [listType, setListType] = useState(listTypeMap.org); // ORG、POST
  const isOrg = listType === listTypeMap.org;
  const isPost = listType === listTypeMap.post;
  const isStation = listType === listTypeMap.station;
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
    postList,
    companyInfo,
    getOrgList,
    getStationTree,
    handleGetList,
  } = useGetData({
    onlyUser,
    listType,
    isOrg,
    isStation,
    defaultPagination,
    setPagination,
    pageIndex,
    pageSize,
    setIsLoading,
  });

  const {
    initSearchTypeRef,
    searchType,
    setSearchType,
    searchList,
    setSearchList,
    hasSearch,
    setHasSearch,
    handleSearch,
  } = useSearch({
    searchKey,
    onlyUser,
    defaultPagination,
    setPagination,
    pageIndex,
    pageSize,
    setIsLoading,
  });

  // 当前列表是否有更多数据
  const hasMore = useMemo(() => {
    let currentList = [];
    if (isSearch) {
      currentList = searchList;
    } else if (listType === listTypeMap.post) {
      currentList = postList;
    } else if (listType === listTypeMap.org) {
      currentList = memberList;
    }
    return total > size(currentList);
  }, [isSearch, searchList, listType, postList, memberList, total]);

  // 当前渲染的数据列表
  const dataList = useMemo(() => {
    if (isSearch) {
      // undefined标识无数据
      return hasSearch && !searchList.length ? undefined : searchList;
    }

    if (isOrg) {
      return [...treeData, ...memberList];
    }

    if (isStation) {
      return treeData;
    }

    return postList;
  }, [isOrg, isStation, treeData, memberList, postList, isSearch, searchList, hasSearch]);

  // 分类功能渲染
  const categoryRender = useMemo(() => {
    if (!onlyUser && isSearch) {
      return (
        <Tabs
          size="small"
          activeKey={searchType}
          items={searchTypeOpts.filter((item) => item.key !== searchTypeMap.agent)}
          onChange={handleSearch}
        />
      );
    }

    if (!isSearch && (showPost || showStation)) {
      return (
        <Space size={8}>
          <Button
            type={isOrg && 'primary'}
            color="default"
            variant="filled"
            icon={<ClusterOutlined />}
            onClick={() => setListType(listTypeMap.org)}
          >
            {intl.formatMessage({ id: 'personnelModel.byOrgPerson' })}
          </Button>
          {showPost && (
            <Button
              type={isPost && 'primary'}
              color="default"
              variant="filled"
              icon={<ContactsOutlined />}
              onClick={() => setListType(listTypeMap.post)}
            >
              {intl.formatMessage({ id: 'personnelModel.byPosition' })}
            </Button>
          )}
          {showStation && (
            <Button
              type={isStation && 'primary'}
              color="default"
              variant="filled"
              icon={<AntdIcon type="icon-a-Localyidingwei" />}
              onClick={() => setListType(listTypeMap.station)}
            >
              {intl.formatMessage({ id: 'personnelModel.byStation' })}
            </Button>
          )}
        </Space>
      );
    }

    return null;
  }, [isSearch, onlyUser, showPost, showStation, searchType, isOrg, isPost, isStation, handleSearch, intl]);

  // 树层级信息，组织、驻地
  const treeLevelRender = useMemo(
    () => (
      <>
        {isOrg && <div className={styles.leftTopTitle}>{companyInfo.comAcctName}</div>}
        <div className="ub ub-ac mb-8">
          {!isEmpty(treePath) && (
            <LeftOutlined
              className="mr-8"
              onClick={() => {
                (isOrg ? getOrgList : getStationTree)(-1);
                setTreePath([]);
                setMemberList([]);
              }}
            />
          )}
          <Breadcrumb separator=">">
            {treePath?.map((item, index) => (
              <Breadcrumb.Item
                key={item?.[isOrg ? 'orgId' : 'stationId']}
                onClick={async () => {
                  setTreePath(treePath.slice(0, index + 1));
                  if (isOrg) {
                    getOrgList(item.orgId);
                    handleGetList({ orgId: item.orgId });
                  } else {
                    getStationTree(item.stationId);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                {item?.[isOrg ? 'orgName' : 'stationName']}
              </Breadcrumb.Item>
            ))}
          </Breadcrumb>
        </div>
      </>
    ),
    [isOrg, companyInfo, treePath, getOrgList, getStationTree, handleGetList]
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
                setSearchType(initSearchTypeRef.current);
                setSearchList([]);
                setPagination(defaultPagination);
                setHasSearch(false);
              }}
            />
          )}
          <Input
            placeholder={intl.formatMessage({
              id: 'orgMgr.personalSelect.search',
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
        {categoryRender}
        {!isSearch && (isOrg || isStation) && treeLevelRender}
      </div>
    ),
    [isSearch, searchKey, searchType, isOrg, isStation, handleSearch, categoryRender, treeLevelRender, intl]
  );

  return (
    <PersonnelModel
      open
      title={title || intl.formatMessage({ id: 'auth.redListAuth' })}
      dataList={dataList}
      value={value}
      listType={listType}
      handleGetList={() => {
        handleGetList(undefined, true);
      }}
      onCancel={onCancel}
      onOk={(vals) => {
        onOk(vals);
      }}
      isLoading={isLoading}
      onDrillOrg={(item) => {
        setIsLoading(true);
        setTreePath([...treePath, item]);
        if (isOrg) {
          getOrgList(item.orgId);
          handleGetList({ orgId: item.orgId });
        } else {
          getStationTree(item.stationId);
        }
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

export default AddAuthModal;
