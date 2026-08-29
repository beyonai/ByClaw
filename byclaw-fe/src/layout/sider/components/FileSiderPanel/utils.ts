import {
  CODE_TEXT_EXTENSIONS,
  isPreviewable,
} from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import { getFileIconType } from '@/constants/icon';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import type { FileBrowserItem } from '@/service/fileBrowser';
import { getHistoryState } from '@/utils/browser';
import {
  BYKC_FILE_PATH,
  DISPLAY_FILE_PATH_PREFIX,
  LOG_FILE_PATH,
  PROJECT_FILE_PATH,
  PROTECTED_ROOT_DIRECTORY_PATHS,
  ROOT_FILE_PATH,
  SESSION_FILE_PATH,
  SHARED_FILE_PATH,
  type FileCategoryItem,
  type FileCategoryKey,
  type FileCopyTargetType,
} from './constants';

/** 在线按文本读取的最大文件大小，避免浏览器一次性加载过大的源码/配置文件。 */
export const MAX_TEXT_PREVIEW_SIZE = 2 * 1024 * 1024;

const TEXT_FILE_NAMES = new Set([
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  '.dockerignore',
  'dockerfile',
  'makefile',
  'license',
  'procfile',
  'readme',
]);

const BINARY_EXTENSIONS = new Set([
  '7z',
  'avi',
  'bmp',
  'class',
  'deb',
  'dmg',
  'doc',
  'docx',
  'dll',
  'epub',
  'exe',
  'flac',
  'gif',
  'gz',
  'ico',
  'iso',
  'jar',
  'jpeg',
  'jpg',
  'mkv',
  'mov',
  'mp3',
  'mp4',
  'otf',
  'pdf',
  'png',
  'ppt',
  'pptx',
  'rar',
  'tar',
  'so',
  'ttf',
  'wav',
  'wasm',
  'webp',
  'webm',
  'woff',
  'woff2',
  'xls',
  'xlsx',
  'zip',
]);

const getLowerFileName = (name: string) => name.split('/').pop()?.toLowerCase() || '';

/** 没有标准扩展名的代码/配置文件按纯文本展示，例如 .gitignore、Dockerfile。 */
export function isTextFallbackFile(name: string) {
  const fileName = getLowerFileName(name);
  if (TEXT_FILE_NAMES.has(fileName)) return true;
  if (fileName.startsWith('.')) {
    return !BINARY_EXTENSIONS.has(fileName.split('.').pop() || '');
  }
  if (!fileName.includes('.')) return !BINARY_EXTENSIONS.has(fileName);
  return !BINARY_EXTENSIONS.has(fileName.split('.').pop() || '') && !isPreviewable(fileName);
}

export function isTextPreviewFile(name: string) {
  const extension = getLowerFileName(name).split('.').pop() || '';
  return (
    isTextFallbackFile(name) ||
    ['csv', 'md', 'txt', 'log', 'json', 'html', 'xml', ...CODE_TEXT_EXTENSIONS].includes(extension)
  );
}

export function getIconType(name: string, isDir: boolean): string {
  return getFileIconType(name, {
    isDirectory: isDir,
    directoryIconType: 'wenjianjialanse',
  });
}

export function isDirectory(item: FileBrowserItem) {
  return item.isDir || (item as any).dir;
}

export function canPreviewFile(item: FileBrowserItem) {
  if (isDirectory(item)) return false;
  if (isTextPreviewFile(item.name)) {
    return item.size === undefined || item.size <= MAX_TEXT_PREVIEW_SIZE;
  }
  return isPreviewable(item.name);
}

export function unwrapListResponse<T>(res: any): T[] {
  const data = res?.data ?? res ?? [];
  return Array.isArray(data) ? data : [];
}

export function ensureDirectoryPath(path: string) {
  return path.endsWith('/') ? path : `${path}/`;
}

export function getPathDepth(path: string) {
  return path.split('/').filter(Boolean).length;
}

export function sortFileBrowserItems(items: FileBrowserItem[]) {
  const dirs = items.filter((item) => isDirectory(item));
  const files = items.filter((item) => !isDirectory(item));
  return [...dirs, ...files];
}

export function joinKnowledgeDirectoryPath(parentPath: string, name: string) {
  return `${ensureDirectoryPath(parentPath)}${name}/`.replace(/\/+/g, '/');
}

export function getRawBlob(res: any) {
  return res?.file instanceof Blob ? res.file : res instanceof Blob ? res : new Blob([res?.file || res]);
}

export function normalizeReferenceItem(item: FileBrowserItem, resourceId: string) {
  const dir = isDirectory(item);
  return {
    ...item,
    id: item.path,
    collectionName: item.name,
    resourceId,
    type: dir ? 'directory' : 'file',
  };
}

export function getFileType(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  if (ext === 'jpeg') return 'jpg';
  if (['html', 'htm'].includes(ext)) return 'html';
  return ext;
}

export function getPreviewFileType(name: string) {
  return isTextFallbackFile(name) ? 'txt' : getFileType(name);
}

export function getNormalizedSessionId(sessionId?: string) {
  return `${sessionId || ''}`.trim();
}

export function getSessionFilePath(sessionId?: string) {
  const normalizedSessionId = getNormalizedSessionId(sessionId);
  return normalizedSessionId ? `${SESSION_FILE_PATH}${normalizedSessionId}/` : SESSION_FILE_PATH;
}

export function getDefaultFileCategoryKey(sessionId?: string): FileCategoryKey {
  return getNormalizedSessionId(sessionId) ? 'session' : 'root';
}

export function getCategoryActivePath(category: FileCategoryItem, sessionId?: string) {
  if (category.key === 'session') {
    return getSessionFilePath(sessionId);
  }
  return category.path;
}

export function normalizeFileBrowserPath(path?: string) {
  const pathWithoutSandboxRoot = path === '/by' ? '/' : path?.startsWith('/by/') ? path.substring(3) : path;
  if (pathWithoutSandboxRoot !== path) return normalizeFileBrowserPath(pathWithoutSandboxRoot);
  const normalizedPath = `${path || '/'}`.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalizedPath || normalizedPath === '/') {
    return '/';
  }
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

export function isProtectedRootDirectory(item: FileBrowserItem) {
  if (!isDirectory(item)) return false;
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(item.path)).toLowerCase();
  return getPathDepth(normalizedPath) === 1 && PROTECTED_ROOT_DIRECTORY_PATHS.has(normalizedPath);
}

export function getDisplayFileBrowserPath(path: string) {
  const normalizedPath = normalizeFileBrowserPath(path);
  return normalizedPath === ROOT_FILE_PATH
    ? `${DISPLAY_FILE_PATH_PREFIX}/`
    : `${DISPLAY_FILE_PATH_PREFIX}${normalizedPath}`;
}

export function getFallbackCurrentSessionId() {
  if (typeof window === 'undefined') return '';
  const querySessionId = new URLSearchParams(window.location.search).get('sessionId');
  return getNormalizedSessionId(
    querySessionId || getHistoryState('pcSessionId', '') || getHistoryState('mobileSessionId', '')
  );
}

export function getMessagePayloadSessionId(payload: any) {
  return getNormalizedSessionId(
    payload?.sessionId ||
      payload?.currentSessionId ||
      payload?.message?.sessionId ||
      payload?.message?.currentSessionId ||
      payload?.data?.sessionId ||
      payload?.data?.currentSessionId
  );
}

export function isPathIn(path: string, rootPath: string) {
  const normalizedPath = normalizeFileBrowserPath(path).toLowerCase();
  const normalizedRoot = ensureDirectoryPath(normalizeFileBrowserPath(rootPath)).toLowerCase();
  return normalizedPath === normalizedRoot.slice(0, -1) || normalizedPath.startsWith(normalizedRoot);
}

export function getCategoryRootPath(categoryKey: FileCategoryKey | undefined) {
  if (categoryKey === 'session') return SESSION_FILE_PATH;
  if (categoryKey === 'shared') return SHARED_FILE_PATH;
  if (categoryKey === 'project') return PROJECT_FILE_PATH;
  if (categoryKey === 'log') return LOG_FILE_PATH;
  return ROOT_FILE_PATH;
}

export function getFileActionScope(activeKey: FileCategoryKey | undefined, item: FileBrowserItem) {
  if (activeKey && activeKey !== 'root') {
    return activeKey;
  }
  const itemPath = normalizeFileBrowserPath(item.path);
  if (isPathIn(itemPath, BYKC_FILE_PATH)) return 'bykc';
  if (isPathIn(itemPath, SESSION_FILE_PATH)) return 'session';
  if (isPathIn(itemPath, SHARED_FILE_PATH)) return 'shared';
  if (isPathIn(itemPath, PROJECT_FILE_PATH)) return 'project';
  if (isPathIn(itemPath, LOG_FILE_PATH)) return 'log';
  return 'root';
}

export function getFileCategoryKeyByPath(path: string): FileCategoryKey {
  const itemPath = normalizeFileBrowserPath(path);
  if (isPathIn(itemPath, SESSION_FILE_PATH)) return 'session';
  if (isPathIn(itemPath, SHARED_FILE_PATH)) return 'shared';
  if (isPathIn(itemPath, PROJECT_FILE_PATH)) return 'project';
  if (isPathIn(itemPath, LOG_FILE_PATH)) return 'log';
  return 'root';
}

export function getCopyTargetPath(targetType: FileCopyTargetType, sessionId?: string) {
  return targetType === 'session' ? getSessionFilePath(sessionId) : SHARED_FILE_PATH;
}

export function buildTargetFolderPath(parentPath: string, folderName: string) {
  return `${ensureDirectoryPath(parentPath)}${folderName}/`.replace(/\/+/g, '/');
}

export function getParentDirectoryPath(path: string) {
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path));
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length <= 1) return ROOT_FILE_PATH;
  return `/${segments.slice(0, -1).join('/')}/`;
}

export function buildDirectoryPathChain(path: string) {
  const segments = ensureDirectoryPath(normalizeFileBrowserPath(path)).split('/').filter(Boolean);
  return segments.map((_, index) => `/${segments.slice(0, index + 1).join('/')}/`);
}

export function isSameDirectoryLevel(path: string, targetPath: string) {
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path));
  const normalizedTargetPath = ensureDirectoryPath(normalizeFileBrowserPath(targetPath));
  return getParentDirectoryPath(normalizedPath) === getParentDirectoryPath(normalizedTargetPath);
}

export function isAllowedUploadDirectoryTarget(path: string, basePath: string) {
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path));
  const normalizedBasePath = ensureDirectoryPath(normalizeFileBrowserPath(basePath || ROOT_FILE_PATH));
  if (normalizedPath === ROOT_FILE_PATH) return false;
  return (
    normalizedPath === normalizedBasePath ||
    isPathIn(normalizedPath, normalizedBasePath) ||
    isSameDirectoryLevel(normalizedPath, normalizedBasePath)
  );
}

export function buildScopedFolderPath(currentPath: string, rootPath: string) {
  const scopedRoot = ensureDirectoryPath(normalizeFileBrowserPath(rootPath));
  const scopedCurrent = ensureDirectoryPath(normalizeFileBrowserPath(currentPath));
  const paths = scopedRoot
    .split('/')
    .filter(Boolean)
    .map((segment, index, segments) => ({
      title: segment,
      id: `/${segments.slice(0, index + 1).join('/')}/`,
    }));
  if (!scopedCurrent.startsWith(scopedRoot) || scopedCurrent === scopedRoot) {
    return paths;
  }
  let accumulated = scopedRoot;
  const restSegments = scopedCurrent.slice(scopedRoot.length).split('/').filter(Boolean);
  for (const segment of restSegments) {
    accumulated += `${segment}/`;
    paths.push({ title: segment, id: accumulated });
  }
  return paths;
}

export function getBykcPathSegments(path: string) {
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path));
  if (!isPathIn(normalizedPath, BYKC_FILE_PATH)) return [];
  return normalizedPath.slice(BYKC_FILE_PATH.length).split('/').filter(Boolean);
}

export function normalizeMatchToken(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function getKnowledgeBaseMatchTokens(kb: IKnowledgeBaseItem) {
  const data = kb as any;
  return [
    data.resourceId,
    data.resourceCode,
    data.resourceName,
    data.collectionName,
    data.name,
    data.knCode,
    data.knowledgeCode,
    data.datasetId,
  ]
    .map(normalizeMatchToken)
    .filter(Boolean);
}

export function buildKnowledgeDirectoryPath(segments: string[]) {
  return segments.length ? `/${segments.join('/')}/`.replace(/\/+/g, '/') : '/';
}

export function resolveBykcKnowledgeUploadTarget(path: string, knowledgeBases: IKnowledgeBaseItem[]) {
  const segments = getBykcPathSegments(path);
  const firstSegment = normalizeMatchToken(segments[0]);
  if (!knowledgeBases.length) return null;

  if (firstSegment) {
    const matched = knowledgeBases.find((kb) => getKnowledgeBaseMatchTokens(kb).includes(firstSegment));
    if (matched) {
      return {
        knowledgeBase: matched,
        directoryPath: buildKnowledgeDirectoryPath(segments.slice(1)),
      };
    }
  }

  if (knowledgeBases.length === 1) {
    return {
      knowledgeBase: knowledgeBases[0],
      directoryPath: buildKnowledgeDirectoryPath(segments),
    };
  }

  return null;
}
