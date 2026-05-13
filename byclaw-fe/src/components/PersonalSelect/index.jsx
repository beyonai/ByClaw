import React, { useCallback, useMemo, useState } from 'react';

import { LeftOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Breadcrumb, Input, Tabs } from 'antd';
import { isEmpty, size, head } from 'lodash';

import AntdIcon from '@/components/AntdIcon';
import PersonnelModel, {
  leftTypeMap,
  listTypeMap,
  searchTypeMap,
  searchTypeOpts,
  dataItemTypeMap,
} from '@/components/PersonnelModel';
import styles from './index.module.less';
import useGetData from './useGetData';
import useSearch from './useSearch';

const defaultPagination = { pageIndex: 1, pageSize: 15, total: 0 };
const MAXCOUNT = 20;

const PersonalSelect = (props) => {
  const {
    visible,
    onCancel,
    onOk,
    confirmLoading,
    rightBottomRender,
    disabledIds = [],
    selectedValue,
    disabledList = [dataItemTypeMap.org],
    searchTypeMapList = [searchTypeMap.user],
    maxSelectCount = MAXCOUNT,
  } = props;

  const intl = useIntl();

  // 筛选关键词
  const [searchKey, setSearchKey] = React.useState('');
  // 添加类型
  const [listType] = useState(listTypeMap.org); // ORG、AGENT
  const isOrg = listType === listTypeMap.org;
  const isAgent = listType === listTypeMap.agent;
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
    agentList,
    companyInfo,
    getOrgList,
    handleGetList,
  } = useGetData({
    listType,
    isOrg,
    defaultPagination,
    setPagination,
    pageIndex,
    pageSize,
    setIsLoading,
    disabledList,
  });

  const { searchType, setSearchType, searchList, setSearchList, hasSearch, setHasSearch, handleSearch } = useSearch({
    searchKey,
    defaultPagination,
    setPagination,
    pageIndex,
    pageSize,
    setIsLoading,
    defaultSearchType: head(searchTypeMapList),
    disabledList,
  });

  // 当前列表是否有更多数据
  const hasMore = useMemo(() => {
    let currentList = [];
    if (isSearch) {
      currentList = searchList;
    } else if (listType === listTypeMap.agent) {
      currentList = agentList;
    } else if (listType === listTypeMap.org) {
      currentList = memberList;
    }
    return total > size(currentList);
  }, [isSearch, searchList, listType, memberList, agentList, total]);

  // 当前渲染的数据列表
  const dataList = useMemo(() => {
    if (isSearch) {
      // undefined标识无数据
      return hasSearch && !searchList.length ? undefined : searchList;
    }

    if (isOrg) {
      return [...treeData, ...memberList];
    }

    return agentList;
  }, [isOrg, treeData, memberList, agentList, isSearch, searchList, hasSearch]);

  // 分类功能渲染
  const categoryRender = useMemo(() => {
    if (isSearch) {
      return (
        <Tabs
          size="small"
          activeKey={searchType}
          items={searchTypeOpts.filter(
            (item) => searchTypeMapList?.includes?.(item.key) // searchTypeMap.all, searchTypeMap.agent
          )}
          onChange={handleSearch}
        />
      );
    }

    return null;
  }, [isSearch, searchType, isOrg, isAgent, handleSearch, intl]);

  // 树层级信息，组织
  const treeLevelRender = useMemo(
    () => (
      <>
        <div className={styles.leftTopTitle}>{companyInfo.comAcctName}</div>
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
                  handleGetList({ orgId: item.orgId });
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
    [companyInfo, treePath, getOrgList, handleGetList]
  );

  const myRightBottomRender = useCallback(() => {
    return <>{rightBottomRender?.()}</>;
  }, [rightBottomRender]);

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
                setSearchType(head(searchTypeMapList));
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
        {!isSearch && isOrg && treeLevelRender}
      </div>
    ),
    [isSearch, searchKey, searchType, isOrg, handleSearch, categoryRender, treeLevelRender, intl]
  );

  return (
    <PersonnelModel
      open={visible}
      title={intl.formatMessage({ id: 'personnelModel.contacts' })}
      dataList={dataList}
      listType={listType}
      handleGetList={() => {
        handleGetList(undefined, true);
      }}
      onCancel={onCancel}
      onOk={(vals) => {
        onOk?.(vals);
      }}
      isLoading={isLoading}
      confirmLoading={confirmLoading}
      onDrillOrg={(item) => {
        setIsLoading(true);
        setTreePath([...treePath, item]);
        if (isOrg) {
          getOrgList(item.orgId);
          handleGetList({ orgId: item.orgId });
        }
        setSearchKey('');
      }}
      zIndex={2000}
      disabledIds={disabledIds}
      searchKey={searchKey}
      searchType={searchType}
      leftType={leftType}
      handleSearch={handleSearch}
      hasMore={hasMore}
      leftTopRender={leftTopRender}
      rightBottomRender={myRightBottomRender}
      value={selectedValue}
      maxSelectCount={maxSelectCount}
      destroyOnHidden
    />
  );
};

export default PersonalSelect;
