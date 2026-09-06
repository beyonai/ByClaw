import { GET, POST } from '@/service/common/request';

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
}

/** 桌面端自己托管、不走服务端对象存储的文件根目录。 */
const DESKTOP_FILE_ROOTS = ['/by/.sessions', '/by/.shared'];

function isDesktopFilePath(path?: string) {
  if (!path) return false;
  return DESKTOP_FILE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

type IDesktopFiles = NonNullable<IDesktopBridge['files']>;

/**
 * 取本地桥上的某个文件操作，取不到就返回 undefined，让调用方回落服务端。
 *
 * 两个条件缺一不可：
 * - 路径落在桌面端自己托管的根目录里（其余路径服务端才有）；
 * - 外壳确实带这个方法——页面是远端加载的，新页面经常跑在旧外壳上。
 *
 * 涉及多个路径的操作（移动、批量删除）要求全部命中，避免一半本地一半服务端。
 */
function desktopFiles<K extends keyof IDesktopFiles>(member: K, ...paths: Array<string | undefined>) {
  if (!paths.length || !paths.every(isDesktopFilePath)) return undefined;
  return window.byclawDesktop?.files?.[member];
}

export function listFiles(params: FileBrowserListParams) {
  // 桌面端的会话文件和共享文件落在本机工作区，服务端个人桶里没有对应对象。
  // 只有这两个根目录改走本地桥，其余路径仍由服务端文件浏览接口提供。
  //
  // 本机工作区没有资源桶的概念，所有本地分支都会忽略 resourceId。
  const local = desktopFiles('list', params.path);
  if (local) return local({ path: params.path }) as Promise<FileBrowserItem[]>;

  return POST<FileBrowserItem[]>('/byaiService/fileBrowser/list', params);
}

/**
 * 服务端接口，桌面端不分叉。
 *
 * defaultPath 返回的是服务端个人桶的默认落点，和本机工作区无关；
 * getChangedFileDiff 是服务端的 diff 服务，本地没有对应实现。
 */
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

/**
 * 把选中的文件写进本机工作区。
 *
 * File 过不了 contextBridge，所以在这边先读成字节再过桥。
 * 逐个文件回结果，只要有一个失败就抛，让调用方现有的 catch 能提示到具体文件名。
 */
async function writeDesktopFiles(write: NonNullable<IDesktopFiles['write']>, path: string, files: File[]) {
  const payload = await Promise.all(
    files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))
  );
  const results = await write({ path, files: payload });
  const failed = results.filter((item) => item.status === 'error');
  if (failed.length) {
    throw new Error(failed.map((item) => `${item.name}: ${item.message || '写入失败'}`).join('; '));
  }
  return results;
}

export function uploadFiles(
  resourceId: string | number,
  path: string,
  files: File[],
  onUploadProgress?: (e: any) => void
) {
  // 与 listFiles 同理：这两个根目录只存在于本机，传到服务端个人桶里模型也读不到。
  // 本地写盘没有上传阶段，onUploadProgress 不会被调用。
  const local = desktopFiles('write', path);
  if (local) return writeDesktopFiles(local, path, files);

  const formData = new FormData();
  formData.append('resourceId', String(resourceId));
  formData.append('path', path);
  files.forEach((file) => formData.append('files', file));
  return POST('/byaiService/fileBrowser/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  });
}

/**
 * 把桥返回的 base64 还原成和服务端下载接口一致的 `{ fileName, file }`。
 *
 * 调用方（预览、存到知识库、另存为、下载文件夹）拿到的都是 Blob，桌面端不能换形状，
 * 否则每个调用点都要分叉判断本地/服务端。
 */
function toBlobResponse(content: IDesktopFileContent) {
  const bytes = Uint8Array.from(atob(content.content), (char) => char.charCodeAt(0));
  return { fileName: content.name, file: new Blob([bytes]) };
}

export function downloadFile(resourceId: string | number, path: string) {
  const local = desktopFiles('read', path);
  if (local) return local({ path }).then(toBlobResponse);

  return GET<{ fileName: string; file: Blob }>(
    `/byaiService/fileBrowser/download`,
    { resourceId, path },
    { responseType: 'blob' }
  );
}

export function deleteFiles(params: FileBrowserDeleteParams) {
  const local = desktopFiles('delete', ...params.paths);
  if (local) return local({ paths: params.paths });

  return POST('/byaiService/fileBrowser/delete', params);
}

export function renameFile(params: FileBrowserRenameParams) {
  const local = desktopFiles('rename', params.sourcePath);
  if (local) return local({ path: params.sourcePath, newName: params.newName });

  return POST('/byaiService/fileBrowser/rename', params);
}

export function moveFiles(params: FileBrowserMoveParams) {
  const local = desktopFiles('move', ...params.sourcePaths, params.targetDirectory);
  if (local) return local({ paths: params.sourcePaths, targetDirectory: params.targetDirectory });

  return POST('/byaiService/fileBrowser/move', params);
}

export function copyFile(params: FileBrowserCopyParams) {
  const local = desktopFiles('copy', params.sourcePath, params.targetDirectory);
  if (local) return local({ path: params.sourcePath, targetDirectory: params.targetDirectory });

  return POST('/byaiService/fileBrowser/copy', params);
}

export function createFolder(params: FileBrowserCreateFolderParams) {
  const local = desktopFiles('mkdir', params.path);
  if (local) return local({ path: params.path });

  return POST('/byaiService/fileBrowser/createFolder', params);
}

export function ensureFolder(params: FileBrowserCreateFolderParams) {
  // 本地 mkdir 是幂等的，和 createFolder 共用一个桥方法。
  const local = desktopFiles('mkdir', params.path);
  if (local) return local({ path: params.path });

  return POST('/byaiService/fileBrowser/ensureFolder', params);
}

export interface FileBrowserSearchParams {
  resourceId: string | number;
  path: string;
  keyword: string;
}

export function searchFiles(params: FileBrowserSearchParams) {
  const local = desktopFiles('search', params.path);
  if (local) {
    return local({ path: params.path, keyword: params.keyword }) as Promise<FileBrowserItem[]>;
  }

  return POST<FileBrowserItem[]>('/byaiService/fileBrowser/search', params);
}

export function downloadFolder(resourceId: string | number, path: string) {
  // 桌面端在主进程打好 zip 再回 base64，还原后和服务端返回同形状。
  const local = desktopFiles('archive', path);
  if (local) return local({ path }).then(toBlobResponse);

  return GET<{ fileName: string; file: Blob }>(
    `/byaiService/fileBrowser/downloadFolder`,
    { resourceId, path },
    { responseType: 'blob' }
  );
}

/**
 * 服务端接口，桌面端不分叉。
 *
 * 目标是服务端知识库，本地没有落点。桌面端要把本机文件存进知识库，
 * 走 downloadFile 取字节 + 知识库上传接口（useSaveToKnowledge 已经是这个路径）。
 */
export function saveToKnowledge(params: FileBrowserSaveToKnowledgeParams) {
  return POST('/byaiService/fileBrowser/saveToKnowledge', params);
}
