import React, { useState } from 'react';
import { Button, Card, Popover, Progress, Spin, Tag } from 'antd';
import { InfoCircleOutlined, SettingOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import type { StorageQuotaData } from './service';
import StorageAddonManagerModal from './StorageAddonManagerModal';
import type { StorageAddonChangeType } from './StorageAddonManagerModal';
import styles from './index.module.less';

export type { StorageQuotaData };

interface StorageQuotaCardProps {
  quota?: StorageQuotaData;
  onQuotaChanged?: (changeType: StorageAddonChangeType) => Promise<void> | void;
}

const formatBytes = (bytes = 0) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
};

const StorageQuotaCard: React.FC<StorageQuotaCardProps> = ({ quota, onQuotaChanged }) => {
  const intl = useIntl();
  const [managerOpen, setManagerOpen] = useState(false);
  const t = (id: string, values?: Record<string, React.ReactNode>) => intl.formatMessage({ id }, values);
  if (!quota) return <Spin size="small" />;

  const percent = Math.min(100, Math.round(quota.usagePercent || 0));
  const exceeded = quota.usageStatus === 'EXCEEDED';
  const warning = quota.usageStatus === 'WARNING';

  const detail = (
    <div className={styles.quotaPopover}>
      <div>{t('storageQuota.user.personalStorage')}</div>
      <div>{t('storageQuota.user.totalCapacity', { size: formatBytes(quota.totalQuotaBytes) })}</div>
      <div>{t('storageQuota.user.basePermanent')}</div>
      <div>{t('storageQuota.user.usedCapacity', { size: formatBytes(quota.usedBytes) })}</div>
    </div>
  );

  return (
    <>
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title={
          <span>
            {t('storageQuota.user.cardTitle')}
            <Popover content={detail} placement="bottomLeft">
              <InfoCircleOutlined className={styles.quotaInfoIcon} />
            </Popover>
          </span>
        }
        extra={
          <Button size="small" icon={<SettingOutlined />} onClick={() => setManagerOpen(true)}>
            {t('storageQuota.user.managerTitle')}
          </Button>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span>{t('storageQuota.user.usedSpace')}</span>
          <span>
            {formatBytes(quota.usedBytes)} / {formatBytes(quota.totalQuotaBytes)}
          </span>
        </div>
        <Progress
          percent={percent}
          showInfo={false}
          strokeColor={exceeded ? '#ff4d4f' : warning ? '#faad14' : '#1677ff'}
        />
        <div style={{ marginTop: 8 }}>
          {quota.writeBlockReason === 'DOWNGRADE_FROZEN' ? (
            <Tag color="processing">{t('storageQuota.user.cancelReviewReadOnly')}</Tag>
          ) : null}
          {exceeded ? <Tag color="error">{t('storageQuota.user.exceeded')}</Tag> : null}
          {warning ? <Tag color="warning">{t('storageQuota.user.warning')}</Tag> : null}
          {!exceeded && !warning && quota.writeBlockReason !== 'DOWNGRADE_FROZEN' ? (
            <Tag color="success">{t('storageQuota.user.normal')}</Tag>
          ) : null}
        </div>
      </Card>
      <StorageAddonManagerModal open={managerOpen} onClose={() => setManagerOpen(false)} onChanged={onQuotaChanged} />
    </>
  );
};

export default StorageQuotaCard;
