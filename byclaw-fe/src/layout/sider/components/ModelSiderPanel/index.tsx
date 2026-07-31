import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Descriptions, List, Progress, Spin, Tag } from 'antd';
import { useIntl, useLocation, useNavigate, useSelector } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import useGlobal from '@/hooks/useGlobal';
import { getMyModels, getMyQuota } from '@/pages/models/service';
import { getCompositeAppInfo } from '@/service/digitalEmployees';
import { getModelDetail } from '@/pages/manager/service/ModelMgr';
import styles from './index.module.less';

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

function isCurrentModel(record: any, currentModelInfo?: any) {
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

function sortModelList(list: any[], currentModelInfo?: any) {
  return [...list].sort((prev, next) => {
    const prevWeight = isCurrentModel(prev, currentModelInfo) ? 0 : prev?.status === 'ENABLED' ? 1 : 2;
    const nextWeight = isCurrentModel(next, currentModelInfo) ? 0 : next?.status === 'ENABLED' ? 1 : 2;
    return prevWeight - nextWeight;
  });
}

const ModelSiderPanel: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { EventEmitter } = useGlobal();
  const activeSiderAgent = useActiveSiderAgent();
  const isModelsPage = pathname.startsWith('/models');
  const { defaultDigEmployeeId, userInfo } = useSelector(({ employees, user }: any) => ({
    defaultDigEmployeeId: employees?.defaultDigEmployeeId,
    userInfo: user?.userInfo,
  }));

  // 模型列表与其它左侧资源面板统一使用当前联动员工。
  const resourceId = useMemo(
    () => `${activeSiderAgent.resourceId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId || ''}`,
    [activeSiderAgent.resourceId, defaultDigEmployeeId, userInfo?.defaultDigEmployeeId]
  );

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
  };

  const [quota, setQuota] = useState<{
    used: number;
    modelUsages?: any[];
    quotaLimit?: number;
    quotaUsed?: number;
    exceeded?: boolean;
  } | null>(null);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentDetail, setAgentDetail] = useState<any>(null);
  const [agentDetailLoading, setAgentDetailLoading] = useState(false);
  const [modelDetail, setModelDetail] = useState<any>(null);

  const modelInfo = useMemo(() => safeJsonParse(agentDetail?.prologue)?.modelInfo || {}, [agentDetail?.prologue]);
  const sortedModels = useMemo(() => sortModelList(models, modelInfo), [models, modelInfo]);

  const openModelEdit = useCallback(
    (model: any) => {
      if (!model?.id) {
        navigate('/models');
        return;
      }

      navigate('/models', {
        state: {
          keepSiderActiveKey: 'model',
          editModelId: model?.id,
          editModelRequestId: Date.now(),
        },
      });
    },
    [navigate]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [quotaRes, modelsRes] = await Promise.allSettled([getMyQuota(), getMyModels({ pageNum: 1, pageSize: 50 })]);
      if (quotaRes.status === 'fulfilled' && quotaRes.value?.data) {
        setQuota(quotaRes.value.data);
      }
      if (modelsRes.status === 'fulfilled') {
        const data = modelsRes.value?.data;
        setModels(data?.rows || data?.list || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAgentDetail = useCallback(async () => {
    if (!resourceId) return;
    setAgentDetailLoading(true);
    try {
      const res = await getCompositeAppInfo({ resourceId });
      const detail = unwrapData(res);
      setAgentDetail(detail);
      const mi = safeJsonParse(detail?.prologue)?.modelInfo || {};
      if (mi.modelId) {
        const modelRes = await getModelDetail({ id: `${mi.modelId}` });
        setModelDetail(unwrapData(modelRes));
      }
    } catch {
      // ignore
    } finally {
      setAgentDetailLoading(false);
    }
  }, [resourceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setAgentDetail(null);
    setModelDetail(null);
  }, [resourceId]);

  useEffect(() => {
    fetchAgentDetail();
  }, [fetchAgentDetail]);

  useEffect(() => {
    const handler = (payload?: { key?: string }) => {
      if (payload?.key === 'model') {
        fetchData();
        fetchAgentDetail();
      }
    };

    EventEmitter.on('sider-menu-tab-click-refresh', handler);
    return () => {
      EventEmitter.off('sider-menu-tab-click-refresh', handler);
    };
  }, [EventEmitter, fetchData, fetchAgentDetail]);

  return (
    <div className={styles.container}>
      <ActiveSiderAgentBar agent={activeSiderAgent} />
      <div
        className={styles.router}
        onClick={() =>
          navigate(
            isModelsPage ? { pathname: '/chat' } : '/models',
            isModelsPage ? { state: { keepSiderActiveKey: 'model' } } : undefined
          )
        }
      >
        <AntdIcon type="icon-a-Braindanao" />
        <span className={styles.middle}>{intl.formatMessage({ id: 'personalModel.title' })}</span>
        <AntdIcon
          type={isModelsPage ? 'icon-a-Leftzuo' : 'icon-a-Rightyou'}
          style={{ fontSize: 16, marginLeft: 'auto' }}
        />
      </div>

      <div className={styles.content}>
        <Spin spinning={loading || agentDetailLoading}>
          {agentDetail && (
            <Card className={styles.agentModelCard} size="small">
              <div className={styles.agentModelHeader}>
                <div className={styles.agentModelName}>
                  {modelInfo?.model ||
                    modelDetail?.modelName ||
                    intl.formatMessage({ id: 'fileBrowserEntry.model.notConfigured' })}
                </div>
                <Tag className={modelInfo?.modelId ? styles.currentModelTag : undefined} color="default">
                  {modelInfo?.modelId
                    ? intl.formatMessage({ id: 'fileBrowserEntry.debug.currentModel' })
                    : intl.formatMessage({ id: 'fileBrowserEntry.model.notConfiguredShort' })}
                </Tag>
              </div>
              <Descriptions column={2} size="small" className={styles.agentModelDesc}>
                <Descriptions.Item label={intl.formatMessage({ id: 'fileBrowserEntry.model.temperature' })}>
                  {modelInfo?.temperature ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label={intl.formatMessage({ id: 'fileBrowserEntry.model.history' })}>
                  {modelInfo?.history ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label={intl.formatMessage({ id: 'fileBrowserEntry.model.maxToken' })}>
                  {modelInfo?.maxToken ?? modelDetail?.maxContentToken ?? '-'}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          {quota && (
            <div className={styles.quotaCard}>
              <div className={styles.quotaTitle}>{intl.formatMessage({ id: 'personalModel.quota.title' })}</div>
              {quota.quotaLimit && quota.quotaLimit > 0 ? (
                <>
                  <div className={styles.quotaDetail}>
                    <span>
                      {intl.formatMessage({ id: 'personalModel.quota.monthlyUsed' })}:{' '}
                      {formatTokens(quota.quotaUsed || 0)} / {formatTokens(quota.quotaLimit)}
                    </span>
                  </div>
                  <Progress
                    percent={Math.min(100, Math.round(((quota.quotaUsed || 0) / quota.quotaLimit) * 100))}
                    size="small"
                    strokeColor={quota.exceeded ? '#ff4d4f' : '#1677ff'}
                    showInfo={false}
                  />
                </>
              ) : (
                <div className={styles.quotaDetail}>
                  <span>
                    {intl.formatMessage({ id: 'personalModel.quota.totalTokens' })}: {formatTokens(quota.used)}
                  </span>
                </div>
              )}
            </div>
          )}

          <List
            dataSource={sortedModels}
            locale={{ emptyText: intl.formatMessage({ id: 'personalModel.empty' }) }}
            renderItem={(item: any) => {
              const current = isCurrentModel(item, modelInfo);
              return (
                <div className={styles.modelItem} onClick={() => openModelEdit(item)}>
                  <div className={styles.modelHeader}>
                    <div className={styles.modelTitleLine}>
                      <div className={styles.modelName}>{item.displayName}</div>
                      <span className={styles.modelTypeTag}>{item.modelType || 'LLM'}</span>
                    </div>
                    <Tag className={current || item.status === 'ENABLED' ? styles.currentModelTag : undefined}>
                      {current
                        ? intl.formatMessage({ id: 'fileBrowserEntry.debug.currentModel' })
                        : intl.formatMessage({
                          id:
                              item.status === 'ENABLED'
                                ? 'personalModel.action.enable'
                                : 'personalModel.action.disable',
                        })}
                    </Tag>
                  </div>
                  <div className={styles.modelCode}>{item.modelCode || '-'}</div>
                </div>
              );
            }}
          />
        </Spin>
      </div>
    </div>
  );
};

export default ModelSiderPanel;
