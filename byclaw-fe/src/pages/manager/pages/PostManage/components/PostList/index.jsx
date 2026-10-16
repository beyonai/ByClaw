import React, { useEffect, useState, useRef } from 'react';
import { get } from 'lodash';
import classNames from 'classnames';
import { Button, Dropdown, Input, message, Modal, Pagination, Tabs, Table } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useDispatch, useSelector, useIntl } from '@umijs/max';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import Layout from '@/pages/manager/components/ausong/Layout';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import styles from './index.module.less';
import KnowledgeBaseAuthor from '@/pages/manager/components/KnowledgeBaseAuthor';
import DigitalEmployeeAuthor from '@/pages/manager/components/DigitalEmployeeAuthor';
import { addPositionUsers, removePositionUsers } from '@/pages/manager/service/OrgCenter';
import PostResource from '../PostResource';
import PostMemberSelect from './PostMemberSelect';

const filterKeyToParamKeyMap = {
  // positionName: 'positionId',
};
const filterKeys = Object.keys(filterKeyToParamKeyMap);

const PostList = ({ selectedPost, record }) => {
  const dispatch = useDispatch();
  const intl = useIntl();

  const isLoading = useSelector(({ loading }) => loading.effects['postManage/getPostMemberList']);

  // 角色列表
  const [roleList, setRoleList] = useState([]);
  const [data, setData] = useState({
    dataSource: [],
    total: 0,
  });
  const [pageInfo, setPageInfo] = useState({
    pageNum: 1,
    pageSize: 10,
    totalPages: 0,
  });
  const [filter, setFilter] = useState(() =>
    filterKeys.reduce((m, k) => {
      m[k] = null;
      return m;
    }, {})
  );

  const filterRef = useRef(filter);

  const [baseVisible, setBaseVisible] = useState(false);
  const [employeeVisible, setEmployeeVisible] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [activeTab, setActiveTab] = useState('postMember');
  const tableWrapRef = useRef(null);
  const [tableScrollY, setTableScrollY] = useState(240);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [addMembersVisible, setAddMembersVisible] = useState(false);
  const [savingMembers, setSavingMembers] = useState(false);
  const savingMembersRef = useRef(false);
  const selectedPostRef = useRef(selectedPost);
  const memberRequestRef = useRef(0);
  selectedPostRef.current = selectedPost;
  const canManageMembers = !!selectedPost && !record?.positionUserType;

  const tabItems = React.useMemo(() => {
    return [
      {
        key: 'postMember',
        label: intl.formatMessage({ id: 'orgMgr.members.title' }),
      },
      {
        key: 'employee',
        label: intl.formatMessage({ id: 'orgMgr.tabs.employee' }),
      },
      {
        key: 'knowledge',
        label: intl.formatMessage({ id: 'orgMgr.tabs.knowledge' }),
      },
      {
        key: 'tool',
        label: intl.formatMessage({ id: 'orgMgr.tabs.tool' }),
      },
    ];
  }, [intl]);

  useEffect(() => {
    if (tabItems.length && !tabItems.some((item) => item.key === activeTab)) {
      setActiveTab(tabItems[0].key);
    }
  }, [activeTab, tabItems]);

  // 岗位成员列表查询
  const getPostMemberList = (params) => {
    const requestId = ++memberRequestRef.current;
    const userType = get(record, 'positionUserType', '');
    const payload = {
      keyword: searchValue,
      pageNum: pageInfo.pageNum,
      pageSize: pageInfo.pageSize,
    };

    if (userType) {
      payload.userType = userType;
    } else {
      payload.positionId = selectedPost;
    }

    dispatch({
      type: 'postManage/getPostMemberList',
      payload: { ...payload, ...params },
      success: (res) => {
        if (requestId !== memberRequestRef.current || selectedPostRef.current !== selectedPost) return;
        const { data: resData } = res || {};
        const rows = resData?.rows || resData?.list || [];
        const pageNum = resData?.pageNum || resData?.pageNum || 1;
        const pageSize = resData?.pageSize || 10;
        const total = resData?.total !== null && resData?.total !== undefined ? resData.total : 0;
        const totalPages =
          resData?.totalPages !== null && resData?.totalPages !== undefined
            ? resData.totalPages
            : Math.ceil(total / pageSize);
        setData({ dataSource: rows, total });
        setPageInfo({ pageNum, pageSize, totalPages });
      },
      fail: (res) => {
        window.console.warn(res?.msg || 'getPostMemberList failed');
      },
    });
  };

  // 角色列表
  const getRoleList = () => {
    dispatch({
      type: 'sessionMgr/getDcSystemConfigListByStandType',
      payload: { standType: 'USER_TYPE' },
    }).then((res) => {
      const resData = Array.isArray(res) ? res : res?.data;
      if (Array.isArray(resData)) {
        setRoleList(
          resData.map((item) => ({
            ...item,
            standCode: item.standCode || item.paramValue || item.paramEnName,
            standDisplayValue: item.standDisplayValue || item.paramName || item.paramDesc,
          }))
        );
      } else {
        window.console.warn(res?.msg || 'get USER_TYPE config failed');
      }
    });
  };

  useEffect(() => {
    getRoleList();
  }, []);

  useEffect(() => {
    setSelectedRowKeys([]);
    setAddMembersVisible(false);
    setData({ dataSource: [], total: 0 });
    if (!selectedPost) return;
    getPostMemberList({ pageNum: 1, pageSize: 10 });
  }, [selectedPost]);

  const updateMembers = async (userIds, remove = false) => {
    if (!canManageMembers || !userIds.length || savingMembersRef.current || selectedPostRef.current !== selectedPost) {
      return;
    }
    const positionId = selectedPost;
    savingMembersRef.current = true;
    setSavingMembers(true);
    try {
      const request = remove ? removePositionUsers : addPositionUsers;
      await request({ positionId, userIds });
      message.success(intl.formatMessage({ id: remove ? 'postList.removeSuccess' : 'postList.addSuccess' }));
      if (selectedPostRef.current === positionId) {
        setSelectedRowKeys([]);
        setAddMembersVisible(false);
        const lastPage = Math.max(1, Math.ceil((data.total - userIds.length) / pageInfo.pageSize));
        getPostMemberList({ pageNum: remove ? Math.min(pageInfo.pageNum, lastPage) : 1 });
      }
    } catch (error) {
      message.error(error?.msg || error?.message || intl.formatMessage({ id: 'postList.updateFailed' }));
      throw error;
    } finally {
      savingMembersRef.current = false;
      setSavingMembers(false);
    }
  };

  const confirmRemoveMembers = (userIds) => {
    Modal.confirm({
      title: intl.formatMessage({ id: 'postList.removeTitle' }),
      content: intl.formatMessage({ id: 'postList.removeConfirm' }, { count: userIds.length }),
      okText: intl.formatMessage({ id: 'common.delete' }),
      cancelText: intl.formatMessage({ id: 'common.cancel' }),
      okButtonProps: { danger: true },
      onOk: () => updateMembers(userIds, true),
    });
  };

  const columns = [
    {
      title: intl.formatMessage({ id: 'postList.userName' }),
      dataIndex: 'userName',
      width: 180,
      ellipsis: true,
      render: (text) => {
        return (
          <div className={styles.userName}>
            <div className={styles.circle}>{text?.slice(text.length - 1, text.length)}</div>
            <Ellipsis tooltip lines={1} style={{ minWidth: 50 }}>
              {text}
            </Ellipsis>
          </div>
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'postInfo.position' }),
      dataIndex: 'position',
      width: 300,
      render: (_text, record) => {
        const userTypeList = record.userTypes ? record.userTypes.split(',') : [];
        return (
          <div className={classNames(styles.position, 'ub ub-wrap gap4')}>
            {userTypeList.map((item) => (
              <div className={styles.role} key={item}>
                {roleList?.find((i) => i.standCode === item)?.standDisplayValue || ''}
              </div>
            ))}
          </div>
        );
      },
    },
    {
      title: intl.formatMessage({ id: 'postList.phone' }),
      dataIndex: 'phone',
    },
    {
      title: intl.formatMessage({ id: 'postList.userNumber' }),
      dataIndex: 'userNumber',
    },
    {
      title: intl.formatMessage({ id: 'postList.department' }),
      dataIndex: 'pathName',
      render: (v) => (
        <div className={styles.userName}>
          <Ellipsis tooltip lines={1}>
            {v}
          </Ellipsis>
        </div>
      ),
    },
  ];

  if (canManageMembers) {
    columns.push({
      title: intl.formatMessage({ id: 'postList.operation' }),
      key: 'operation',
      width: 100,
      fixed: 'right',
      render: (_text, user) => (
        <Button type="link" danger disabled={savingMembers} onClick={() => confirmRemoveMembers([user.userId])}>
          {intl.formatMessage({ id: 'common.delete' })}
        </Button>
      ),
    });
  }

  const rowSelection = {
    selectedRowKeys,
    preserveSelectedRowKeys: true,
    onChange: setSelectedRowKeys,
    getCheckboxProps: () => ({ disabled: savingMembers }),
  };

  const onChange = (_, newFilter) => {
    const finalFilter = {
      ...newFilter,
    };
    setFilter(finalFilter);
    filterRef.current = finalFilter;
    // trigger reload
    getPostMemberList({ pageNum: 1 });
  };

  useEffect(() => {
    if (activeTab !== 'postMember') return undefined;

    const tableWrap = tableWrapRef.current;
    if (!tableWrap) return undefined;

    let frameId = null;

    const updateTableScrollY = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        if (!tableWrapRef.current) return;

        const wrapHeight = tableWrapRef.current.clientHeight;
        const headerHeight =
          tableWrapRef.current.querySelector('.ant-table-header')?.clientHeight ||
          tableWrapRef.current.querySelector('.ant-table-thead')?.clientHeight ||
          55;
        const nextScrollY = Math.max(wrapHeight - headerHeight - 8, 120);

        setTableScrollY((prev) => (prev === nextScrollY ? prev : nextScrollY));
      });
    };

    updateTableScrollY();

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => updateTableScrollY());
    resizeObserver?.observe(tableWrap);
    window.addEventListener('resize', updateTableScrollY);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateTableScrollY);
    };
  }, [activeTab, data?.dataSource?.length]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>
          <Tabs
            activeKey={activeTab}
            items={tabItems}
            onChange={(key) => {
              setActiveTab(key);
              setSearchValue('');
            }}
          />
        </div>
        <div className={styles.btn}>
          {activeTab === 'postMember' && (
            <Dropdown
              trigger={['click']}
              disabled={!canManageMembers || savingMembers}
              menu={{
                items: [
                  { key: 'add', label: intl.formatMessage({ id: 'postList.batchAdd' }) },
                  {
                    key: 'remove',
                    label: intl.formatMessage({ id: 'postList.batchRemove' }),
                    danger: true,
                    disabled: !selectedRowKeys.length,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === 'add') setAddMembersVisible(true);
                  if (key === 'remove' && selectedRowKeys.length) confirmRemoveMembers(selectedRowKeys);
                },
              }}
            >
              <Button disabled={!canManageMembers || savingMembers} loading={savingMembers}>
                {intl.formatMessage({ id: 'postList.batchActions' })} <DownOutlined />
              </Button>
            </Dropdown>
          )}
          <Input
            disabled={savingMembers}
            suffix={
              <AntdIcon
                type="icon-a-Searchsousuo"
                onClick={() => {
                  setSelectedRowKeys([]);
                  getPostMemberList({ pageNum: 1 });
                }}
              />
            }
            style={{ width: 246 }}
            placeholder={intl.formatMessage({
              id: 'postList.searchPlaceholder',
            })}
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
            }}
            onPressEnter={() => {
              setSelectedRowKeys([]);
              getPostMemberList({ pageNum: 1 });
            }}
          />
        </div>
      </div>
      {activeTab === 'postMember' && (
        <>
          <div className={styles.content}>
            <div className={styles.tableWrap} ref={tableWrapRef}>
              <Table
                className={styles.table}
                rowKey="userId"
                rowSelection={canManageMembers ? rowSelection : undefined}
                columns={columns}
                loading={isLoading}
                dataSource={data?.dataSource || []}
                pagination={false}
                onChange={onChange}
                tableLayout="fixed"
                scroll={{ x: 1000, y: tableScrollY }}
              />
            </div>
          </div>
          <div className={styles.footer}>
            <Layout
              right={
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Pagination
                    disabled={savingMembers}
                    showQuickJumper
                    showSizeChanger
                    size="small"
                    showTotal={(tot) =>
                      `${intl.formatMessage({ id: 'postList.total' }, { total: tot })}${
                        pageInfo.totalPages ? ` / ${pageInfo.totalPages}页` : ''
                      }`
                    }
                    current={pageInfo.pageNum}
                    pageSize={pageInfo.pageSize}
                    onChange={(current, pageSize) => {
                      getPostMemberList({ pageNum: current, pageSize });
                    }}
                    total={data.total}
                    className={styles.pagination}
                  />
                </div>
              }
            >
              <div className={styles.selected}>
                {intl.formatMessage({ id: 'postList.selectedCount' }, { count: selectedRowKeys.length })}
              </div>
            </Layout>
          </div>
        </>
      )}
      {activeTab !== 'postMember' && (
        <PostResource selectedPost={selectedPost} searchValue={searchValue} activeTab={activeTab} record={record} />
      )}
      {addMembersVisible && (
        <PostMemberSelect
          key={selectedPost}
          saving={savingMembers}
          onCancel={() => setAddMembersVisible(false)}
          onOk={(userIds) => updateMembers(userIds)}
        />
      )}
      {baseVisible && (
        <KnowledgeBaseAuthor
          drawerTitle={intl.formatMessage({ id: 'postList.authResource' })}
          visible={baseVisible}
          onCancel={() => {
            setBaseVisible(false);
          }}
        />
      )}
      {employeeVisible && (
        <DigitalEmployeeAuthor
          drawerTitle={intl.formatMessage({ id: 'postList.authEmployee' })}
          visible={employeeVisible}
          onCancel={() => {
            setEmployeeVisible(false);
          }}
        />
      )}
    </div>
  );
};

export default PostList;
