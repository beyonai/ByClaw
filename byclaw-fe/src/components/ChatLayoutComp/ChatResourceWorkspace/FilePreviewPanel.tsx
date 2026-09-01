import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, Spin, message } from 'antd';
import { getMimeType } from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import fileSiderStyles from '@/layout/sider/components/FileSiderPanel/index.module.less';
import {
  getPreviewFileType,
  MAX_TEXT_PREVIEW_SIZE,
  isTextPreviewFile,
} from '@/layout/sider/components/FileSiderPanel/utils';
import { downloadChatFileArtifact } from '@/service/chatFileArtifact';
import { downloadResourceFile } from '@/service/file';
import { downloadFile as downloadFileBrowserFile } from '@/service/fileBrowser';
import { getFileUrl } from '@/utils/file';
import type { MarkdownImageResolver } from '@/components/Preview/Md';
import styles from './index.module.less';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

interface FilePreviewPanelProps {
  fileName: string;
  resourceId?: string;
  path?: string;
  fileUrl?: string;
  sessionId?: string;
  source?: 'dataset' | 'fileBrowser';

  /**
   * 调用方已持有文件内容时直接传入，跳过下载。
   * 远程仓库文件走接口拿到的是字符串/base64，没有可下载的 resourceId+path 或 fileUrl。
   * data 为 null 时保持 loading 占位状态，等调用方异步填入真实内容。
   */
  content?: { data: string | null; binary?: boolean };
  onOpenRelativeFile?: (path: string) => void;
}

// 复用与下载分支相同的 Blob + mimeType 约定，让 Preview/Twins 对同一类文件走同一条渲染路径。
const contentToBlob = (data: string, binary: boolean | undefined, fileName: string) => {
  const mimeType = getMimeType(fileName);
  if (!binary) return new Blob([data], mimeType ? { type: mimeType } : undefined);
  const pureBase64 = data.includes(',') ? data.split(',').pop() || '' : data;
  const decoded = window.atob(pureBase64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return new Blob([bytes], mimeType ? { type: mimeType } : undefined);
};

const isExternalImagePath = (path: string) =>
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

const isSessionFilePath = (path: string) => /^\/(?:by\/)?\.sessions\//.test(normalizeFilePath(path));

const toSessionArtifactPath = (path: string) => {
  const normalizedPath = normalizeFilePath(path);
  return normalizedPath.startsWith('/by/')
    ? normalizedPath
    : `/by${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;
};

const resolveMarkdownImagePath = (markdownPath: string, imagePath: string) => {
  const normalizedMarkdownPath = normalizeFilePath(markdownPath);
  const directoryPath = normalizedMarkdownPath.slice(0, normalizedMarkdownPath.lastIndexOf('/') + 1);
  const resourcePath = imagePath.split(/[?#]/, 1)[0];
  if (resourcePath.startsWith('/')) return normalizeFilePath(resourcePath);
  return normalizeFilePath(`${directoryPath}${resourcePath}`);
};

// 会话目录中的 HTML 经常使用 ../../assets 这类相对路径；资源不应越过当前会话根目录。
const resolveSessionResourcePath = (sourcePath: string, resourcePath: string) => {
  const normalizedSourcePath = normalizeFilePath(sourcePath);
  const sessionRootMatch = normalizedSourcePath.match(/^(\/by\/\.sessions\/[^/]+)\//);
  const resolvedPath = resolveMarkdownImagePath(normalizedSourcePath, resourcePath);
  if (!sessionRootMatch || !resourcePath.includes('..')) return resolvedPath;

  const root = sessionRootMatch[1];
  const relativePath = resourcePath.split(/[?#]/, 1)[0].replace(/^\/+/, '');
  const baseSegments = normalizedSourcePath.slice(root.length).split('/').filter(Boolean).slice(0, -1);
  const segments = [...baseSegments];
  relativePath.split('/').forEach((segment) => {
    if (!segment || segment === '.') return;
    if (segment === '..') {
      if (segments.length) segments.pop();
      return;
    }
    segments.push(segment);
  });
  return normalizeFilePath(`${root}/${segments.join('/')}`);
};

const getFilePathFromUrl = (value?: string) => {
  if (!value) return undefined;
  try {
    const url = new URL(getFileUrl(value), window.location.origin);
    return url.searchParams.get('filePath') || undefined;
  } catch {
    return undefined;
  }
};

const normalizeCommonFilePath = (filePath: string) => {
  const normalizedPath = normalizeFilePath(filePath);
  return normalizedPath.startsWith('/.sessions/') ? `/by${normalizedPath}` : normalizedPath;
};

const getCommonFilePreviewUrl = (filePath: string) => {
  const previewUrl = new URL(getFileUrl('/commonFile/preview'), window.location.origin);
  previewUrl.searchParams.set('filePath', normalizeCommonFilePath(filePath));
  return previewUrl.toString();
};

const getFilePreviewUrl = (fileUrl: string, resourcePath: string, baseFilePath?: string) => {
  const previewUrl = new URL(getFileUrl(fileUrl), window.location.origin);
  const filePath = previewUrl.searchParams.get('filePath') || baseFilePath;
  if (filePath) {
    const resolvedPath = resolveMarkdownImagePath(filePath, resourcePath);
    previewUrl.searchParams.set(
      'filePath',
      isSessionFilePath(filePath) ? normalizeCommonFilePath(resolvedPath) : resolvedPath
    );
    return previewUrl.toString();
  }
  return new URL(resourcePath, previewUrl).toString();
};

const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  fileName,
  resourceId,
  path,
  fileUrl,
  sessionId,
  source = 'dataset',
  content,
  onOpenRelativeFile,
}) => {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const markdownImageCacheRef = useRef<Map<string, Promise<Blob>>>(new Map());
  const sourcePath = (() => {
    const rawPath = getFilePathFromUrl(path) || path;
    if (!rawPath) return rawPath;
    const normalizedRawPath = normalizeFilePath(rawPath);
    // 文件浏览器列表在部分接口响应中只返回相对当前会话目录的路径，补齐会话根路径后才能解析 HTML 内的相对图片。
    const normalized =
      source === 'fileBrowser' && sessionId && !isSessionFilePath(normalizedRawPath)
        ? `/by/.sessions/${sessionId}/${normalizedRawPath.replace(/^\/+/, '')}`
        : normalizedRawPath;
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length >= 2 && segments.at(-1) === segments.at(-2)) segments.pop();
    return `${normalized.startsWith('/') ? '/' : ''}${segments.join('/')}`;
  })();
  const previewFileUrl =
    fileUrl || (source === 'fileBrowser' && sourcePath ? getCommonFilePreviewUrl(sourcePath) : undefined);
  const previewType = getPreviewFileType(fileName);

  const loadFileBrowserFile = useCallback(
    async (filePath: string) => {
      const loadFromSessionArtifact = () =>
        downloadChatFileArtifact({ sessionId: sessionId!, path: toSessionArtifactPath(filePath) });

      if (sessionId && isSessionFilePath(filePath)) {
        const sessionArtifact = await loadFromSessionArtifact().catch(() => undefined);
        if (sessionArtifact) return sessionArtifact;
      }

      try {
        return await downloadFileBrowserFile(resourceId!, filePath);
      } catch (error) {
        if (!sessionId || !isSessionFilePath(filePath)) throw error;
        try {
          return await loadFromSessionArtifact();
        } catch (artifactError) {
          // 部分文件浏览接口返回的路径不带 /by 前缀，兼容同一会话下的相对资源文件。
          if (filePath.startsWith('/by/')) {
            return downloadFileBrowserFile(resourceId!, filePath.slice(3));
          }
          throw artifactError;
        }
      }
    },
    [resourceId, sessionId]
  );

  const resolveRelativeResource = useCallback<MarkdownImageResolver>(
    async (imagePath) => {
      if (isExternalImagePath(imagePath)) {
        return imagePath;
      }

      const resolvedPath = sourcePath
        ? source === 'fileBrowser' && isSessionFilePath(sourcePath)
          ? resolveSessionResourcePath(sourcePath, imagePath)
          : resolveMarkdownImagePath(sourcePath, imagePath)
        : imagePath;
      const cacheKey = `${resourceId || previewFileUrl || ''}:${resolvedPath}`;
      const cached = markdownImageCacheRef.current.get(cacheKey);
      if (cached) return cached;

      if (!previewFileUrl && (!resourceId || !sourcePath)) return imagePath;

      const loadFromFileUrl = async () => {
        const response = await fetch(getFilePreviewUrl(previewFileUrl!, imagePath, sourcePath));
        if (!response.ok) throw new Error(response.statusText);
        const file = await response.blob();
        if (!file.size) throw new Error('Empty relative resource');
        return { file };
      };
      const loadFromSourcePath = () =>
        source === 'fileBrowser'
          ? loadFileBrowserFile(resolvedPath)
          : downloadResourceFile({
            resourceId: resourceId!,
            directoryPath: resolvedPath,
          });
      const request = (
        previewFileUrl
          ? loadFromFileUrl().catch(() =>
            resourceId && sourcePath ? loadFromSourcePath() : Promise.reject(new Error('File not found'))
          )
          : loadFromSourcePath()
      )
        .then((response: any) => {
          const rawBlob = response?.file instanceof Blob ? response.file : new Blob([response?.file || response]);
          if (!rawBlob.size) throw new Error('Empty relative resource');
          const mimeType = getMimeType(resolvedPath);
          return mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob;
        })
        .catch((error) => {
          markdownImageCacheRef.current.delete(cacheKey);
          throw error;
        });

      markdownImageCacheRef.current.set(cacheKey, request);
      return request;
    },
    [loadFileBrowserFile, previewFileUrl, resourceId, source, sourcePath]
  );

  useEffect(() => {
    let active = true;
    setBlob(null);
    setLoading(true);

    const loadFile = async () => {
      if (content) {
        if (content.data === null) {
          // 调用方先开抽屉占位，content.data 后续异步填入，useEffect 会重新触发。
          return new Promise<Blob>(() => {});
        }
        return contentToBlob(content.data, content.binary, fileName);
      }
      if (fileUrl) {
        const response = await fetch(getFileUrl(fileUrl));
        if (!response.ok) throw new Error(response.statusText);
        return response.blob();
      }
      if (resourceId && sourcePath) {
        // 会话、项目文件来自文件空间；本体关联文件仍按知识库文件来源下载。
        let response: any;
        try {
          response =
            source === 'fileBrowser'
              ? await loadFileBrowserFile(sourcePath)
              : await downloadResourceFile({
                resourceId,
                directoryPath: sourcePath,
              });
        } catch (error) {
          if (!previewFileUrl) throw error;
          const previewResponse = await fetch(previewFileUrl);
          if (!previewResponse.ok) throw error;
          return previewResponse.blob();
        }
        const rawBlob = response?.file instanceof Blob ? response.file : new Blob([response?.file || response]);
        const mimeType = getMimeType(fileName);
        return mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob;
      }
      if (previewFileUrl) {
        const response = await fetch(previewFileUrl);
        if (!response.ok) throw new Error(response.statusText);
        return response.blob();
      }
      throw new Error('Missing file source');
    };

    void loadFile()
      .then((result) => {
        if (isTextPreviewFile(fileName) && result.size > MAX_TEXT_PREVIEW_SIZE) {
          throw new Error('文件过大，无法在线预览，请下载查看');
        }
        if (active) setBlob(result);
      })
      .catch((error: any) => {
        if (active) message.error(error?.message || '文件预览失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // content 按字段取依赖：调用方常内联该对象，用对象引用会每次渲染都重新构建 Blob。
  }, [
    content?.data,
    content?.binary,
    fileName,
    fileUrl,
    loadFileBrowserFile,
    previewFileUrl,
    resourceId,
    source,
    sourcePath,
  ]);

  return (
    <Spin spinning={loading} wrapperClassName={styles.detailSpin}>
      {blob ? (
        <React.Suspense fallback={null}>
          <PreViewFile
            data={blob}
            type={previewType}
            title={fileName}
            resolveMarkdownImage={previewFileUrl || (resourceId && sourcePath) ? resolveRelativeResource : undefined}
            resolveHtmlResource={previewFileUrl || (resourceId && sourcePath) ? resolveRelativeResource : undefined}
            onHtmlLinkClick={onOpenRelativeFile}
            className={fileSiderStyles.previewContent}
          />
        </React.Suspense>
      ) : (
        !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Spin>
  );
};

export default FilePreviewPanel;
