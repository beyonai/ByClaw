import React, { useState, useEffect, useMemo } from 'react';
import { Spin } from 'antd';
import AntdIcon from '@/components/AntdIcon';
import styles from './FilePreview.module.less';
import { downloadFile } from '@/service/workSpace';

const Twins = React.lazy(() => import('@/components/Preview/Twins'));

type FileInfo = {
  type?: string;
  name?: string;
  path?: string;
  fileId?: string;
  content?: string;
};

interface FilePreviewProps {
  onBack?: () => void;
  fileInfo: FileInfo;
}

export function FilePreview({ onBack, fileInfo }: FilePreviewProps) {
  const [content, setContent] = useState<string | Blob>();
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (fileInfo.path) {
      setLoading(true);
      let url = fileInfo.path;
      if (url.startsWith('/WaManagerService')) {
        url = `/byaiService${url}`;
      }
      fetch(url)
        .then((res) => {
          res.blob().then((blob) => {
            setContent(blob);
          });
        })
        .finally(() => {
          setLoading(false);
        });
      return;
    }
    if (fileInfo.fileId) {
      setLoading(true);
      downloadFile({ fileId: fileInfo.fileId })
        .then((res) => {
          if (res?.file instanceof Blob) {
            setContent(res.file);
          }
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [fileInfo]);

  const type = useMemo(() => {
    if (!fileInfo.type) return '';
    if (fileInfo.type.match(/^img|image|jpg|jpeg|png|gif|bmp|webp$/)) return 'image';
    if (fileInfo.type.match(/^pdf$/)) return 'pdf';
    if (fileInfo.type.match(/^h5|html$/)) return 'html';
    return fileInfo.type;
  }, [fileInfo]);

  console.log('contentdsaidjioasjdioas');

  return (
    <div className={styles.filePreview}>
      <div className={styles.head}>
        <AntdIcon className={styles.back} onClick={onBack} type="icon-a-Leftzuo" />
        <span className={styles.title}>{fileInfo.name}</span>
      </div>
      {loading && (
        <div className={styles.loading}>
          <Spin />
        </div>
      )}
      {!loading && ['json', 'md', 'txt', 'h5', 'html', 'pdf', 'image', 'pptx', 'xlsx', 'docx'].includes(type) && (
        <React.Suspense fallback={<Spin />}>
          <Twins data={content} type={fileInfo.type as 'json'} title={fileInfo.name} />
        </React.Suspense>
      )}
    </div>
  );
}
