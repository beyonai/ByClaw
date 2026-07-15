import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, Spin } from 'antd';
import FileBrowserPanel from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import styles from './index.module.less';
import StorageQuotaCard, { StorageQuotaData } from './StorageQuotaCard';
import type { StorageAddonChangeType } from './StorageAddonManagerModal';
import { getStorageQuota } from './service';
import { isStorageQuotaWriteBlocked } from '@/utils/storageQuota';

const FilesPage: React.FC = () => {
  const activeSiderAgent = useActiveSiderAgent();
  const [quota, setQuota] = useState<StorageQuotaData>();
  const [fileBrowserRevision, setFileBrowserRevision] = useState(0);
  const quotaRequestRevision = useRef(0);

  const refreshQuota = useCallback(async () => {
    const requestRevision = ++quotaRequestRevision.current;
    try {
      const response = await getStorageQuota();
      if (requestRevision === quotaRequestRevision.current) {
        setQuota(response?.data);
      }
    } catch {
      // The backend remains the enforcement point when quota display is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    refreshQuota();
  }, [refreshQuota]);

  const refreshStorageState = useCallback(
    async (changeType: StorageAddonChangeType) => {
      await refreshQuota();
      if (changeType === 'ARCHIVED') {
        setFileBrowserRevision((revision) => revision + 1);
      }
    },
    [refreshQuota]
  );

  return (
    <div className={styles.container}>
      {/* <div className={styles.header}>
        <ActiveSiderAgentBar agent={activeSiderAgent} />
      </div> */}
      <div className={styles.content}>
        <StorageQuotaCard quota={quota} onQuotaChanged={refreshStorageState} />
        {activeSiderAgent.resourceId ? (
          <React.Suspense fallback={<Spin />}>
            <FileBrowserPanel
              key={`${activeSiderAgent.resourceId}-${fileBrowserRevision}`}
              resourceId={activeSiderAgent.resourceId}
              uploadDisabled={!quota || isStorageQuotaWriteBlocked(quota)}
              uploadRemainingBytes={quota?.remainingBytes}
              onUploadSuccess={refreshQuota}
            />
          </React.Suspense>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    </div>
  );
};

export default FilesPage;
