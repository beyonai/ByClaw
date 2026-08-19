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

  /**
   * 调用方已持有文件内容时直接传入，跳过下载。
   * 远程仓库文件走接口拿到的是字符串/base64，没有可下载的 resourceId+path 或 fileUrl。
   */
  content?: { data: string; binary?: boolean };
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

const resolveMarkdownImagePath = (markdownPath: string, imagePath: string) => {
  const normalizedMarkdownPath = normalizeFilePath(markdownPath);
  const directoryPath = normalizedMarkdownPath.slice(0, normalizedMarkdownPath.lastIndexOf('/') + 1);
  const resourcePath = imagePath.split(/[?#]/, 1)[0];
  return normalizeFilePath(`${directoryPath}${resourcePath}`);
};

const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  fileName,
  resourceId,
  path,
  fileUrl,
  source = 'dataset',
  content,
}) => {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const markdownImageCacheRef = useRef<Map<string, Promise<Blob>>>(new Map());

  const resolveMarkdownImage = useCallback<MarkdownImageResolver>(
    async (imagePath) => {
      if (!resourceId || !path || source !== 'fileBrowser' || isExternalImagePath(imagePath)) {
        return imagePath;
      }

      const resolvedPath = resolveMarkdownImagePath(path, imagePath);
      const cacheKey = `${resourceId}:${resolvedPath}`;
      const cached = markdownImageCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const request = downloadFileBrowserFile(resourceId, resolvedPath)
        .then((response: any) => {
          const rawBlob = response?.file instanceof Blob ? response.file : new Blob([response?.file || response]);
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
    [path, resourceId, source]
  );

  useEffect(() => {
    let active = true;
    setBlob(null);
    setLoading(true);

    const loadFile = async () => {
      if (content) return contentToBlob(content.data, content.binary, fileName);
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
    // content 按字段取依赖：调用方常内联该对象，用对象引用会每次渲染都重新构建 Blob。
  }, [content?.data, content?.binary, fileName, fileUrl, path, resourceId, source]);

  return (
    <Spin spinning={loading} wrapperClassName={styles.detailSpin}>
      {blob ? (
        <React.Suspense fallback={null}>
          <PreViewFile
            data={blob}
            type={getFileType(fileName)}
            title={fileName}
            resolveMarkdownImage={source === 'fileBrowser' ? resolveMarkdownImage : undefined}
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
