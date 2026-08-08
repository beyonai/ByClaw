import React, { useEffect, useState } from 'react';
import { Empty, Spin, message } from 'antd';
import { getMimeType } from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import fileSiderStyles from '@/layout/sider/components/FileSiderPanel/index.module.less';
import { getFileType } from '@/layout/sider/components/FileSiderPanel/utils';
import { downloadResourceFileForPreview } from '@/service/file';
import { downloadFile as downloadFileBrowserFile } from '@/service/fileBrowser';
import { getFileUrl } from '@/utils/file';
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

const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  fileName,
  resourceId,
  path,
  fileUrl,
  source = 'dataset',
}) => {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);

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
