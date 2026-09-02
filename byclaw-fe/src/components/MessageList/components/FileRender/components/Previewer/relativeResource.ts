import { getMimeType } from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import type { MarkdownImageResolver } from '@/components/Preview/Md';
import { getFileUrl } from '@/utils/file';

const isExternalResourcePath = (path: string) =>
  path.startsWith('/') || path.startsWith('#') || path.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(path);

const normalizeFilePath = (path: string) => {
  const isAbsolute = path.startsWith('/');
  const segments: string[] = [];

  path
    .replace(/\\/g, '/')
    .split('/')
    .forEach((segment) => {
      if (!segment || segment === '.') return;
      if (segment === '..') {
        segments.pop();
        return;
      }
      segments.push(segment);
    });

  const normalizedPath = segments.join('/');
  return isAbsolute ? `/${normalizedPath}` : normalizedPath;
};

export const resolveRelativeFilePath = (filePath: string, resourcePath: string) => {
  const normalizedFilePath = normalizeFilePath(filePath);
  const directoryPath = normalizedFilePath.slice(0, normalizedFilePath.lastIndexOf('/') + 1);
  const normalizedResourcePath = resourcePath.split(/[?#]/, 1)[0];
  return normalizeFilePath(`${directoryPath}${normalizedResourcePath}`);
};

const normalizeResourceBlob = (blob: Blob, resourcePath: string) => {
  if (!blob.size) throw new Error('Empty relative resource');
  const mimeType = getMimeType(resourcePath);
  return mimeType ? new Blob([blob], { type: mimeType }) : blob;
};

export const isSessionFilePath = (filePath: string) => /^\/(?:by\/)?\.sessions\//.test(normalizeFilePath(filePath));

const normalizeCommonFilePath = (filePath: string) => {
  const normalizedPath = normalizeFilePath(filePath);
  return normalizedPath.startsWith('/.sessions/') ? `/by${normalizedPath}` : normalizedPath;
};

export const getCommonFilePreviewUrl = (filePath: string) => {
  const previewUrl = new URL(getFileUrl('/commonFile/preview'), window.location.origin);
  previewUrl.searchParams.set('filePath', normalizeCommonFilePath(filePath));
  return previewUrl.toString();
};

const getRelativeResourceUrl = (fileUrl: string, resourcePath: string) => {
  const previewUrl = new URL(fileUrl, window.location.origin);
  const filePath = previewUrl.searchParams.get('filePath');
  if (filePath) {
    const resolvedPath = resolveRelativeFilePath(filePath, resourcePath);
    previewUrl.searchParams.set(
      'filePath',
      isSessionFilePath(filePath) ? normalizeCommonFilePath(resolvedPath) : resolvedPath
    );
    return previewUrl.toString();
  }
  return new URL(resourcePath, previewUrl).toString();
};

export const createRelativeResourceResolver = (fileUrl?: string): MarkdownImageResolver | undefined => {
  if (!fileUrl) return undefined;

  return async (resourcePath) => {
    if (isExternalResourcePath(resourcePath)) return resourcePath;

    const resourceUrl = getRelativeResourceUrl(fileUrl, resourcePath);
    // 预览文件可能在会话过程中被覆盖，禁止复用旧的相对资源 Blob。
    const requestUrl = new URL(resourceUrl, window.location.origin);
    requestUrl.searchParams.set('_previewTime', `${Date.now()}`);

    const request = fetch(requestUrl.toString(), { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error(response.statusText);
      const blob = await response.blob();
      return normalizeResourceBlob(blob, resourcePath);
    });

    return request;
  };
};

export const createRelativePathResourceResolver = (
  filePath: string,
  downloadResource: (resolvedPath: string) => Promise<Blob>
): MarkdownImageResolver => {
  const resourceCache = new Map<string, Promise<Blob>>();

  return async (resourcePath) => {
    if (isExternalResourcePath(resourcePath)) return resourcePath;

    const resolvedPath = resolveRelativeFilePath(filePath, resourcePath);
    if (isSessionFilePath(filePath)) return getCommonFilePreviewUrl(resolvedPath);

    const cached = resourceCache.get(resolvedPath);
    if (cached) return cached;

    const request = downloadResource(resolvedPath)
      .then((blob) => normalizeResourceBlob(blob, resourcePath))
      .catch((error) => {
        resourceCache.delete(resolvedPath);
        throw error;
      });

    resourceCache.set(resolvedPath, request);
    return request;
  };
};
