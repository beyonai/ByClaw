import { useCallback } from 'react';

import MessageFilePreviewPanel from '@/components/MessageList/components/FileRender/components/Previewer/MessageFilePreviewPanel';
import {
  createRelativePathResourceResolver,
  getCommonFilePreviewUrl,
  resolveRelativeFilePath,
  resolveSessionResourcePath,
} from '@/components/MessageList/components/FileRender/components/Previewer/relativeResource';
import { resolvePreviewType } from '@/components/Preview/formats';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import { getRawBlob } from '@/layout/sider/components/FileSiderPanel/utils';
import { downloadResourceFile } from '@/service/file';
import { downloadFile, type FileBrowserItem } from '@/service/fileBrowser';
import type { IFile } from '@/typescript/file';

/** 资源入口保留各自的下载来源，统一在附件面板展示。 */
export default function useResourceAttachmentPreview(
  scope: 'shared' | 'project',
  resourceId: string | undefined,
  onOpenDetail: (panel: React.ReactNode, options: DetailPanelOptions) => void
) {
  const openFile = useCallback(
    function openResourceFile({ name, path, size }: FileBrowserItem) {
      if (!resourceId) return;
      const sourceResourceId = resourceId;
      const fileType = resolvePreviewType(undefined, name);
      const tabKey = `${scope}-file:${resourceId}:${path}`;
      const resolveResourcePath = scope === 'shared' ? resolveSessionResourcePath : resolveRelativeFilePath;

      async function load(directoryPath: string) {
        if (scope === 'project') {
          return getRawBlob(await downloadResourceFile({ resourceId: sourceResourceId, directoryPath }));
        }
        try {
          return getRawBlob(await downloadFile(sourceResourceId, directoryPath));
        } catch (error) {
          // 本地共享保留公共预览地址作为文件空间下载失败时的备用来源。
          const response = await fetch(getCommonFilePreviewUrl(directoryPath), { cache: 'no-store' });
          if (!response.ok) throw error;
          return response.blob();
        }
      }

      const attachment: IFile = {
        uid: tabKey,
        status: 'done',
        fileType: 'file',
        queryFile: { fileType, fileName: name, filePath: path, length: size },
        downloadRequest: async () => ({ file: await load(path), fileName: name }),
        resolvePreviewResource: createRelativePathResourceResolver(path, load, {
          useSessionResourceUrl: false,
          resolveResourcePath,
        }),
      };

      onOpenDetail(
        <MessageFilePreviewPanel
          fileItem={attachment}
          fileType={fileType}
          fileName={name}
          onOpenRelativeFile={(relativePath) => {
            const filePath = resolveResourcePath(path, relativePath);
            openResourceFile({ name: filePath.split('/').pop() || relativePath, path: filePath, isDir: false });
          }}
        />,
        { tabKey, title: name }
      );
    },
    [onOpenDetail, resourceId, scope]
  );

  return resourceId ? openFile : undefined;
}
