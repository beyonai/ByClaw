import React, { useCallback, useEffect, useState } from 'react';

import { DeleteOutlined, InfoCircleOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Divider, Input, message, Popconfirm } from 'antd';
import type { ColumnsType } from 'antd/es/table';
// @ts-ignore
import { useIntl } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';
import InfiniteScrollTable from '@/components/InfiniteScrollTable';
import useShowModal from '@/hooks/useShowModal';
import { getAccessToken, removeAccessToken } from '@/service/auth';
import { getDefaultPagination, IPagination } from '@/utils/pageInfo';
import { size } from 'lodash';
import AddTokenModal from './components/AddTokenModal';
import styles from './index.module.less';

interface TokenItem {
  userAccessTokenId: string;
  accessTokenName: string;
  createTime: string;
  lastActiveTime?: string;
}

const AccessTokenMgmt: React.FC = () => {
  const intl = useIntl();

  const [searchValue, setSearchValue] = useState<string>('');
  const [tokenList, setTokenList] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [pagination, setPagination] = useState<IPagination>(getDefaultPagination({ pageSize: 20 }));
  const { pageSize, pageIndex, total } = pagination;
  const hasMore = total > size(tokenList);

  const [modalState, modalAction] = useShowModal();

  // 获取令牌列表数据
  const getTokenList = useCallback(
    async (params?: Record<string, any>, loadMore: boolean = false) => {
      setLoading(true);
      try {
        const res = await getAccessToken({
          pageIndex,
          pageSize,
          keyword: searchValue,
          ...params,
        });

        const { list: rows, pageIndex: newPageIndex, pageSize: newPageSize, total: newTotal } = res || {};

        if (loadMore) {
          setTokenList((pre) => [...pre, ...rows]);
        } else {
          setTokenList(rows);
        }
        setPagination((pre) => ({
          ...pre,
          pageIndex: newPageIndex,
          pageSize: newPageSize,
          total: newTotal,
        }));
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    },
    [pageIndex, pageSize, searchValue]
  );

  // 首次加载
  useEffect(() => {
    getTokenList();
  }, []);

  // 删除令牌
  const handleDeleteToken = useCallback((id: string) => {
    setLoading(true);
    removeAccessToken({ userAccessTokenId: id })
      .then(() => {
        setTokenList((prev) => prev.filter((item) => item.userAccessTokenId !== id));
        setPagination((pre) => ({ ...pre, total: pre.total - 1 }));
        message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // 下载加密SDK
  const handleDownloadSDK = () => {};

  // 定义表格列
  const columns: ColumnsType<TokenItem> = [
    {
      title: intl.formatMessage({ id: 'accessToken.tokenName' }),
      dataIndex: 'accessTokenName',
      render: (text: string, record: TokenItem) => (
        <div className={styles.tokenInfo}>
          <div className={styles.tokenIcon}>
            <AntdIcon type="icon-a-Protectbaohu-1" style={{ fontSize: 20 }} />
          </div>
          <div className={styles.tokenDetails}>
            <div className={styles.tokenName}>{text}</div>
            <div className={styles.tokenTime}>
              {intl.formatMessage({ id: 'accessToken.addedAt' })}
              {record.createTime} –{' '}
              {record?.lastActiveTime
                ? `${intl.formatMessage({ id: 'accessToken.lastUsed' })}${record.lastActiveTime}`
                : intl.formatMessage({ id: 'accessToken.noRecentActivity' })}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: intl.formatMessage({ id: 'common.operation' }),
      dataIndex: 'action',
      width: 150,
      align: 'center',
      render: (_, record) => (
        <Popconfirm
          title={intl.formatMessage({ id: 'accessToken.confirmDelete' })}
          onConfirm={() => handleDeleteToken(record.userAccessTokenId)}
        >
          <Button type="text" danger icon={<DeleteOutlined />}>
            {intl.formatMessage({ id: 'accessToken.deleteToken' })}
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{intl.formatMessage({ id: 'accessToken.manageAccessTokens' })}</h1>
        <div className={styles.hint}>
          <InfoCircleOutlined />
          <span>{intl.formatMessage({ id: 'accessToken.tokenHint' })}</span>
        </div>
        <Divider style={{ margin: '14px 0' }} />
      </div>

      <div className={styles.toolbar}>
        <div className={styles.actions}>
          <Button type="primary" onClick={() => modalAction.handleShow('add')}>
            {intl.formatMessage({ id: 'accessToken.generateToken' })}
          </Button>
          <Button disabled onClick={handleDownloadSDK}>
            {intl.formatMessage({ id: 'accessToken.downloadSDK' })}
          </Button>
        </div>
        <div className={styles.search}>
          <Input
            placeholder={intl.formatMessage({ id: 'accessToken.searchToken' })}
            suffix={<SearchOutlined />}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            allowClear
            onPressEnter={() => getTokenList({ pageIndex: 1 })}
            style={{ width: 248 }}
          />
        </div>
      </div>

      <InfiniteScrollTable
        columns={columns}
        dataSource={tokenList || []}
        rowKey="userAccessTokenId"
        loading={loading}
        hasMore={hasMore}
        next={() => {
          if (loading || !hasMore) return;
          getTokenList({ pageIndex: pageIndex + 1 }, true);
        }}
        scrollDivId="accessTokenWrap"
        endMessage={
          <Divider plain>
            {intl.formatMessage({ id: 'common.endMessage' })}{' '}
            <span role="img" aria-label="emoji">
              🤐
            </span>
          </Divider>
        }
      />

      {modalState.open && (
        <AddTokenModal
          {...modalState}
          onCancel={() => {
            modalAction.onCancel();
            getTokenList({ pageIndex: 1 });
          }}
        />
      )}
    </div>
  );
};

export default AccessTokenMgmt;
