/* eslint-disable lines-around-comment */
import React, { useEffect, useMemo } from 'react';
import { Spin } from 'antd';
import Empty from '@/components/Empty';
import PanelWrapper from './PanelWrapper';
import usePreview from '@/components/MessageList/components/FileRender/components/Previewer/usePreview';
import type { IFile } from '@/typescript/file';

import styles from './index.less';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

export interface PreviewFileInfo {
  fileId: number;
  /** 文件名称，用于展示和预览标题 */
  fileName?: string;
  /** 文件直链地址 */
  fileUrl: string;
}

interface PreviewFilePanelProps {
  /** 是否打开面板 */
  isOpen: boolean;
  /** 需要预览的文件信息（至少包含 fileUrl） */
  file?: PreviewFileInfo | null;
  /** 关闭面板 */
  onClose: () => void;
  /** 关闭动画结束回调，与 PanelWrapper 一致 */
  afterClose?: () => void;
}

const PreviewFilePanel: React.FC<PreviewFilePanelProps> = (props) => {
  const { isOpen, file, onClose, afterClose } = props;

  const { onPreview, previewInfo, onClosePreviewModal, previewing } = usePreview();

  const { fileName, fileUrl, fileId } = file || {};

  const title = useMemo(() => {
    if (fileName && fileName.trim()) {
      return fileName;
    }
    if (fileUrl) {
      try {
        const urlObj = new URL(fileUrl, window.location.origin);
        const pathname = urlObj.pathname || '';
        const segments = pathname.split('/').filter(Boolean);
        const lastSegment = segments[segments.length - 1];
        if (lastSegment) return decodeURIComponent(lastSegment);
      } catch (e) {
        // ignore parse error, fallback below
      }
      return '文件预览';
    }
    return '文件预览';
  }, [fileName, fileUrl]);

  const fileType = useMemo(() => {
    const nameForExt = fileName || fileUrl || '';
    const parts = nameForExt.split('.');
    if (parts.length > 1) {
      return parts[parts.length - 1];
    }
    return '';
  }, [fileName, fileUrl]);

  // 面板打开时触发预览
  useEffect(() => {
    if (isOpen && (fileId || fileUrl)) {
      const previewFile: IFile = {
        uid: `${fileUrl}-${Date.now()}`,
        status: 'done',
        fileType: 'file',
        downloadUrl: fileUrl,
        queryFile: {
          fileId,
        } as IFile['queryFile'],
      };

      onPreview(previewFile);
    }

    // 面板关闭时，顺便重置预览状态
    if (!isOpen) {
      onClosePreviewModal();
    }
  }, [isOpen, fileUrl]);

  const renderContent = () => {
    if (!fileUrl) {
      return (
        <div className={styles.searchResultsContent}>
          <div className={styles.previewEmpty}>
            <Empty />
          </div>
        </div>
      );
    }

    return (
      <div className={styles.searchResultsContent}>
        <Spin spinning={previewing || previewInfo.loading} className={styles.previewSpin}>
          {previewInfo.blob ? (
            <div className={styles.previewContainer}>
              <React.Suspense fallback={null}>
                <PreViewFile data={previewInfo.blob} type={fileType} title={title} className={styles.preview} />
              </React.Suspense>
            </div>
          ) : (
            <div className={styles.previewLoading}>
              <Empty />
            </div>
          )}
        </Spin>
      </div>
    );
  };

  return (
    <PanelWrapper isOpen={isOpen} onClose={onClose} title={title} afterClose={afterClose}>
      {renderContent()}
    </PanelWrapper>
  );
};

export default PreviewFilePanel;
