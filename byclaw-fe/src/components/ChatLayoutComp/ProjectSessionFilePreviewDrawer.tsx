import React, { useEffect, useMemo, useState } from 'react';
import { Drawer, Spin, message } from 'antd';
import { createRelativePathResourceResolver } from '@/components/MessageList/components/FileRender/components/Previewer/relativeResource';
import { getMimeType } from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import fileSiderStyles from '@/layout/sider/components/FileSiderPanel/index.module.less';
import { downloadFile, type FileBrowserItem } from '@/service/fileBrowser';
import { getFileType } from '@/layout/sider/components/FileSiderPanel/utils';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

type ProjectSessionFilePreviewDrawerProps = {
  open: boolean;
  resourceId: string;
  file?: FileBrowserItem;
  onClose: () => void;
};

const ProjectSessionFilePreviewDrawer: React.FC<ProjectSessionFilePreviewDrawerProps> = ({
  open,
  resourceId,
  file,
  onClose,
}) => {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const fileType = file ? getFileType(file.name) : 'txt';
  const resolveRelativeResource = useMemo(
    () =>
      file
        ? createRelativePathResourceResolver(file.path, async (path) => {
          const response = await downloadFile(resourceId, path);
          return response.file;
        })
        : undefined,
    [file?.path, resourceId]
  );

  useEffect(() => {
    if (!open || !file || !resourceId) {
      setBlob(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setBlob(null);
    setLoading(true);

    // 文件切换或抽屉关闭时丢弃旧请求结果，避免预览内容回写到新文件上。
    void downloadFile(resourceId, file.path)
      .then((response: any) => {
        if (cancelled) return;
        const rawBlob = response?.file instanceof Blob ? response.file : new Blob([response?.file || response]);
        const mimeType = getMimeType(file.name);
        setBlob(mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob);
      })
      .catch((error: any) => {
        if (!cancelled) {
          message.error(error?.message || '文件预览失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [file, open, resourceId]);

  return (
    <Drawer
      title={file?.name || '文件预览'}
      open={open && !!file}
      onClose={onClose}
      placement="right"
      width="50vw"
      push={{ distance: 180 }}
      mask={false}
      zIndex={1101}
      destroyOnClose
      styles={{
        body: {
          padding: 0,
          overflow: 'hidden',
        },
      }}
    >
      <Spin spinning={loading} wrapperClassName="full-height-spin">
        {blob && (
          <React.Suspense fallback={null}>
            <PreViewFile
              data={blob}
              type={fileType}
              title={file?.name}
              resolveMarkdownImage={resolveRelativeResource}
              resolveHtmlResource={resolveRelativeResource}
              className={fileSiderStyles.previewContent}
            />
          </React.Suspense>
        )}
      </Spin>
    </Drawer>
  );
};

export default ProjectSessionFilePreviewDrawer;
