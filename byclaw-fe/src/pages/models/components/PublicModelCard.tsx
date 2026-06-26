import { Tag, Tooltip } from 'antd';
import classNames from 'classnames';
import dayjs from 'dayjs';
import React from 'react';
import { useIntl } from '@umijs/max';
import styles from './PublicModelCard.module.less';

type Props = {
  record: any;
};

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  ENABLED: { color: 'success', label: 'personalModel.status.enabled' },
  DISABLED: { color: 'default', label: 'personalModel.status.disabled' },
};

const PublicModelCard: React.FC<Props> = ({ record }) => {
  const intl = useIntl();
  const { modelType, displayName, status, modelCode, providerName, contextTokens, updatedAt } = record || {};
  const statusInfo = STATUS_MAP[status] || STATUS_MAP.DISABLED;

  return (
    <div className={styles.cardItem}>
      <div className={styles.cardAccent} />
      <div className={styles.cardHead}>
        <div className={styles.titleBlock}>
          <div className={classNames(styles.title, 'ellipsis')} title={displayName}>
            {displayName || '-'}
          </div>
          <div className={styles.subtitleRow}>
            <span className={styles.modelPill}>{modelType || 'LLM'}</span>
            <span className={classNames(styles.provider, 'ellipsis')} title={providerName}>
              {providerName || '-'}
            </span>
          </div>
        </div>
        <Tag color={statusInfo.color}>{intl.formatMessage({ id: statusInfo.label })}</Tag>
      </div>

      <div className={styles.content}>
        <div className={styles.metaGrid}>
          <div className={styles.metaCard}>
            <div className={styles.metaLabel}>{intl.formatMessage({ id: 'personalModel.form.modelCode' })}</div>
            <Tooltip title={modelCode || '-'}>
              <div className={classNames(styles.metaValue, 'ellipsis')}>{modelCode || '-'}</div>
            </Tooltip>
          </div>
          <div className={styles.metaCard}>
            <div className={styles.metaLabel}>Context</div>
            <Tooltip title={contextTokens ? `${contextTokens} tokens` : '-'}>
              <div className={styles.metaValue}>{contextTokens ? `${contextTokens} tokens` : '-'}</div>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className={styles.cardBottom}>
        <span className={styles.updateTime}>{updatedAt ? dayjs(updatedAt).format('YYYY-MM-DD HH:mm') : '-'}</span>
        <Tag className={styles.readonlyTag}>{intl.formatMessage({ id: 'personalModel.readonly' })}</Tag>
      </div>
    </div>
  );
};

export default PublicModelCard;
