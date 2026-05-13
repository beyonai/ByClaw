import React, { useState, useCallback, useMemo } from 'react';

import { Select, message, Breadcrumb, Input, Form, Tabs } from 'antd';
import { LeftOutlined } from '@ant-design/icons';
import { compact, isEmpty, size } from 'lodash';
import { useDispatch, useSelector, useIntl } from '@umijs/max';

import AntdIcon from '@/pages/manager/components/AntdIcon';
import PersonnelModel, { leftTypeMap, searchTypeMap, searchTypeOpts } from '@/pages/manager/components/PersonnelModel';
import styles from './index.module.less';
import useGetData from './useGetData';
import useSearch from './useSearch';

const defaultPagination = { pageIndex: 1, pageSize: 15, total: 0 };

const PersonalSelect = (props) => {
  const { visible, selectedOrg, onCancel, positionList, roleList, reload } = props;

  const intl = useIntl();
  const dispatch = useDispatch();
  const [form] = Form.useForm();

  const confirmLoading = useSelector(({ loading }) => loading.effects['memberMgr/addUserByOrg']);

  // 筛选关键词
  const [searchKey, setSearchKey] = useState('');
  // 左侧类型
  const [leftType, setLeftType] = useState(leftTypeMap.list);
  const isSearch = leftType === leftTypeMap.searchList;
  // 滚动分页
  const [pagination, setPagination] = useState(defaultPagination);
  const { pageIndex, pageSize, total } = pagination;
  const [isLoading, setIsLoading] = useState(false);

  const { treePath, setTreePath, treeData, memberList, setMemberList, companyInfo, getOrgList, getMemberList } =
    useGetData({
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
      // 处理角色数据：userTypes 为数组，userType 取第一个值（兼容旧接口）
      const userTypes = Array.isArray(value.roleId) ? value.roleId : value.roleId ? [value.roleId] : [];
      const userType = userTypes.length > 0 ? userTypes[0] : value.roleId;
      dispatch({
        type: 'memberMgr/addUserByOrg',
        payload: {
          orgId: selectedOrg?.orgId,
          userOrOrgVos: compact(
            value.userList?.map((item) => {
              if (!item?.id) {
                return null;
              }
              const ary = item.id.split('_');
              ary.shift();
              return {
                objectId: ary.join('_'),
                objectType: item.type,
              };
            })
          ),
          positionId: value.positionId,
          userType,
          userTypes,
        },
        success: () => {
          message.success(intl.formatMessage({ id: 'orgMgr.personalSelect.addSuccess' }));
          onCancel?.();
          reload?.();
        },
        fail: (res) => {
          message.error(res.msg);
        },
      });
    },
    [selectedOrg, intl, onCancel, reload, dispatch]
  );

  // 当前渲染的数据列表
  const dataList = useMemo(() => {
    if (isSearch) {
      // undefined标识无数据
      return hasSearch && !searchList.length ? undefined : searchList;
    }

    return [...treeData, ...memberList];
  }, [treeData, memberList, isSearch, searchList, hasSearch]);

  // 分类功能渲染
  const categoryRender = useMemo(() => {
    if (isSearch) {
      return <Tabs size="small" activeKey={searchType} items={searchTypeOpts.slice(0, 3)} onChange={handleSearch} />;
    }
    return null;
  }, [isSearch, searchType, handleSearch]);

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
                setSearchType(searchTypeMap.all);
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
        {!isSearch && treeLevelRender}
      </div>
    ),
    [isSearch, searchKey, searchType, handleSearch, categoryRender, treeLevelRender, intl]
  );

  const rightBottomRender = useCallback(
    () => (
      <div className={styles.rightBottomContainer}>
        <Form form={form}>
          <Form.Item
            label={`${intl.formatMessage({
              id: 'orgMgr.personalSelect.memberPosition',
            })}：`}
            name="selectedPost"
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'orgMgr.personalSelect.selectMemberPosition',
                }),
              },
            ]}
          >
            <Select
              options={positionList}
              fieldNames={{ label: 'positionName', value: 'positionId' }}
              placeholder={intl.formatMessage({
                id: 'orgMgr.personalSelect.selectMemberPosition',
              })}
              showSearch
              optionFilterProp="positionName"
            />
          </Form.Item>
          <Form.Item
            label={`${intl.formatMessage({
              id: 'orgMgr.personalSelect.memberRole',
            })}：`}
            name="selectedRole"
            rules={[
              {
                required: true,
                message: intl.formatMessage({
                  id: 'orgMgr.personalSelect.selectMemberRole',
                }),
              },
            ]}
          >
            <Select
              mode="multiple"
              options={roleList}
              fieldNames={{ label: 'standDisplayValue', value: 'standCode' }}
              placeholder={intl.formatMessage({
                id: 'orgMgr.personalSelect.selectMemberRole',
              })}
              showSearch
              optionFilterProp="standDisplayValue"
            />
          </Form.Item>
        </Form>
      </div>
    ),
    [form, positionList, roleList, intl]
  );

  return (
    <PersonnelModel
      open={visible}
      title={intl.formatMessage({ id: 'orgMgr.members.add' })}
      dataList={dataList}
      handleGetList={() => {
        getMemberList(undefined, true);
      }}
      onCancel={onCancel}
      onOk={(vals) => {
        form.validateFields().then((values) => {
          handleOk({
            userList: vals,
            positionId: values?.selectedPost,
            roleId: values?.selectedRole,
          });
        });
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
      rightBottomRender={rightBottomRender}
    />
  );
};

export default PersonalSelect;
