import { Button, Popconfirm, Tag, Tooltip } from 'antd';
import classNames from 'classnames';
import React from 'react';
import { useIntl } from '@umijs/max';
import styles from './ModelCard.module.less';

type Props = {
  data: any;
  current?: boolean;
  onEdit: () => void;
  onDebug: () => void;
  onDelete: () => void;
  onSetStatus?: (status: string) => void;
};

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  ENABLED: { color: 'success', label: 'personalModel.status.enabled' },
  DISABLED: { color: 'default', label: 'personalModel.status.disabled' },
};

const ModelCard: React.FC<Props> = ({ data, current, onEdit, onDebug, onDelete, onSetStatus }) => {
  const intl = useIntl();
  const { modelType, displayName, status, modelCode, providerName, contextTokens } = data || {};
  const statusInfo = STATUS_MAP[status] || STATUS_MAP.DISABLED;
  const isEnabled = status === 'ENABLED';

  return (
    <div className={classNames(styles.cardItem, { [styles.cardCurrent]: current })}>
      <div className={styles.cardAccent} />
      <div className={styles.cardHead}>
        <div className={styles.titleBlock}>
          <div className={styles.titleRow}>
            <div className={classNames(styles.title, 'ellipsis')} title={displayName}>
              {displayName || '-'}
            </div>
            {/* {current && (
              <Tag color="blue" className={styles.currentTag}>
                {intl.formatMessage({ id: 'personalModel.currentInUse' })}
              </Tag>
            )} */}
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
        <div className={styles.btnGroup}>
          <Popconfirm
            title={intl.formatMessage({
              id: isEnabled ? 'personalModel.confirmDisable' : 'personalModel.confirmEnable',
            })}
            onConfirm={() => onSetStatus?.(isEnabled ? 'DISABLED' : 'ENABLED')}
          >
            <Button type="link" size="small">
              {intl.formatMessage({ id: isEnabled ? 'personalModel.action.disable' : 'personalModel.action.enable' })}
            </Button>
          </Popconfirm>
          <Button type="link" size="small" onClick={onEdit}>
            {intl.formatMessage({ id: 'personalModel.edit' })}
          </Button>
          <Button type="link" size="small" onClick={onDebug}>
            {intl.formatMessage({ id: 'personalModel.debug' })}
          </Button>
          <Popconfirm title={intl.formatMessage({ id: 'personalModel.delete.confirm' })} onConfirm={onDelete}>
            <Button type="link" size="small" danger>
              {intl.formatMessage({ id: 'personalModel.delete' })}
            </Button>
          </Popconfirm>
        </div>
      </div>
    </div>
  );
};

export default ModelCard;
