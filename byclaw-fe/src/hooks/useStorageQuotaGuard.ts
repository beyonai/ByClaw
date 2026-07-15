import { useCallback, useEffect, useState } from 'react';

import { getStorageQuota, type StorageQuotaData } from '@/service/storageQuota';
import { getToken } from '@/utils/auth';
import { formatStorageBytes, getUploadQuotaBlockReason, isStorageQuotaWriteBlocked } from '@/utils/storageQuota';
import { useIntl } from '@umijs/max';
import { App } from 'antd';

export default function useStorageQuotaGuard() {
  const intl = useIntl();
  const { message } = App.useApp();
  const [quota, setQuota] = useState<StorageQuotaData>();
  const authToken = getToken();

  const refreshQuota = useCallback(async () => {
    try {
      const response = await getStorageQuota();
      const nextQuota = response?.code === undefined || response.code === 0 ? response.data : undefined;
      setQuota(nextQuota);
      return nextQuota;
    } catch {
      // The backend remains the authoritative guard if this best-effort preview cannot be refreshed.
      setQuota(undefined);
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!authToken) {
      setQuota(undefined);
      return;
    }
    void refreshQuota();
  }, [authToken, refreshQuota]);

  const checkUpload = useCallback(
    (files: File[]) => {
      const selectedBytes = files.reduce((total, file) => total + Math.max(0, file.size || 0), 0);
      const reason = getUploadQuotaBlockReason(quota, selectedBytes);
      if (!reason) return true;

      if (reason === 'WRITE_BLOCKED') {
        message.error(intl.formatMessage({ id: 'storageQuota.upload.blocked' }));
      } else {
        message.error(
          intl.formatMessage(
            { id: 'storageQuota.upload.insufficient' },
            {
              selected: formatStorageBytes(selectedBytes),
              remaining: formatStorageBytes(quota?.remainingBytes || 0),
            }
          )
        );
      }
      return false;
    },
    [intl, message, quota]
  );

  return {
    quota,
    uploadDisabled: isStorageQuotaWriteBlocked(quota),
    checkUpload,
    refreshQuota,
  };
}
