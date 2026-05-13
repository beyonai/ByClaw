import React, { useEffect, useState, useRef } from 'react';
import { get, isEmpty } from 'lodash';
import classNames from 'classnames';
import { Input, Pagination, Tabs, Select, Table } from 'antd';
import { useDispatch, useSelector, useIntl } from '@umijs/max';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import Layout from '@/pages/manager/components/ausong/Layout';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import styles from './index.module.less';
import KnowledgeBaseAuthor from '@/pages/manager/components/KnowledgeBaseAuthor';
import DigitalEmployeeAuthor from '@/pages/manager/components/DigitalEmployeeAuthor';

const filterKeyToParamKeyMap = {
  // positionName: 'positionId',
};
const filterKeys = Object.keys(filterKeyToParamKeyMap);

const PostList = ({ record }) => {
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

  // 岗位成员列表查询
  const getPostMemberList = (params) => {
    const userType = get(record, 'positionUserType', '');
    const payload = {
      keyword: searchValue,
      pageNum: pageInfo.pageNum,
      pageSize: pageInfo.pageSize,
    };

    if (userType) {
      payload.userType = userType;
    } else {
      payload.positionId = record.positionId || record.id;
    }

    dispatch({
      type: 'postManage/getPostMemberList',
      payload: { ...payload, ...params },
      success: (res) => {
        const { data: resData } = res || {};
        const rows = resData?.rows || resData?.list || [];
        const pageNum = resData?.pageNum || resData?.pageIndex || params?.pageNum || 1;
        const pageSize = resData?.pageSize || params?.pageSize || 10;
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
    if (!record || isEmpty(record)) return;
    getPostMemberList({ pageNum: 1, pageSize: 10 });
  }, [record]);

  useEffect(() => {
    if (!record || isEmpty(record)) return;
    setPageInfo((prev) => ({
      ...prev,
      pageNum: 1,
      totalPages: prev.totalPages || 0,
    }));
  }, [searchValue, record]);

  const columns = [
    {
      title: intl.formatMessage({ id: 'postList.userName' }),
      dataIndex: 'userName',
      width: 180,
      ellipsis: true,
      render: (text, record) => {
        const userTypeList = record.userTypes ? record.userTypes.split(',') : [];
        return (
          <div className={styles.userName}>
            <div className={styles.circle}>{text?.slice(text.length - 1, text.length)}</div>
            <Ellipsis tooltip lines={1}>
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

  const onChange = (_, newFilter) => {
    const finalFilter = {
      ...newFilter,
    };
    setFilter(finalFilter);
    filterRef.current = finalFilter;
    // trigger reload
    getPostMemberList({ pageNum: 1 });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>
          <Tabs
            items={[
              {
                key: 'postMember',
                label: intl.formatMessage({ id: 'orgMgr.members.title' }),
              },
            ]}
            onChange={(key) => {
              setActiveTab(key);
              setSearchValue('');
            }}
            className={styles.tabs}
          />
        </div>
        <div className={styles.btn}>
          <Input
            suffix={
              <AntdIcon
                type="icon-a-Searchsousuo"
                onClick={() => {
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
                columns={columns}
                loading={isLoading}
                dataSource={data?.dataSource || []}
                pagination={false}
                onChange={onChange}
                tableLayout="fixed"
                scroll={{ x: 640, y: tableScrollY }}
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
              <div />
            </Layout>
          </div>
        </>
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
