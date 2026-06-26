import { Button, Col, Empty, Input, message, Pagination, Row, Spin, Tabs } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import React, { useCallback, useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import useShowModal from '@/pages/manager/hooks/useShowModal';
import QuotaCard from './components/QuotaCard';
import ModelCard from './components/ModelCard';
import PublicModelCard from './components/PublicModelCard';
import ModelFormModal from './components/ModelFormModal';
import { deleteMyModel, getMyModelDetail, getMyModels, getMyQuota, getPublicModels, setModelStatus } from './service';
import styles from './index.module.less';

const PAGE_SIZE = 12;

const ModelsPage: React.FC = () => {
  const intl = useIntl();
  const [formState, formAction] = useShowModal();
  const [activeTab, setActiveTab] = useState<string>('mine');

  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [pagination, setPagination] = useState({ pageNum: 1, pageSize: PAGE_SIZE, total: 0 });

  const [publicList, setPublicList] = useState<any[]>([]);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicKeyword, setPublicKeyword] = useState('');
  const [publicPagination, setPublicPagination] = useState({ pageNum: 1, pageSize: PAGE_SIZE, total: 0 });

  const [quota, setQuota] = useState<{
    used: number;
    traces?: number;
    observations?: number;
    modelUsages?: { modelCode: string; displayName: string; tokensUsed: number }[];
    quotaLimit?: number;
    quotaUsed?: number;
    remaining?: number;
    exceeded?: boolean;
    resetDate?: string;
  } | null>(null);

  const fetchList = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const res = await getMyModels({ pageNum: page, pageSize: PAGE_SIZE, keyword });
        const data = res?.data;
        if (data) {
          setList(data.rows || data.list || []);
          setPagination((prev) => ({ ...prev, pageNum: page, total: data.total || 0 }));
        }
      } finally {
        setLoading(false);
      }
    },
    [keyword]
  );

  const fetchPublicList = useCallback(
    async (page = 1) => {
      setPublicLoading(true);
      try {
        const res = await getPublicModels({ pageNum: page, pageSize: PAGE_SIZE, keyword: publicKeyword });
        const data = res?.data;
        if (data) {
          setPublicList(data.rows || data.list || []);
          setPublicPagination((prev) => ({ ...prev, pageNum: page, total: data.total || 0 }));
        }
      } finally {
        setPublicLoading(false);
      }
    },
    [publicKeyword]
  );

  const fetchQuota = useCallback(async () => {
    try {
      const res = await getMyQuota();
      if (res?.data) {
        setQuota(res.data);
      }
    } catch {
      // backend not ready
    }
  }, []);

  useEffect(() => {
    fetchList();
    fetchQuota();
  }, [fetchList, fetchQuota]);

  useEffect(() => {
    if (activeTab === 'public') {
      fetchPublicList();
    }
  }, [activeTab, fetchPublicList]);

  const handleAdd = () => {
    formAction.handleShow('add');
  };

  const handleEdit = async (record: any) => {
    try {
      const res = await getMyModelDetail({ id: record.id });
      if (res?.data) {
        formAction.handleShow('edit', res.data);
      }
    } catch {
      message.error('Failed to load model detail');
    }
  };

  const handleDebug = async (record: any) => {
    try {
      const res = await getMyModelDetail({ id: record.id });
      if (res?.data) {
        formAction.handleShow('debug', res.data);
      }
    } catch {
      message.error('Failed to load model detail');
    }
  };

  const handleDelete = async (record: any) => {
    try {
      const res = await deleteMyModel({ id: record.id });
      if (res?.code !== 0 || res?.success === false) {
        message.error(res?.msg || intl.formatMessage({ id: 'personalModel.delete.failed' }), 5);
        return;
      }
      message.success(intl.formatMessage({ id: 'personalModel.delete.success' }));
      fetchList(pagination.pageNum);
    } catch (error: any) {
      const errorMsg =
        error?.response?.data?.msg ||
        error?.data?.msg ||
        error?.msg ||
        error?.message ||
        (typeof error === 'string' ? error : '');
      message.error(errorMsg || intl.formatMessage({ id: 'personalModel.delete.failed' }), 5);
    }
  };

  const handleSetStatus = async (record: any, status: string) => {
    const res = await setModelStatus({ id: record.id, status });
    if (res?.code !== 0) {
      message.error(res?.msg || intl.formatMessage({ id: 'personalModel.status.disabled' }));
      return;
    }
    message.success(
      intl.formatMessage({
        id: status === 'ENABLED' ? 'personalModel.status.enabled' : 'personalModel.status.disabled',
      })
    );
    fetchList(pagination.pageNum);
  };

  const handleSaved = () => {
    fetchList(pagination.pageNum);
  };

  return (
    <div className={styles.container}>
      <QuotaCard quota={quota} />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'mine', label: intl.formatMessage({ id: 'personalModel.tab.mine' }) },
          { key: 'public', label: intl.formatMessage({ id: 'personalModel.tab.public' }) },
        ]}
      />

      {activeTab === 'mine' && (
        <>
          <div className={styles.toolbar}>
            <Input
              placeholder={intl.formatMessage({ id: 'personalModel.search.placeholder' })}
              prefix={<SearchOutlined />}
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={() => fetchList(1)}
              className={styles.searchInput}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              {intl.formatMessage({ id: 'personalModel.add' })}
            </Button>
          </div>

          <Spin spinning={loading}>
            {list.length > 0 ? (
              <>
                <Row gutter={[16, 16]} className={styles.grid}>
                  {list.map((item) => (
                    <Col key={item.id} xs={24} sm={12} md={8} lg={6}>
                      <ModelCard
                        data={item}
                        onEdit={() => handleEdit(item)}
                        onDebug={() => handleDebug(item)}
                        onDelete={() => handleDelete(item)}
                        onSetStatus={(status) => handleSetStatus(item, status)}
                      />
                    </Col>
                  ))}
                </Row>
                {pagination.total > PAGE_SIZE && (
                  <div className={styles.pagination}>
                    <Pagination
                      current={pagination.pageNum}
                      pageSize={PAGE_SIZE}
                      total={pagination.total}
                      onChange={(page) => fetchList(page)}
                      showSizeChanger={false}
                    />
                  </div>
                )}
              </>
            ) : (
              !loading && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={intl.formatMessage({ id: 'personalModel.empty' })}
                />
              )
            )}
          </Spin>
        </>
      )}

      {activeTab === 'public' && (
        <>
          <div className={styles.toolbar}>
            <Input
              placeholder={intl.formatMessage({ id: 'personalModel.search.placeholder' })}
              prefix={<SearchOutlined />}
              allowClear
              value={publicKeyword}
              onChange={(e) => setPublicKeyword(e.target.value)}
              onPressEnter={() => fetchPublicList(1)}
              className={styles.searchInput}
            />
          </div>

          <Spin spinning={publicLoading}>
            {publicList.length > 0 ? (
              <>
                <Row gutter={[16, 16]} className={styles.grid}>
                  {publicList.map((item) => (
                    <Col key={item.id} xs={24} sm={12} md={8} lg={6}>
                      <PublicModelCard record={item} />
                    </Col>
                  ))}
                </Row>
                {publicPagination.total > PAGE_SIZE && (
                  <div className={styles.pagination}>
                    <Pagination
                      current={publicPagination.pageNum}
                      pageSize={PAGE_SIZE}
                      total={publicPagination.total}
                      onChange={(page) => fetchPublicList(page)}
                      showSizeChanger={false}
                    />
                  </div>
                )}
              </>
            ) : (
              !publicLoading && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={intl.formatMessage({ id: 'personalModel.empty' })}
                />
              )
            )}
          </Spin>
        </>
      )}

      <ModelFormModal {...formState} onCancel={formAction.onCancel} onSaved={handleSaved} />
    </div>
  );
};

export default ModelsPage;
