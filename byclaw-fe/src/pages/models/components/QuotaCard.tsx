import React from 'react';
import { Card, Progress, Tooltip } from 'antd';
import { useIntl } from '@umijs/max';
import styles from './QuotaCard.module.less';

type ModelUsage = {
  modelCode: string;
  displayName: string;
  tokensUsed: number;
};

type QuotaProps = {
  quota: {
    used: number;
    modelUsages?: ModelUsage[];
    quotaLimit?: number;
    quotaUsed?: number;
    remaining?: number;
    exceeded?: boolean;
    resetDate?: string;
  } | null;
};

const QuotaCard: React.FC<QuotaProps> = ({ quota }) => {
  const intl = useIntl();

  if (!quota) return null;

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
  };

  const quotaLimit = quota.quotaLimit || 0;
  const quotaUsed = quota.quotaUsed || 0;
  const percent = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;
  const exceeded = quota.exceeded || false;

  return (
    <Card className={styles.card} size="small">
      <div className={styles.header}>
        <span className={styles.title}>{intl.formatMessage({ id: 'personalModel.quota.title' })}</span>
      </div>

      {quotaLimit > 0 && (
        <div className={styles.quotaSection}>
          <div className={styles.quotaLabel}>
            <span>{intl.formatMessage({ id: 'personalModel.quota.monthlyUsed' })}</span>
            <span>
              {formatTokens(quotaUsed)} / {formatTokens(quotaLimit)}
            </span>
          </div>
          <Progress
            percent={percent}
            size="small"
            strokeColor={exceeded ? '#ff4d4f' : percent > 80 ? '#faad14' : '#1677ff'}
            showInfo={false}
          />
          {exceeded && (
            <div className={styles.exceededTip}>
              {intl.formatMessage({ id: 'personalModel.quota.exceeded' })}
              {quota.resetDate &&
                ` (${intl.formatMessage({ id: 'personalModel.quota.resetTip' })}: ${quota.resetDate})`}
            </div>
          )}
          <div className={styles.quotaDesc}>{intl.formatMessage({ id: 'personalModel.quota.desc' })}</div>
        </div>
      )}

      <div className={styles.statsRow}>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{formatTokens(quota.used)}</span>
          <span className={styles.statLabel}>{intl.formatMessage({ id: 'personalModel.quota.totalTokens' })}</span>
        </div>
      </div>

      {quota.modelUsages && quota.modelUsages.length > 0 && (
        <div className={styles.usages}>
          <div className={styles.usagesTitle}>{intl.formatMessage({ id: 'personalModel.quota.byModel' })}</div>
          {quota.modelUsages.slice(0, 5).map((m) => {
            const barPercent = quotaUsed > 0 ? Math.min(100, Math.round((m.tokensUsed / quotaUsed) * 100)) : 0;
            return (
              <div key={m.modelCode} className={styles.usageItem}>
                <div className={styles.usageLeft}>
                  <Tooltip title={m.modelCode}>
                    <span className={styles.usageModel}>{m.displayName}</span>
                  </Tooltip>
                  <Progress
                    className={styles.usageProgress}
                    percent={barPercent}
                    size="small"
                    strokeColor="#1677ff"
                    showInfo={false}
                  />
                </div>
                <span className={styles.usageTokens}>{formatTokens(m.tokensUsed)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default QuotaCard;
