import { Button, Empty, Input, message, Spin } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl, useLocation, useSelector } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import CommonTabs from '@/components/CommonTabs';
import InfiniteScroll from 'react-infinite-scroll-component';
import { getCompositeAppInfo } from '@/service/digitalEmployees';
import useShowModal from '@/pages/manager/hooks/useShowModal';
import QuotaCard from './components/QuotaCard';
import ModelCard from './components/ModelCard';
import PublicModelCard from './components/PublicModelCard';
import ModelFormModal from './components/ModelFormModal';
import { deleteMyModel, getMyModelDetail, getMyModels, getMyQuota, getPublicModels, setModelStatus } from './service';
import styles from './index.module.less';

const PAGE_SIZE = 12;

type CurrentModelInfo = {
  model?: string;
  modelId?: string | number;
  modelCode?: string;
  modelNo?: string;
};

function unwrapData(res: any) {
  if (!res) return res;
  if (Object.prototype.hasOwnProperty.call(res, 'data')) return res.data;
  return res;
}

function safeJsonParse(value: any) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeModelValue(value: any) {
  return `${value ?? ''}`.trim();
}

function isCurrentModel(record: any, currentModelInfo?: CurrentModelInfo | null) {
  if (!record || !currentModelInfo) return false;
  const currentModelId = normalizeModelValue(currentModelInfo.modelId);
  if (currentModelId && normalizeModelValue(record.id) === currentModelId) return true;

  const currentValues = [currentModelInfo.modelCode, currentModelInfo.modelNo, currentModelInfo.model]
    .map(normalizeModelValue)
    .filter(Boolean);
  if (!currentValues.length) return false;

  return [record.modelCode, record.modelNo, record.displayName, record.modelName]
    .map(normalizeModelValue)
    .some((value) => value && currentValues.includes(value));
}

function getModelSortWeight(record: any, currentModelInfo?: CurrentModelInfo | null) {
  if (isCurrentModel(record, currentModelInfo)) return 0;
  if (record?.status === 'ENABLED') return 1;
  return 2;
}

function sortModelList(list: any[], currentModelInfo?: CurrentModelInfo | null) {
  return [...list].sort((prev, next) => {
    const prevWeight = getModelSortWeight(prev, currentModelInfo);
    const nextWeight = getModelSortWeight(next, currentModelInfo);
    return prevWeight - nextWeight;
  });
}

const ModelsPage: React.FC = () => {
  const intl = useIntl();
  const location = useLocation();
  const [formState, formAction] = useShowModal();
  const { handleShow } = formAction;
  const [activeTab, setActiveTab] = useState<string>('mine');

  const { agentId } = useGlobal();
  const { defaultDigEmployeeId, userInfo } = useSelector(({ employees, user }: any) => ({
    defaultDigEmployeeId: employees?.defaultDigEmployeeId,
    userInfo: user?.userInfo,
  }));
  const resourceId = useMemo(
    () => `${agentId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId || ''}`,
    [agentId, defaultDigEmployeeId, userInfo?.defaultDigEmployeeId]
  );
  const [currentModelInfo, setCurrentModelInfo] = useState<CurrentModelInfo | null>(null);

  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [pagination, setPagination] = useState({ pageNum: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false });

  const [publicList, setPublicList] = useState<any[]>([]);
  const [publicLoading, setPublicLoading] = useState(false);
  const [publicKeyword, setPublicKeyword] = useState('');
  const [publicPagination, setPublicPagination] = useState({
    pageNum: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    hasMore: false,
  });

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
    async (page = 1, append = false) => {
      setLoading(true);
      try {
        const res = await getMyModels({ pageNum: page, pageSize: PAGE_SIZE, keyword });
        const data = res?.data;
        if (data) {
          const rows = data.rows || data.list || [];
          const total = Number(data.total ?? data.totalCount ?? 0);
          setList((prev) => (append ? [...prev, ...rows] : rows));
          setPagination((prev) => ({
            ...prev,
            pageNum: page,
            total,
            hasMore: total > 0 ? page * PAGE_SIZE < total : rows.length >= PAGE_SIZE,
          }));
        }
      } finally {
        setLoading(false);
      }
    },
    [keyword]
  );

  const fetchPublicList = useCallback(
    async (page = 1, append = false) => {
      setPublicLoading(true);
      try {
        const res = await getPublicModels({ pageNum: page, pageSize: PAGE_SIZE, keyword: publicKeyword });
        const data = res?.data;
        if (data) {
          const rows = data.rows || data.list || [];
          const total = Number(data.total ?? data.totalCount ?? 0);
          setPublicList((prev) => (append ? [...prev, ...rows] : rows));
          setPublicPagination((prev) => ({
            ...prev,
            pageNum: page,
            total,
            hasMore: total > 0 ? page * PAGE_SIZE < total : rows.length >= PAGE_SIZE,
          }));
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
    let cancelled = false;
    if (!resourceId) {
      setCurrentModelInfo(null);
      return undefined;
    }
    (async () => {
      try {
        const res = await getCompositeAppInfo({ resourceId });
        const modelInfo = safeJsonParse(unwrapData(res)?.prologue)?.modelInfo || {};
        if (!cancelled) setCurrentModelInfo(modelInfo);
      } catch {
        if (!cancelled) setCurrentModelInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resourceId]);

  const sortedList = useMemo(() => {
    return sortModelList(list, currentModelInfo);
  }, [list, currentModelInfo]);

  const sortedPublicList = useMemo(() => {
    return sortModelList(publicList, currentModelInfo);
  }, [publicList, currentModelInfo]);

  useEffect(() => {
    if (activeTab === 'public') {
      fetchPublicList();
    }
  }, [activeTab, fetchPublicList]);

  const handleAdd = () => {
    formAction.handleShow('add');
  };

  const handleEdit = useCallback(
    async (record: any) => {
      try {
        const res = await getMyModelDetail({ id: record.id });
        if (res?.data) {
          handleShow('edit', res.data);
        }
      } catch {
        message.error('Failed to load model detail');
      }
    },
    [handleShow]
  );

  useEffect(() => {
    const state = (location.state || {}) as { editModelId?: string | number; editModelRequestId?: number };
    if (!state.editModelId) return;
    setActiveTab('mine');
    handleEdit({ id: state.editModelId });
  }, [handleEdit, location.state]);

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
    fetchList(1);
  };

  const loadMoreMine = () => {
    if (loading || !pagination.hasMore) return;
    void fetchList(pagination.pageNum + 1, true);
  };

  const loadMorePublic = () => {
    if (publicLoading || !publicPagination.hasMore) return;
    void fetchPublicList(publicPagination.pageNum + 1, true);
  };

  return (
    <div id="models-scroll-container" className={styles.container}>
      <QuotaCard quota={quota} />

      <div className={styles.headerBar}>
        <CommonTabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'mine', label: intl.formatMessage({ id: 'personalModel.tab.mine' }) },
            { key: 'public', label: intl.formatMessage({ id: 'personalModel.tab.public' }) },
          ]}
          className={styles.secondaryTabs}
        />
        <div className={styles.toolbar}>
          {activeTab === 'mine' ? (
            <>
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
            </>
          ) : (
            <Input
              placeholder={intl.formatMessage({ id: 'personalModel.search.placeholder' })}
              prefix={<SearchOutlined />}
              allowClear
              value={publicKeyword}
              onChange={(e) => setPublicKeyword(e.target.value)}
              onPressEnter={() => fetchPublicList(1)}
              className={styles.searchInput}
            />
          )}
        </div>
      </div>

      {activeTab === 'mine' && (
        <>
          <Spin spinning={loading}>
            {list.length > 0 ? (
              <>
                <InfiniteScroll
                  next={loadMoreMine}
                  hasMore={pagination.hasMore}
                  dataLength={list.length}
                  scrollableTarget="models-scroll-container"
                  scrollThreshold="120px"
                  loader={<Spin />}
                  endMessage={null}
                  style={{ overflow: 'visible' }}
                >
                  <div className={styles.grid}>
                    {sortedList.map((item) => (
                      <div key={item.id}>
                        <ModelCard
                          data={item}
                          current={isCurrentModel(item, currentModelInfo)}
                          onEdit={() => handleEdit(item)}
                          onDebug={() => handleDebug(item)}
                          onDelete={() => handleDelete(item)}
                          onSetStatus={(status) => handleSetStatus(item, status)}
                        />
                      </div>
                    ))}
                  </div>
                </InfiniteScroll>
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
          <Spin spinning={publicLoading}>
            {publicList.length > 0 ? (
              <>
                <InfiniteScroll
                  next={loadMorePublic}
                  hasMore={publicPagination.hasMore}
                  dataLength={publicList.length}
                  scrollableTarget="models-scroll-container"
                  scrollThreshold="120px"
                  loader={<Spin />}
                  endMessage={null}
                  style={{ overflow: 'visible' }}
                >
                  <div className={styles.grid}>
                    {sortedPublicList.map((item) => (
                      <div key={item.id}>
                        <PublicModelCard record={item} current={isCurrentModel(item, currentModelInfo)} />
                      </div>
                    ))}
                  </div>
                </InfiniteScroll>
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
