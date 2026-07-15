import type { StorageQuotaData } from '@/service/storageQuota';

export type UploadQuotaBlockReason = 'WRITE_BLOCKED' | 'INSUFFICIENT_REMAINING';

const NON_WRITABLE_STATUSES = new Set(['EXCEEDED', 'RESETTING', 'RESTORING']);

export function isStorageQuotaWriteBlocked(quota?: StorageQuotaData): boolean {
  if (!quota) return false;
  return Boolean(quota.writeBlocked) || NON_WRITABLE_STATUSES.has(quota.usageStatus) || quota.remainingBytes <= 0;
}

export function getUploadQuotaBlockReason(
  quota: StorageQuotaData | undefined,
  selectedBytes: number
): UploadQuotaBlockReason | undefined {
  if (!quota) return undefined;
  if (isStorageQuotaWriteBlocked(quota)) return 'WRITE_BLOCKED';
  if (Math.max(0, selectedBytes) > quota.remainingBytes) return 'INSUFFICIENT_REMAINING';
  return undefined;
}

export function formatStorageBytes(bytes = 0): string {
  const value = Math.max(0, bytes);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${value} B`;
}
