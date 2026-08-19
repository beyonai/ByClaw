import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, Spin, message } from 'antd';
import { getMimeType } from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import fileSiderStyles from '@/layout/sider/components/FileSiderPanel/index.module.less';
import { getFileType } from '@/layout/sider/components/FileSiderPanel/utils';
import { downloadResourceFileForPreview } from '@/service/file';
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
  source?: 'dataset' | 'fileBrowser';
}

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

const resolveMarkdownImagePath = (markdownPath: string, imagePath: string) => {
  const normalizedMarkdownPath = normalizeFilePath(markdownPath);
  const directoryPath = normalizedMarkdownPath.slice(0, normalizedMarkdownPath.lastIndexOf('/') + 1);
  const resourcePath = imagePath.split(/[?#]/, 1)[0];
  return normalizeFilePath(`${directoryPath}${resourcePath}`);
};

const getFilePreviewUrl = (fileUrl: string, resourcePath: string) => {
  const previewUrl = new URL(getFileUrl(fileUrl), window.location.origin);
  const filePath = previewUrl.searchParams.get('filePath');
  if (filePath) {
    previewUrl.searchParams.set('filePath', resolveMarkdownImagePath(filePath, resourcePath));
    return previewUrl.toString();
  }
  return new URL(resourcePath, previewUrl).toString();
};

const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  fileName,
  resourceId,
  path,
  fileUrl,
  source = 'dataset',
}) => {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const markdownImageCacheRef = useRef<Map<string, Promise<Blob>>>(new Map());

  const resolveRelativeResource = useCallback<MarkdownImageResolver>(
    async (imagePath) => {
      if (isExternalImagePath(imagePath)) {
        return imagePath;
      }

      const resolvedPath = path ? resolveMarkdownImagePath(path, imagePath) : imagePath;
      const cacheKey = `${resourceId || fileUrl || ''}:${resolvedPath}`;
      const cached = markdownImageCacheRef.current.get(cacheKey);
      if (cached) return cached;

      if (!fileUrl && (!resourceId || !path)) return imagePath;

      const loadFromFileUrl = async () => {
        const response = await fetch(getFilePreviewUrl(fileUrl!, resolvedPath));
        if (!response.ok) throw new Error(response.statusText);
        const file = await response.blob();
        // commonFile 预览接口历史上可能在文件不存在时仍返回 200 空响应，需要继续尝试源目录。
        if (!file.size) throw new Error('Empty relative resource');
        return { file };
      };
      const loadFromSourcePath = () =>
        source === 'fileBrowser'
          ? downloadFileBrowserFile(resourceId!, resolvedPath)
          : downloadResourceFileForPreview({
              resourceId: resourceId!,
              directoryPath: resolvedPath,
              language: 'zh-CN',
            });
      const request = (resourceId && path
        ? loadFromSourcePath().catch(() => (fileUrl ? loadFromFileUrl() : Promise.reject(new Error('File not found'))))
        : loadFromFileUrl())
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
    [fileUrl, path, resourceId, source]
  );

  useEffect(() => {
    let active = true;
    setBlob(null);
    setLoading(true);

    const loadFile = async () => {
      if (fileUrl) {
        const response = await fetch(getFileUrl(fileUrl));
        if (!response.ok) throw new Error(response.statusText);
        return response.blob();
      }
      if (resourceId && path) {
        // 会话、项目文件来自文件空间；本体关联文件仍按知识库文件来源下载。
        const response: any =
          source === 'fileBrowser'
            ? await downloadFileBrowserFile(resourceId, path)
            : await downloadResourceFileForPreview({
              resourceId,
              directoryPath: path,
              language: 'zh-CN',
            });
        const rawBlob = response?.file instanceof Blob ? response.file : new Blob([response?.file || response]);
        const mimeType = getMimeType(fileName);
        return mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob;
      }
      throw new Error('Missing file source');
    };

    void loadFile()
      .then((result) => {
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
  }, [fileName, fileUrl, path, resourceId, source]);

  return (
    <Spin spinning={loading} wrapperClassName={styles.detailSpin}>
      {blob ? (
        <React.Suspense fallback={null}>
          <PreViewFile
            data={blob}
            type={getFileType(fileName)}
            title={fileName}
            resolveMarkdownImage={fileUrl || (resourceId && path) ? resolveRelativeResource : undefined}
            resolveHtmlResource={fileUrl || (resourceId && path) ? resolveRelativeResource : undefined}
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
