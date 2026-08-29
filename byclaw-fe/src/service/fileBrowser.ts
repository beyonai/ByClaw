import { GET, POST } from '@/service/common/request';

export interface FileBrowserItem {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  lastModified?: string;
}

export interface FileBrowserListParams {
  resourceId: string | number;
  path?: string;
  language?: string;
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
}

export function listFiles(params: FileBrowserListParams) {
  return POST<FileBrowserItem[]>('/byaiService/fileBrowser/list', params);
}

export function getDefaultPath(resourceId: string | number) {
  return GET<string>(`/byaiService/fileBrowser/defaultPath`, { resourceId });
}

export function uploadFiles(
  resourceId: string | number,
  path: string,
  files: File[],
  onUploadProgress?: (e: any) => void
) {
  const formData = new FormData();
  formData.append('resourceId', String(resourceId));
  formData.append('path', path);
  files.forEach((file) => formData.append('files', file));
  return POST('/byaiService/fileBrowser/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  });
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
  return POST('/byaiService/fileBrowser/rename', params);
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

export function ensureFolder(params: FileBrowserCreateFolderParams) {
  return POST('/byaiService/fileBrowser/ensureFolder', params);
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
