import { useCallback } from 'react';
import { message } from 'antd';
import { useIntl } from '@umijs/max';
import { getMimeType } from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import { downloadFile, downloadFolder, type FileBrowserItem } from '@/service/fileBrowser';
import { canPreviewFile, ensureDirectoryPath, getFileType, isDirectory } from '../utils';

interface UseFilePreviewActionsOptions {
  resourceId: string;
  EventEmitter: any;
  previewClassName: string;
}

export default function useFilePreviewActions({
  resourceId,
  EventEmitter,
  previewClassName,
}: UseFilePreviewActionsOptions) {
  const intl = useIntl();

  const renderPreviewPanel = useCallback(
    (item: FileBrowserItem, options: { blob?: Blob | null; loading: boolean }) => {
      if (options.loading) {
        EventEmitter.emit('beyond-main-driver-open-type', {
          title: item.name,
          width: '50vw',
          minWidth: '360px',
          maxWidth: '70vw',
          drawerType: 'preview',
          canClose: true,
          canFullScreen: false,
        });
      }
      EventEmitter.emit('beyond-main-driver-message', {
        data: options.blob ?? undefined,
        type: getFileType(item.name),
        title: item.name,
        className: previewClassName,
      });
    },
    [EventEmitter, previewClassName]
  );

  const handlePreview = useCallback(
    async (item: FileBrowserItem) => {
      if (!canPreviewFile(item)) {
        message.warning(intl.formatMessage({ id: 'fileBrowser.preview.unavailable' }));
        return;
      }

      renderPreviewPanel(item, { loading: true });
      try {
        const res: any = await downloadFile(resourceId, item.path);
        const rawBlob = res?.file instanceof Blob ? res.file : new Blob([res?.file || res]);
        const mimeType = getMimeType(item.name);
        const blob = mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob;
        renderPreviewPanel(item, { blob, loading: false });
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.preview.failed' }));
      }
    },
    [intl, renderPreviewPanel, resourceId]
  );

  const handleDownload = useCallback(
    async (item: FileBrowserItem) => {
      const messageKey = isDirectory(item) ? 'folderDownload' : 'fileDownload';
      message.loading({
        content: intl.formatMessage({
          id: isDirectory(item) ? 'fileBrowser.download.folderDownloading' : 'fileBrowser.download.downloading',
        }),
        key: messageKey,
        duration: 0,
      });
      try {
        const res: any = isDirectory(item)
          ? await downloadFolder(resourceId, ensureDirectoryPath(item.path))
          : await downloadFile(resourceId, item.path);
        const blob = res?.file instanceof Blob ? res.file : new Blob([res?.file || res]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res?.fileName || (isDirectory(item) ? `${item.name}.zip` : item.name);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        message.destroy(messageKey);
      } catch (error: any) {
        message.destroy(messageKey);
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.download.failed' }));
      }
    },
    [intl, resourceId]
  );

  return {
    handlePreview,
    handleDownload,
  };
}
