import { GET, POST } from '@/service/common/request';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export const queryStoragePackages = () => GET<any>('/byaiService/storage/admin/packages', {}, withCustomHandle);

export const queryStorageSettings = () => GET<any>('/byaiService/storage/admin/settings', {}, withCustomHandle);

export const updateStorageSettings = (params: any) => POST<any>('/byaiService/storage/admin/settings', params);

export const upsertStoragePackage = (params: any) => POST<any>('/byaiService/storage/admin/packages/upsert', params);

export const deleteStoragePackage = (params: any) => POST<any>('/byaiService/storage/admin/packages/delete', params);

export const queryStorageUsers = (params: any) =>
  POST<any>('/byaiService/storage/admin/users/page', params, withCustomHandle);

export const queryActiveStorageGrants = (params: any) =>
  POST<any>('/byaiService/storage/admin/grants/page', params, withCustomHandle);

export const grantStoragePackage = (params: any) => POST<any>('/byaiService/storage/admin/users/grant', params);

export const revokeStorageGrant = (params: any) => POST<any>('/byaiService/storage/admin/users/revoke', params);

export const previewStorageGrantCancellation = (params: any) =>
  POST<any>('/byaiService/storage/admin/grants/cancel/preview', params, withCustomHandle);

export const cancelStorageGrant = (params: any) => POST<any>('/byaiService/storage/admin/grants/cancel', params);

export const queryStorageCancellations = (params: any) =>
  POST<any>('/byaiService/storage/admin/changes/page', params, withCustomHandle);

export const approveStorageCancellation = (params: any) =>
  POST<any>('/byaiService/storage/admin/changes/approve', params);

export const rejectStorageCancellation = (params: any) =>
  POST<any>('/byaiService/storage/admin/changes/reject', params);

export const resetStorage = (params: any) => POST<any>('/byaiService/storage/admin/users/reset', params);

export const restoreStorage = (params: any) => POST<any>('/byaiService/storage/admin/users/restore', params);

export const queryStorageRecycles = (params: any) =>
  POST<any>('/byaiService/storage/admin/users/recycles', params, withCustomHandle);

export const queryStorageRecyclePreview = (params: any) =>
  POST<any>('/byaiService/storage/admin/users/recycles/preview/list', params, withCustomHandle);

export const downloadStorageRecyclePreview = (userId: string | number, recycleId: string | number, path: string) =>
  GET<Blob>(
    '/byaiService/storage/admin/users/recycles/preview/download',
    { userId, recycleId, path },
    { responseType: 'blob' }
  );
