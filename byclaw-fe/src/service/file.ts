import { GET, POST } from '@/service/common/request';
import type { IQueryFile } from '@/typescript/file';

/** datasetController/download 查询参数 */
export type DownloadDatasetFileParams = {
  resourceId: string | number;
  directoryPath: string;
};

export function normalizeDatasetDirectoryPath(p: string): string {
  const t = String(p ?? '').trim();
  if (!t) return '/';
  return t.startsWith('/') ? t : `/${t}`;
}

/** 从上传/查询返回的 queryFile 推断下载参数（缺 resourceId 或路径时返回 null） */
export function getDatasetDownloadParamsFromQueryFile(
  qf: (Partial<IQueryFile> & { resourceId?: string | number; directoryPath?: string }) | undefined | null
): DownloadDatasetFileParams | null {
  if (!qf) return null;
  const resourceId = qf.resourceId ?? qf.datasetId;
  const name = qf.fileName !== null && qf.fileName !== undefined && qf.fileName !== '' ? String(qf.fileName) : '';
  const directoryPathRaw =
    qf.directoryPath !== null && qf.directoryPath !== undefined && String(qf.directoryPath).trim() !== ''
      ? String(qf.directoryPath)
      : name
        ? name.startsWith('/')
          ? name
          : `/${name}`
        : '';
  if (resourceId === null || resourceId === undefined || `${resourceId}` === '' || !directoryPathRaw) {
    return null;
  }
  return { resourceId, directoryPath: normalizeDatasetDirectoryPath(directoryPathRaw) };
}

// 上传图标
export const callDomainServiceByMultipart = (data: FormData) =>
  POST<any>('/byaiService/commonFile/uploadIcon', data, {
    timeout: 480000,
    headers: {
      'Content-Type': 'multipart/form-data; charset=utf-8',
    },
  });

export const uploadImage = (data: FormData) =>
  POST<any>('/byaiService/search/upload-image', data, {
    timeout: 480000,
    headers: {
      'Content-Type': 'multipart/form-data; charset=utf-8',
    },
  });

export const uploadFiles = (data: FormData) =>
  POST<any>('/byaiService/chat/uploadFiles', data, {
    timeout: 480000,
    headers: {
      'Content-Type': 'multipart/form-data; charset=utf-8',
    },
  }).then((res) => {
    return {
      ...res,
      rebuildFileList: res.uploadItems || [],
    };
  });

// 下载知识库文件
export const downloadResourceFile = (params: DownloadDatasetFileParams) =>
  GET<any>(
    '/byaiService/datasetController/download',
    {
      resourceId: params.resourceId,
      directoryPath: normalizeDatasetDirectoryPath(params.directoryPath),
    },
    {
      responseType: 'blob',
    }
  );

export const downloadMinIOFileURL = '/byaiService/commonFile/download';
// 下载MinIO文件
export const downloadMinIOFile = (params: { fileId: string | number }) =>
  GET<any>(
    downloadMinIOFileURL,
    {
      ...params,
    },
    {
      responseType: 'blob',
    }
  );
