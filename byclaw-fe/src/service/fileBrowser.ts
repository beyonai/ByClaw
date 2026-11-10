import type { KnowledgeUploadItem } from '@/service/knowledgeCenter';
import { GET, POST } from '@/service/common/request';
import { hasAdmittedUpload, uploadResumableFile, type FileTransferProgress } from './resumableFileUpload';
import { hasDesktopLocalFiles } from '@/service/common/desktopLocal';

export interface PersonalStorageQuota {
  enabled: boolean;
  quotaBytes?: number;
  quotaGiB?: number;
  usedBytes?: number;
  usageObservedAt?: string;
}

export function getPersonalStorageQuota() {
  return GET<PersonalStorageQuota>(
    '/byaiService/personal/model/storage/quota',
    {},
    { responseCfg: { hideErrorTips: true } }
  );
}

const ownerUploadTails = new Map<string, Promise<void>>();

export interface FileBrowserItem {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  lastModified?: string;

  /** 代码仓库文件的外部链接（仅项目代码模块使用）。 */
  url?: string;

  /** 代码仓库文件的原始下载地址。 */
  downloadUrl?: string;
}

export interface ChangedFileDiff {
  version: number;
  uuid: string;
  sessionId: string;
  filePath: string;
  workspace: string;
  absolutePath: string;
  changeType: 'added' | 'deleted' | 'modified' | 'unchanged';
  changed: boolean;
  binary: boolean;
  contentEncoding: 'utf-8' | 'base64';
  originalExists: boolean;
  modifiedExists: boolean;
  originalMode: number | null;
  modifiedMode: number | null;
  originalSize: number;
  modifiedSize: number;
  originalContent: string | null;
  modifiedContent: string | null;
  additions: number;
  deletions: number;
  sources: string[];
}

export interface FileBrowserListParams {
  resourceId: string | number;
  path?: string;
  language?: string;

  /** 列表排序：文件夹优先，同类型按名称升序。 */
  sort?: 'DIRECTORY_FIRST_NAME_ASC' | string;
}

export interface FileBrowserDeleteParams {
  resourceId: string | number;
  paths: string[];
}

export interface FileBrowserRenameParams {
  resourceId: string | number;
  sourcePath: string;
  newName: string;
}

export interface FileBrowserMoveParams {
  resourceId: string | number;
  sourcePaths: string[];
  targetDirectory: string;
}

export interface FileBrowserCopyParams {
  resourceId: string | number;
  sourcePath: string;
  targetDirectory: string;
}

export interface FileBrowserCreateFolderParams {
  resourceId: string | number;
  path: string;
}

export interface FileBrowserSaveToKnowledgeParams {
  resourceId: string | number;
  sourcePath: string;
  sourceDir: boolean;
  targetResourceId: string | number;
  targetDirectoryPath: string;
  processFrontMatter?: boolean;
  overwrite?: boolean;

  /** Personal knowledge saves build by default; false imports without building. */
  buildAfterSave?: boolean;
}

export function listFiles(params: FileBrowserListParams, responseCfg?: Record<string, any>) {
  return POST<FileBrowserItem[]>('/byaiService/fileBrowser/list', params, { responseCfg });
}

export function getDefaultPath(resourceId: string | number) {
  return GET<string>(`/byaiService/fileBrowser/defaultPath`, { resourceId });
}

export function getChangedFileDiff(sessionId: string, uuid: string) {
  return GET<ChangedFileDiff>(
    '/byaiService/fileBrowser/getChangedFileDiff',
    { sessionId, uuid },
    { responseCfg: { hideErrorTips: true } }
  );
}

async function uploadFilesNow(
  resourceId: string | number,
  path: string,
  files: File[],
  onUploadProgress?: (e: any) => void,
  responseCfg?: Record<string, any>,
  transferOptions?: { ownerKey: string; overwrite?: boolean; checkContext?: () => void }
) {
  const checkContext = transferOptions?.checkContext;
  checkContext?.();
  if (hasDesktopLocalFiles() && window.byclawDesktop?.files?.registerAttachments) {
    return window.byclawDesktop.files.registerAttachments(files).then((registered) => {
      checkContext?.();
      return POST(
        '/byaiService/fileBrowser/upload',
        {
          resourceId,
          path,
          attachmentIds: registered.map((item) => item.attachmentId),
        },
        { responseCfg: { hideErrorTips: true } }
      );
    });
  }
  if (
    transferOptions?.ownerKey &&
    files.some((file) => file.size >= 8 * 1024 * 1024) &&
    files.every((file) => !file.name.toLowerCase().endsWith('.zip'))
  ) {
    const capability = await GET<{ resumable: boolean; maxSize?: number }>(
      '/byaiService/fileBrowser/uploads/capabilities'
    );
    checkContext?.();
    if (typeof capability?.resumable !== 'boolean') throw new Error('Invalid file transfer capability response');
    if (capability.resumable) {
      if (!capability.maxSize || !Number.isSafeInteger(capability.maxSize) || capability.maxSize <= 0) {
        throw new Error('Invalid file transfer maximum size');
      }
      for (const file of files) {
        if (
          file.size > capability.maxSize &&
          !(await hasAdmittedUpload(
            resourceId,
            path,
            file,
            transferOptions.ownerKey,
            transferOptions.overwrite,
            checkContext
          ))
        ) {
          throw new Error(`${file.name}: maximum upload size is ${capability.maxSize / 1024 / 1024} MiB`);
        }
      }
      for (const file of files) {
        await uploadResumableFile(
          resourceId,
          path,
          file,
          transferOptions.ownerKey,
          (progress: FileTransferProgress) => onUploadProgress?.(progress),
          transferOptions.overwrite,
          capability.maxSize,
          checkContext
        );
      }
      return;
    }
  }
  checkContext?.();
  const formData = new FormData();
  formData.append('resourceId', String(resourceId));
  formData.append('path', path);
  files.forEach((file) => formData.append('files', file));
  return POST('/byaiService/fileBrowser/upload', formData, {
    responseCfg: { hideErrorTips: true, ...responseCfg },
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  });
}

export async function uploadFiles(
  resourceId: string | number,
  path: string,
  files: File[],
  onUploadProgress?: (e: any) => void,
  responseCfg?: Record<string, any>,
  transferOptions?: { ownerKey: string; overwrite?: boolean; checkContext?: () => void }
) {
  const ownerKey = transferOptions?.ownerKey;
  if (!ownerKey) return uploadFilesNow(resourceId, path, files, onUploadProgress, responseCfg, transferOptions);
  // Storage nodes protect mutations with an owner-wide, non-waiting write claim.
  // Retain the whole file lane through completion so a batch cannot reject its own chunks.
  if (ownerUploadTails.has(ownerKey))
    files.forEach((file) => onUploadProgress?.({ loaded: 0, total: file.size, phase: 'queued', fileName: file.name }));
  const prior = ownerUploadTails.get(ownerKey) || Promise.resolve();
  const running = prior.then(() => {
    transferOptions?.checkContext?.();
    return uploadFilesNow(resourceId, path, files, onUploadProgress, responseCfg, transferOptions);
  });
  const tail = running.then(
    () => undefined,
    () => undefined
  );
  ownerUploadTails.set(ownerKey, tail);
  try {
    return await running;
  } finally {
    if (ownerUploadTails.get(ownerKey) === tail) ownerUploadTails.delete(ownerKey);
  }
}

export function downloadFile(resourceId: string | number, path: string) {
  return GET<{ fileName: string; file: Blob }>(
    `/byaiService/fileBrowser/download`,
    { resourceId, path },
    { responseType: 'blob' }
  );
}

export function deleteFiles(params: FileBrowserDeleteParams) {
  return POST('/byaiService/fileBrowser/delete', params);
}

export function renameFile(params: FileBrowserRenameParams) {
  return POST('/byaiService/fileBrowser/rename', params, { responseCfg: { hideErrorTips: true } });
}

export function moveFiles(params: FileBrowserMoveParams) {
  return POST('/byaiService/fileBrowser/move', params);
}

export function copyFile(params: FileBrowserCopyParams) {
  return POST('/byaiService/fileBrowser/copy', params);
}

export function createFolder(params: FileBrowserCreateFolderParams) {
  return POST('/byaiService/fileBrowser/createFolder', params);
}

export function ensureFolder(params: FileBrowserCreateFolderParams, responseCfg?: Record<string, any>) {
  return POST('/byaiService/fileBrowser/ensureFolder', params, { responseCfg });
}

export interface FileBrowserSearchParams {
  resourceId: string | number;
  path: string;
  keyword: string;
}

export function searchFiles(params: FileBrowserSearchParams) {
  return POST<FileBrowserItem[]>('/byaiService/fileBrowser/search', params);
}

export function downloadFolder(resourceId: string | number, path: string) {
  return GET<{ fileName: string; file: Blob }>(
    `/byaiService/fileBrowser/downloadFolder`,
    { resourceId, path },
    { responseType: 'blob' }
  );
}

export function saveToKnowledge(params: FileBrowserSaveToKnowledgeParams) {
  return POST('/byaiService/fileBrowser/saveToKnowledge', params);
}

export interface FileBrowserKnowledgeSaveResult {
  targetResourceId: string | number;
  targetDirectoryPath: string;
  createdFolderCount: number;
  uploadedFileCount: number;
  buildSubmittedCount: number;
  failedItems: KnowledgeUploadItem[];
  buildFailedItems: KnowledgeUploadItem[];
  postProcessErrors: string[];
}

export function saveToPersonalKnowledge(params: FileBrowserSaveToKnowledgeParams) {
  return POST<FileBrowserKnowledgeSaveResult>('/byaiService/fileBrowser/saveToPersonalKnowledge', params, {
    responseCfg: { hideErrorTips: true },
  });
}
