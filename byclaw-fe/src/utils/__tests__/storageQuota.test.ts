import { formatStorageBytes, getUploadQuotaBlockReason, isStorageQuotaWriteBlocked } from '../storageQuota';
import type { StorageQuotaData } from '@/service/storageQuota';

const quota = (overrides: Partial<StorageQuotaData> = {}): StorageQuotaData => ({
  baseQuotaBytes: 2048,
  addonQuotaBytes: 0,
  totalQuotaBytes: 2048,
  usedBytes: 1024,
  remainingBytes: 1024,
  usagePercent: 50,
  usageStatus: 'NORMAL',
  provisionStatus: 'READY',
  quotaSyncStatus: 'SYNCED',
  ...overrides,
});

describe('storage quota upload guard', () => {
  it.each(['EXCEEDED', 'RESETTING', 'RESTORING'])('blocks non-writable status %s', (usageStatus) => {
    expect(isStorageQuotaWriteBlocked(quota({ usageStatus }))).toBe(true);
    expect(getUploadQuotaBlockReason(quota({ usageStatus }), 1)).toBe('WRITE_BLOCKED');
  });

  it('blocks a batch larger than the remaining quota before upload', () => {
    expect(getUploadQuotaBlockReason(quota(), 1025)).toBe('INSUFFICIENT_REMAINING');
    expect(getUploadQuotaBlockReason(quota(), 1024)).toBeUndefined();
  });

  it('blocks writes while an add-on cancellation request is awaiting review', () => {
    const cancellationPending = quota({ writeBlocked: true, writeBlockReason: 'DOWNGRADE_FROZEN' });

    expect(isStorageQuotaWriteBlocked(cancellationPending)).toBe(true);
    expect(getUploadQuotaBlockReason(cancellationPending, 1)).toBe('WRITE_BLOCKED');
  });

  it('formats quota values for localized messages', () => {
    expect(formatStorageBytes(1536)).toBe('1.50 KB');
  });
});
