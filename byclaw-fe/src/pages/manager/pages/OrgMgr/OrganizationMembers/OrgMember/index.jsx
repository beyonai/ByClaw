/* eslint-disable function-paren-newline */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable indent */
import React, { useEffect, useState, useRef, forwardRef, useImperativeHandle, useMemo } from 'react';
import { Button, Checkbox, Dropdown, Pagination, message, Modal, Empty, Radio, Space, Row, Input } from 'antd';
import { useDispatch, useSelector, useIntl } from '@umijs/max';
import { isEmpty } from 'lodash';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import Layout from '@/pages/manager/components/ausong/Layout';
import ResizeTable from '@/pages/manager/components/ResizeTable';
import { getFilterParams } from '@/pages/manager/utils/managerUtils';
import { FilterOutlined } from '@ant-design/icons';
import styles from './index.module.less';

const { confirm } = Modal;

const filterKeyToParamKeyMap = {
  positionName: 'positionId',
};
const filterKeys = Object.keys(filterKeyToParamKeyMap);

const FilterDropdownContent = ({
  optionData = [],
  empty,
  intl,
  setSelectedKeys,
  selectedKeys,
  confirm,
  clearFilters,
}) => {
  const [searchKey, setSearchKey] = useState('');

  const dataList = useMemo(
    () => optionData?.filter((item) => item?.label?.includes(searchKey)),
    [optionData, searchKey]
  );

  return (
    <div className={styles.raidScroll}>
      <Input
        placeholder={intl.formatMessage({ id: 'orgMgr.filter.searchKeyword' })}
        value={searchKey}
        onChange={(e) => {
          setSearchKey(e.target.value);
        }}
      />
      {!dataList?.length ? (
        empty || <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Radio.Group
          style={{
            paddingBottom: '12px',
            overflow: 'auto',
            maxHeight: '300px',
          }}
          onChange={(e) => {
            setSelectedKeys([e.target.value]);
          }}
          value={selectedKeys[0]}
        >
          <Space direction="vertical">
            {dataList.map((item) => (
              <Radio key={item.value} value={item.value}>
                {item.label}
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      )}

      <Row align="middle" justify="space-between" className={styles.raidScrollBtns}>
        <Button
          type="link"
          onClick={() => {
            clearFilters?.();
          }}
          size="small"
          disabled={isEmpty(selectedKeys)}
        >
          {intl.formatMessage({ id: 'orgMgr.filter.reset' })}
        </Button>
        <Button
          type="primary"
          onClick={() => {
            confirm?.();
          }}
          size="small"
        >
          {intl.formatMessage({ id: 'orgMgr.filter.confirm' })}
        </Button>
      </Row>
    </div>
  );
};

// 表头筛选
// 单个下拉单选
export const getColumnOptionsSelectSetting = (optionData = [], empty, intl) => {
  return {
    filterDropdown: (dropdownProps) => (
      <FilterDropdownContent {...dropdownProps} optionData={optionData} empty={empty} intl={intl} />
    ),
    filterIcon: (filtered) => <FilterOutlined style={{ color: filtered ? '#1890ff' : undefined, fontSize: '12px' }} />,
  };
};

const OrgMember = (props, ref) => {
  const {
    selectedOrg,
    setEmployeeVisible,
    setBaseVisible,
    setInitParams,
    searchValue,
    setVisible,
    // info,
    setInfo,
    setType,
    roleList,
    positionList,
    canEdit,
    userInfo,
  } = props;

  const intl = useIntl();
  const dispatch = useDispatch();
  const renderCountRef = useRef(0);
  const requestSeqRef = useRef(0);

  const isLoading = useSelector(({ loading }) => loading.effects['memberMgr/getUsersByOrgId']);

  // 已选列表
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [selectedUserInfo, setSelectedUserInfo] = useState([]);
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

  renderCountRef.current += 1;

  const filterRef = useRef(filter);

  const getUsersByOrgId = (params) => {
    const requestId = ++requestSeqRef.current;
    const finalPayload = {
      orgId: selectedOrg?.orgId,
      pageNum: pageInfo.pageNum,
      pageSize: pageInfo.pageSize,
      keyword: searchValue,
      containsChildren: true,
      ...getFilterParams(filterKeyToParamKeyMap, filterRef.current),
      ...params,
    };
    dispatch({
      type: 'memberMgr/getUsersByOrgId',
      payload: finalPayload,
      success: (res) => {
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
        window.console.warn('[OrgMemberTable] getUsersByOrgId fail', {
          requestId,
          payload: finalPayload,
          error: res,
        });
        message.warning(res?.msg);
      },
    });
  };

  useEffect(() => {
    if (selectedOrg?.orgId) {
      getUsersByOrgId({ pageNum: 1, pageSize: 10 });
      setSelectedRowKeys([]);
      setSelectedUserInfo([]);
    }
  }, [selectedOrg]);

  useImperativeHandle(
    ref,
    () => ({
      getUsersByOrgId,
    }),
    [getUsersByOrgId]
  );

  const columns = [
    {
      title: intl.formatMessage({ id: 'orgMgr.table.userCode' }),
      dataIndex: 'userCode',
      width: 100,
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.table.userName' }),
      dataIndex: 'userName',
      width: 200,
      render: (v, record) => (
        <div
          className={styles.userName}
          onClick={() => {
            setVisible(true);
            setInfo(record);
            setType('detail');
          }}
        >
          <div className={styles.circle}>{v?.slice(v.length - 2, v.length)}</div>
          <Ellipsis tooltip lines={1}>
            {v}
          </Ellipsis>
          {/* {record?.userType && (
            <div className={styles.role}>
              {roleList?.find(
                item => `${item.standCode}` === `${record?.userType}`
              )?.standDisplayValue || ''}
            </div>
          )} */}
        </div>
      ),
    },
    // {
    //   title: '用户编码',
    //   dataIndex: 'userCode',
    // },
    {
      title: intl.formatMessage({ id: 'orgMgr.table.organization' }),
      dataIndex: 'orgName',
      width: 130,
    },
    {
      title: intl.formatMessage({ id: 'orgMgr.table.position' }),
      dataIndex: 'positionName',
      filteredValue: filter.positionName,
      ...getColumnOptionsSelectSetting(
        positionList?.map((item) => ({
          value: item.positionId,
          label: item.positionName,
        })),
        undefined,
        intl
      ),
    },
    // {
    //   title: intl.formatMessage({ id: 'orgMgr.table.role' }),
    //   dataIndex: 'userTypes',
    //   render: (v) => {
    //     // userTypes 是数组，需要处理数组和单个值的情况
    //     const userTypesArray = Array.isArray(v) ? v : v ? [v] : [];
    //     const roleNames = userTypesArray
    //       .map((type) => roleList?.find((item) => item.standCode === type)?.standDisplayValue)
    //       .filter(Boolean);
    //     const roleText = roleNames.length > 0 ? roleNames.join('、') : '';
    //     return (
    //       <Ellipsis tooltip lines={1}>
    //         {roleText}
    //       </Ellipsis>
    //     );
    //   },
    // },
    {
      title: intl.formatMessage({ id: 'orgMgr.table.phone' }),
      dataIndex: 'phone',
      width: 110,
    },
    // {
    //   title: '外系统映射',
    //   dataIndex: 'sourceTypes',
    //   render: v => (
    //     <div>
    //       <Ellipsis tooltip lines={1}>
    //         {v?.split(',')?.map(item => systemList.find(i => i.value === item)?.label || '')?.join(',')}
    //         {/* </span> */}
    //       </Ellipsis>
    //     </div>
    //   ),
    // },
    {
      title: intl.formatMessage({ id: 'common.operation' }),
      dataIndex: 'action',
      fixed: 'right',
      width: 180,
      render: (_, record) => (
        <>
          {userInfo.userType === 'PLAT_MAN' ||
          userInfo.userType === 'PLAT_DEVOPS' ||
          (userInfo.orgIds && userInfo.orgIds.includes(record.orgId)) ? (
            <div>
              <Button
                type="link"
                onClick={() => {
                  setVisible(true);
                  setInfo(record);
                  setType('edit');
                }}
                size="small"
              >
                {intl.formatMessage({ id: 'common.edit' })}
              </Button>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: '1',
                      label: intl.formatMessage({
                        id: 'orgMgr.members.relatedEmployee',
                      }),
                    },
                    // {
                    //   key: '2',
                    //   label: intl.formatMessage({
                    //     id: 'orgMgr.members.relatedResource',
                    //   }),
                    // },
                  ],
                  onClick: ({ key }) => {
                    setInfo(record);
                    setInitParams({
                      grantToObjId: record?.userId,
                      grantToObjType: 'USER',
                    });
                    if (key === '1') {
                      setEmployeeVisible(true);
                    }
                    if (key === '2') {
                      setBaseVisible(true);
                    }
                  },
                }}
                placement="bottomRight"
              >
                <Button
                  type="link"
                  size="small"
                  style={{ width: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {intl.formatMessage({ id: 'orgMgr.members.authDetail' })}
                </Button>
              </Dropdown>
              <Dropdown
                menu={{
                  items: [
                    // {
                    //   key: '4',
                    //   label: '数据权限',
                    // },
                    {
                      key: '2',
                      label: intl.formatMessage({
                        id: 'orgMgr.members.resetPassword',
                      }),
                    },
                    // {
                    //   key: '3',
                    //   label: '设置角色',
                    // },
                    {
                      key: '3',
                      label: (
                        <div style={{ color: '#F76560' }}>
                          {intl.formatMessage({
                            id: 'orgMgr.members.exitOrganization',
                          })}
                        </div>
                      ),
                    },
                  ],
                  onClick: ({ key }) => {
                    setInfo(record);
                    if (key === '2') {
                      dispatch({
                        type: 'memberMgr/resetPassword',
                        payload: {
                          userId: record?.userId,
                          orgId: record?.orgId,
                        },
                        success: () => {
                          message.success(
                            intl.formatMessage({
                              id: 'orgMgr.members.resetPasswordSuccess',
                            })
                          );
                        },
                        fail: (res) => {
                          message.error(res?.msg);
                        },
                      });
                    }
                    if (key === '3') {
                      confirm({
                        title: intl.formatMessage({
                          id: 'orgMgr.members.exitOrganizationTitle',
                        }),
                        content: intl.formatMessage({
                          id: 'orgMgr.members.exitOrganizationContent',
                        }),
                        onOk: () => {
                          dispatch({
                            type: 'memberMgr/delUser',
                            payload: {
                              userId: record?.userId,
                              orgId: record?.orgId,
                            },
                            success: () => {
                              message.success(
                                intl.formatMessage({
                                  id: 'orgMgr.members.exitOrganizationSuccess',
                                })
                              );
                              getUsersByOrgId();
                              // setTreeData(treeData.filter(item => item.orgId !== `pId-${record.userId}`));
                            },
                            fail: (res) => {
                              message.error(res?.msg);
                            },
                          });
                        },
                      });
                    }
                    // if (key === '4') {
                    //   // setDataPermissionVisible(true);

                    // }
                  },
                }}
                placement="bottomRight"
              >
                <Button type="link" size="small">
                  {intl.formatMessage({ id: 'common.more' })}
                </Button>
              </Dropdown>
            </div>
          ) : (
            <div>--</div>
          )}
        </>
      ),
    },
  ];

  const rowSelection = {
    onChange: (keys, rows) => {
      const result = selectedRowKeys.filter((item) => !data?.dataSource.find((i) => `${i.orgId}${i.userId}` === item));
      setSelectedRowKeys([...result, ...keys]);
      setSelectedUserInfo(rows.map((it) => ({ orgId: it.orgId, userId: it.userId })));
    },
  };

  const onChange = (_, newFilter) => {
    const finalFilter = {
      ...newFilter,
    };
    setFilter(finalFilter);
    filterRef.current = finalFilter;
    // trigger reload
    getUsersByOrgId({ pageNum: 1 });
  };

  return (
    <>
      <div className={styles.content}>
        <ResizeTable
          rowKey={(record) => `${record.orgId}${record.userId}`}
          columns={columns}
          rowSelection={{
            type: 'checkbox',
            selectedRowKeys,
            ...rowSelection,
          }}
          loading={isLoading}
          dataSource={data?.dataSource || []}
          onChange={onChange}
        />
      </div>
      <div className={styles.footer}>
        <Layout
          left={
            <div className={styles.selected}>
              <Checkbox
                checked={false}
                indeterminate={selectedRowKeys.length > 0}
                onChange={() => {
                  if (
                    selectedRowKeys?.filter((item) => data.dataSource.find((i) => `${i.orgId}${i.userId}` === item))
                      ?.length === data.dataSource.length
                  ) {
                    setSelectedRowKeys(
                      selectedRowKeys?.filter((item) => !data.dataSource.find((i) => `${i.orgId}${i.userId}` === item))
                    );
                    setSelectedUserInfo([]);
                  } else {
                    const oldData = [...selectedRowKeys].filter(
                      (item) => !data.dataSource.find((i) => `${i.orgId}${i.userId}` === item)
                    );
                    setSelectedRowKeys([...oldData, ...data.dataSource.map((item) => `${item.orgId}${item.userId}`)]);
                    setSelectedUserInfo(
                      data?.dataSource?.map((item) => ({
                        orgId: item?.orgId,
                        userId: item?.userId,
                      })) ?? []
                    );
                  }
                }}
              />
              {intl.formatMessage({ id: 'orgMgr.members.selected' }, { count: selectedRowKeys.length })}
              {canEdit && (
                <Button
                  disabled={!selectedRowKeys.length}
                  onClick={() => {
                    confirm({
                      title: intl.formatMessage({
                        id: 'orgMgr.batchExitOrganizationTitle',
                      }),
                      content: intl.formatMessage({
                        id: 'orgMgr.batchExitOrganizationContent',
                      }),
                      onOk: () => {
                        dispatch({
                          type: 'memberMgr/batchDelUser',
                          payload: {
                            delUserDTOList: selectedUserInfo,
                          },
                          success: () => {
                            message.success(
                              intl.formatMessage({
                                id: 'orgMgr.batchExitOrganizationSuccess',
                              })
                            );
                            getUsersByOrgId({ pageNum: 1 });
                            setSelectedRowKeys([]);
                            setSelectedUserInfo([]);
                          },
                          fail: (res) => {
                            message.error(res?.msg);
                          },
                        });
                      },
                    });
                  }}
                >
                  {intl.formatMessage({ id: 'orgMgr.batchExitOrganization' })}
                </Button>
              )}
            </div>
          }
          right={
            <div style={{ height: '100%', display: 'flex', alignItems: 'center' }}>
              <Pagination
                showQuickJumper
                showSizeChanger
                size="small"
                showTotal={(tot, range) =>
                  intl.formatMessage({ id: 'orgMgr.pagination.total' }, { start: range[0], end: range[1], total: tot })
                }
                current={pageInfo.pageNum}
                pageSize={pageInfo.pageSize}
                onChange={(current, pageSize) => {
                  getUsersByOrgId({ pageNum: current, pageSize });
                }}
                total={data.total}
                className={styles.pagination}
              />
            </div>
          }
        >
          <div />
        </Layout>
      </div>
    </>
  );
};

export default forwardRef(OrgMember);
