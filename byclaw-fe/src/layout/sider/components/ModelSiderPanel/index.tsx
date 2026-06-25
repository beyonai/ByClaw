import React, { useCallback, useEffect, useState } from 'react';
import { Badge, List, Progress, Spin, Tag } from 'antd';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { getMyModels, getMyQuota } from '@/pages/models/service';
import styles from './index.module.less';

const MODEL_TYPE_COLOR: Record<string, string> = {
  LLM: 'blue',
  RERANK: 'orange',
  EMBEDDING: 'green',
};

const ModelSiderPanel: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeSiderAgent = useActiveSiderAgent();
  const isModelsPage = pathname.startsWith('/models');

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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
        <Spin spinning={loading}>
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
            dataSource={models}
            locale={{ emptyText: intl.formatMessage({ id: 'personalModel.empty' }) }}
            renderItem={(item: any) => (
              <div className={styles.modelItem} onClick={() => navigate('/models')}>
                <div className={styles.modelName}>{item.displayName}</div>
                <div className={styles.modelMeta}>
                  <Tag color={MODEL_TYPE_COLOR[item.modelType] || 'default'}>{item.modelType}</Tag>
                  <Badge
                    status={item.status === 'ENABLED' ? 'success' : 'default'}
                    text={intl.formatMessage({
                      id: item.status === 'ENABLED' ? 'personalModel.status.enabled' : 'personalModel.status.disabled',
                    })}
                  />
                </div>
              </div>
            )}
          />
        </Spin>
      </div>
    </div>
  );
};

export default ModelSiderPanel;
