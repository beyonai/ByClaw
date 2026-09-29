import { GET, POST, request } from '@/service/common/request';

export type AppVersion = {

  /** 雪花id，后端序列化为字符串避免精度丢失 */
  versionId: string;

  /** 桌面端固定 electron，页面只读展示 */
  deviceType: string;
  platform?: string;
  arch?: string;
  channel?: string;
  appVersion: string;
  url: string;
  updateType?: string;
  updateMsg?: string;

  /** '1' 强制更新 / '0' 普通更新 */
  updateStatus?: string;
  fileName?: string;
  fileSize?: number;
  sha256?: string;

  /** draft / published / offline */
  releaseStatus?: string;
  publishTime?: string;
};

export type AppVersionPage = {
  pageNum: number;
  pageSize: number;
  total: number;
  totalPages: number;
  list: AppVersion[];
};

export type AppVersionPayload = {
  platform: string;
  arch: string;
  channel: string;
  appVersion: string;
  url: string;
  updateType?: string;
  updateMsg?: string;
  forceUpdate?: boolean;
  fileName?: string;
  fileSize?: number;
  sha256?: string;
  releaseStatus?: string;
};

export type AppVersionUploadResult = {
  fileName: string;
  fileSize: number;
  url: string;
  sha256: string;
};

const ADMIN_BASE = '/byaiService/api/v1/appVersion/admin';

export const getAppVersionCapability = () => GET<boolean>(`${ADMIN_BASE}/manage-capability`);

export const pageAppVersions = (params: Record<string, unknown>) => GET<AppVersionPage>(`${ADMIN_BASE}/page`, params);

export const createAppVersion = (payload: AppVersionPayload) => POST<AppVersion>(ADMIN_BASE, payload);

export const updateAppVersion = (versionId: string, payload: AppVersionPayload) =>
  request(`${ADMIN_BASE}/${encodeURIComponent(versionId)}`, payload, {}, 'PUT');

export const publishAppVersion = (versionId: string) =>
  request(`${ADMIN_BASE}/${encodeURIComponent(versionId)}/publish`, {}, {}, 'POST');

export const offlineAppVersion = (versionId: string) =>
  request(`${ADMIN_BASE}/${encodeURIComponent(versionId)}/offline`, {}, {}, 'POST');

export const deleteAppVersion = (versionId: string) =>
  request(`${ADMIN_BASE}/${encodeURIComponent(versionId)}`, {}, {}, 'DELETE');

/**
 * 上传安装包，返回的 url 直接作为版本记录的下载地址提交。
 * 必须显式声明 multipart：axios 实例默认 Content-Type 是 application/json，
 * 会把 FormData 序列化成 JSON，后端 consumes=multipart/form-data 会直接拒绝。
 */
export const uploadAppPackage = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return request(
    `${ADMIN_BASE}/upload`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data; charset=utf-8' } },
    'POST'
  ) as Promise<AppVersionUploadResult>;
};

/** 免登录下载地址，可直接给浏览器或桌面端使用 */
export const buildPackageDownloadUrl = (versionId: string) =>
  `/byaiService/api/v1/appVersion/package/${encodeURIComponent(versionId)}`;
