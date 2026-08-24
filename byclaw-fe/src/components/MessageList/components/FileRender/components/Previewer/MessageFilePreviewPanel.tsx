import React, { useEffect, useMemo } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { Spin } from 'antd';

import type { IFile } from '@/typescript/file';
import fileSiderStyles from '@/layout/sider/components/FileSiderPanel/index.module.less';
import { createRelativeResourceResolver } from './relativeResource';
import usePreview from './usePreview';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

interface MessageFilePreviewPanelProps {
  fileItem: IFile;
  fileType: string;
  fileName: string;
  onClose: () => void;
}

const MessageFilePreviewPanel: React.FC<MessageFilePreviewPanelProps> = ({ fileItem, fileType, fileName, onClose }) => {
  const { onPreview, previewInfo, previewing } = usePreview();
  const resolveRelativeResource = useMemo(
    () => previewInfo.resolvePreviewResource || createRelativeResourceResolver(previewInfo.resourceUrl),
    [previewInfo.resolvePreviewResource, previewInfo.resourceUrl]
  );

  useEffect(() => {
    void onPreview(fileItem);
  }, [fileItem, onPreview]);

  return (
    <div className={fileSiderStyles.previewPanel}>
      <div className={fileSiderStyles.previewHeader}>
        <span className={fileSiderStyles.previewTitle} title={fileName}>
          {fileName}
        </span>
        <button type="button" className={fileSiderStyles.previewClose} onClick={onClose} aria-label="关闭文件预览">
          <CloseOutlined />
        </button>
      </div>
      <div className={fileSiderStyles.previewBody}>
        <Spin spinning={previewing || previewInfo.loading} wrapperClassName="full-height-spin">
          {previewInfo.blob && (
            <React.Suspense fallback={null}>
              <PreViewFile
                data={previewInfo.blob}
                type={fileType}
                title={fileName}
                resolveMarkdownImage={resolveRelativeResource}
                resolveHtmlResource={resolveRelativeResource}
                className={fileSiderStyles.previewContent}
              />
            </React.Suspense>
          )}
        </Spin>
      </div>
    </div>
  );
};

export default MessageFilePreviewPanel;
