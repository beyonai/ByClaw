import React, { useEffect, useState } from 'react';

import classNames from 'classnames';
import { Input, Pagination, Tooltip, Badge, message } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { connect, useIntl } from '@umijs/max';

import AntdIcon from '@/pages/manager/components/AntdIcon';
import DrawerWithProps from '@/pages/manager/components/DrawerWithProps';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import ResizeTable from '@/pages/manager/components/ResizeTable';
import Layout from '@/pages/manager/components/ausong/Layout';
import styles from './index.module.less';

const DigitalEmployeeAuthor = ({ drawerTitle, visible, onCancel, dispatch, initParams, showTabs = true }: any) => {
  const intl = useIntl();
  const [searchValue, setSearchValue] = useState('');

  const [tabList, setTabList] = useState([
    {
      key: '1',
      title: intl.formatMessage({ id: 'digitalEmployee.available' }),
      grantType: 'FORCE_USE',
    },
    {
      key: '2',
      title: intl.formatMessage({ id: 'digitalEmployee.manageable' }),
      grantType: 'ALLOW_MANAGE',
    },
  ]);
  const [activeKey, setActiveKey] = useState('1');

  const [data, setData] = useState({
    dataSource: [],
    total: 0,
  });
  const [pageInfo, setPageInfo] = useState({
    pageNum: 1,
    pageSize: 10,
  });

  const [loading, setLoading] = useState(false);

  // 打开抽屉或授权对象变化时，刷新两个 Tab 括号内的总数
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const fetchGrantTypeTotal = (grantType: string) =>
      new Promise<number>((resolve) => {
        dispatch({
          type: 'authorizeMgr/listDigitalEmployeeAuth',
          payload: {
            pageNum: 1,
            pageSize: 1,
            keyword: '',
            ...initParams,
            grantType,
          },
          success: (res: any) => {
            const resData = res?.data;
            const n = Number(resData?.total ?? 0);
            resolve(Number.isFinite(n) ? n : 0);
          },
          fail: () => resolve(0),
        });
      });

    (async () => {
      const [useTotal, manageTotal] = await Promise.all([
        fetchGrantTypeTotal('FORCE_USE'),
        fetchGrantTypeTotal('ALLOW_MANAGE'),
      ]);
      if (cancelled) return;
      setTabList([
        {
          key: '1',
          title: intl.formatMessage({ id: 'digitalEmployee.available' }),
          grantType: 'FORCE_USE',
          total: useTotal,
        },
        {
          key: '2',
          title: intl.formatMessage({ id: 'digitalEmployee.manageable' }),
          grantType: 'ALLOW_MANAGE',
          total: manageTotal,
        },
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, initParams, intl, dispatch]);

  // 名称、描述、创建人、来源、使用状态（开关）、管理状态（开关）、强制使用（开关）、操作
  const columns = [
    {
      title: intl.formatMessage({ id: 'digitalEmployee.name' }),
      dataIndex: 'name',
      render: (text: any) => (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img
            src={`${_PUBLIC_PATH_}image/head/headEmpoyee.png`}
            style={{ width: 20, height: 20, marginRight: 4 }}
            alt=""
          />
          <Ellipsis tooltip lines={1}>
            {text || '-'}
          </Ellipsis>
        </div>
      ),
    },
    {
      title: intl.formatMessage({ id: 'form.desc' }),
      dataIndex: 'intro',
      width: 150,
    },
    // {
    //   title: '编码',
    //   dataIndex: 'createUser',
    //   key: 'createUser',
    //   width: 80,
    // },
    {
      title: intl.formatMessage({ id: 'digitalEmployee.status' }),
      dataIndex: 'hasPermission',
      width: 80,
      render: (text: boolean) => (
        <div>
          {text && <Badge color="#00B42A" text={intl.formatMessage({ id: 'digitalEmployee.hasPermission' })} />}
          {!text && <Badge color="#F7BA1E" text={intl.formatMessage({ id: 'digitalEmployee.noPermission' })} />}
        </div>
      ),
    },
    {
      title: (
        <div style={{ display: 'flex', alignItems: 'center', columnGap: 8 }}>
          {intl.formatMessage({ id: 'digitalEmployee.authSource' })}
          <Tooltip title={intl.formatMessage({ id: 'digitalEmployee.authSourceTip' })}>
            <InfoCircleOutlined />
          </Tooltip>
        </div>
      ),
      dataIndex: 'grantSourceVos',
      width: 200,
      render: (v: any[]) => {
        if (!Array.isArray(v)) return null;
        const redAry = v?.filter((item) => item.color === 'RED') || [];
        const blackAry = v?.filter((item) => item.color === 'BLACK') || [];

        return (
          <Tooltip
            placement="bottomRight"
            overlayStyle={{ maxWidth: '400px' }}
            title={
              <div className={styles.tooltiptags}>
                {blackAry?.length > 0 && (
                  <div className={styles.tagContent} style={{ marginBottom: 16 }}>
                    {blackAry.map((item) => (
                      <div className={styles.blackTag} key={`toolBlack_${item.grantToObjId}_${item.grantToObjType}`}>
                        {item.grantToObjName}
                      </div>
                    ))}
                  </div>
                )}
                {redAry?.length > 0 && (
                  <div className={styles.tagContent}>
                    {redAry?.map((item) => (
                      <div className={styles.redTag} key={`toolRed_${item.grantToObjId}_${item.grantToObjType}`}>
                        {item.grantToObjName}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            }
          >
            <div className={styles.tags}>
              {[...blackAry, ...redAry].slice(0, 3).map((item) => (
                <div
                  className={item.color === 'RED' ? styles.redTag : styles.blackTag}
                  key={`tool_${item.grantToObjId}_${item.grantToObjType}_${item.color}`}
                >
                  {item.grantToObjName}
                </div>
              ))}
              {[...blackAry, ...redAry]?.length > 3 && (
                <span className={styles.more}>+{[...blackAry, ...redAry]?.length - 3}</span>
              )}
            </div>
          </Tooltip>
        );
      },
    },
  ];

  const listChange = (pageNum: number, pageSize: number) => {
    setPageInfo({
      pageNum,
      pageSize,
    });
  };

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    dispatch({
      type: 'authorizeMgr/listDigitalEmployeeAuth',
      payload: {
        pageNum: pageInfo.pageNum,
        pageSize: pageInfo.pageSize,
        keyword: searchValue,
        ...initParams,
        grantType: activeKey === '2' ? 'ALLOW_MANAGE' : 'FORCE_USE',
      },
      success: (res: any) => {
        const { data: resData } = res;
        const list = resData?.list ?? resData?.rows ?? [];
        const total = resData?.total ?? 0;
        setData({
          dataSource: Array.isArray(list) ? list : [],
          total,
        });
      },
      fail: (res: any) => {
        message.warning(res?.msg);
      },
    }).finally(() => {
      setLoading(false);
    });
  }, [pageInfo, visible, activeKey, searchValue, initParams, dispatch]);

  return (
    <DrawerWithProps
      title={drawerTitle || intl.formatMessage({ id: 'digitalEmployee.title' })}
      width={'80%'}
      onCancel={onCancel}
      open={visible}
      bodyStyle={{ padding: 0 }}
      footer={false}
    >
      <div className={styles.page}>
        <div className={styles.header}>
          <div className={styles.tabs}>
            {showTabs &&
              tabList?.map((item: any) => (
                <div
                  key={item.key}
                  className={classNames(styles.tab, activeKey === item.key ? styles.active : '')}
                  onClick={() => {
                    setActiveKey(item.key);
                    setPageInfo({
                      ...pageInfo,
                      pageNum: 1,
                    });
                  }}
                >
                  {item.title}({item.total || 0})
                </div>
              ))}
          </div>
          <Input
            suffix={
              <AntdIcon
                type="icon-a-Searchsousuo"
                onClick={() => {
                  setPageInfo({ ...pageInfo, pageNum: 1 });
                }}
              />
            }
            style={{ width: 216 }}
            placeholder={intl.formatMessage({
              id: 'digitalEmployee.searchPlaceholder',
            })}
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
            }}
            onPressEnter={() => {
              setPageInfo({ ...pageInfo, pageNum: 1 });
            }}
          />
        </div>
        <div className={styles.content}>
          <ResizeTable
            rowKey={(record: any) => String(record?.resourceIdStr ?? record?.resourceId ?? record?.objId ?? '')}
            columns={columns}
            loading={loading}
            dataSource={data?.dataSource || []}
          />
        </div>
        <div>
          <Layout
            // className="pageFooter"
            left={<div />}
            right={
              <Pagination
                showQuickJumper
                showSizeChanger
                size="small"
                showTotal={(tot) => intl.formatMessage({ id: 'digitalEmployee.total' }, { total: tot })}
                current={pageInfo.pageNum}
                pageSize={pageInfo.pageSize}
                onChange={listChange}
                total={data.total}
                className={styles.pagination}
              />
            }
          >
            <div />
          </Layout>
        </div>
      </div>
    </DrawerWithProps>
  );
};

export default connect()(DigitalEmployeeAuthor);
