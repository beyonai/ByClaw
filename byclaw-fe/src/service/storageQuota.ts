import { GET, POST } from '@/service/common/request';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export type StorageQuotaData = {
  baseQuotaBytes: number;
  addonQuotaBytes: number;
  totalQuotaBytes: number;
  usedBytes: number;
  reservedBytes?: number;
  remainingBytes: number;
  usagePercent: number;
  usageStatus: string;
  provisionStatus: string;
  quotaSyncStatus: string;
  lastScanTime?: string;
  writeBlocked?: boolean;
  writeBlockReason?: string;
  downgradeId?: string;
  downgradeStatus?: string;
  downgradeTargetQuotaBytes?: number;
  downgradeGraceDeadline?: string;
};

export type StorageGrantData = {
  grantId: string;
  userId: string;
  userCode?: string;
  packageId?: string;
  packageCode?: string;
  packageName?: string;
  grantedBytes: number;
  grantStatus: string;
  grantSource: string;
  grantedByCode?: string;
  grantedTime?: string;
  remark?: string;
};

export type StoragePackageData = {
  packageId: string;
  packageCode: string;
  packageName: string;
  addonBytes: number;
  price?: number;
  status: string;
  remark?: string;
};

export type StorageCancellationPreview = {
  grantId: string;
  grantIds?: string[];
  userId: string;
  userCode?: string;
  packageId?: string;
  packageCode?: string;
  packageName?: string;
  packageNames?: string;
  selectedGrantCount?: number;
  grantSource?: string;
  grantedBytes: number;
  beforeQuotaBytes: number;
  targetQuotaBytes: number;
  usedBytes: number;
  reservedBytes: number;
  overageBytes: number;
  overQuotaAfterDowngrade: boolean;
  hasOpenRequest: boolean;
  graceDays: number;
};

export type StorageCancellationData = {
  downgradeId: string;
  requestId?: string;
  userId: string;
  userCode?: string;
  grantId: string;
  grantIds?: string;
  packageId?: string;
  packageCode?: string;
  packageName?: string;
  packageNames?: string;
  changeBytes?: number;
  requestSource: string;
  requestType: string;
  downgradeStatus: string;
  grantSource?: string;
  beforeQuotaBytes: number;
  targetQuotaBytes: number;
  usedBytesSnapshot: number;
  reservedBytesSnapshot: number;
  overageBytes: number;
  reason?: string;
  reviewRemark?: string;
  graceDeadline?: string;
  relatedRecycleId?: string;
  requestedByCode?: string;
  reviewedByCode?: string;
  requestedTime?: string;
  reviewedTime?: string;
  completedTime?: string;
  errorMessage?: string;
};

export type StorageChangeQuery = {
  pageNum: number;
  pageSize: number;
  downgradeStatus?: string;
  requestType?: string;
};

export type StoragePageData<T> = {
  records?: T[];
  list?: T[];
  current?: number;
  size?: number;
  total?: number;
};

export type StorageQuotaResponse = {
  code?: number;
  msg?: string;
  data?: StorageQuotaData;
};

export function getStorageQuota() {
  return GET<StorageQuotaResponse>('/byaiService/storage/quota', { _t: Date.now() }, withCustomHandle);
}

export function getStorageGrants() {
  return GET<{ data?: StorageGrantData[] }>('/byaiService/storage/grants', {}, withCustomHandle);
}

export function getStoragePackages() {
  return GET<{ data?: StoragePackageData[] }>('/byaiService/storage/packages', {}, withCustomHandle);
}

export function applyStorageAddition(params: { packageId: string; reason: string }) {
  return POST('/byaiService/storage/changes/add/apply', params);
}

export function previewStorageCancellation(grantIds: string[] | string) {
  return POST<{ data?: StorageCancellationPreview }>(
    '/byaiService/storage/changes/cancel/preview',
    Array.isArray(grantIds) ? { grantIds } : { grantId: grantIds },
    withCustomHandle
  );
}

export function applyStorageCancellation(params: { grantIds: string[]; reason: string }) {
  return POST('/byaiService/storage/changes/cancel/apply', params);
}

export function withdrawStorageCancellation(downgradeId: string) {
  return POST('/byaiService/storage/changes/withdraw', { downgradeId });
}

export function getStorageCancellations() {
  return GET<{ data?: StorageCancellationData[] }>('/byaiService/storage/cancellations', {}, withCustomHandle);
}

export function archiveStorageCancellation(downgradeId: string) {
  return POST('/byaiService/storage/changes/archive', { downgradeId });
}

export function queryStorageChanges(params: StorageChangeQuery) {
  return POST<{ data?: StoragePageData<StorageCancellationData> }>(
    '/byaiService/storage/changes/page',
    params,
    withCustomHandle
  );
}
