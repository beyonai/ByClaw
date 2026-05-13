import { useState, useCallback } from 'react';
import { message as AntdMessage } from 'antd';
import { useIntl } from '@umijs/max';

import { IFile } from '@/typescript/file';
import { downloadResourceFile, getDatasetDownloadParamsFromQueryFile, downloadMinIOFileURL } from '@/service/file';
import { getFileUrl } from '@/utils/file';

const caches: Record<string, Blob> = {};

const usePreview = () => {
  const intl = useIntl();

  const [previewing, setPreviewing] = useState(false);
  const [previewInfo, setPreviewInfo] = useState<{
    open: boolean;
    blob: Blob | null;
    loading: boolean;
  }>({
    open: false,
    blob: null,
    loading: false,
  });

  const onPreview = async (fileItem: IFile) => {
    const { queryFile, downloadUrl } = fileItem;

    if (queryFile?.fileUrl || downloadUrl || queryFile?.fileId) {
      let url = getFileUrl(downloadUrl || queryFile?.fileUrl || '');

      if (!url && queryFile?.fileId) {
        const q = new URLSearchParams();
        q.set('fileId', String(queryFile?.fileId));
        url = `${downloadMinIOFileURL}?${q.toString()}`;
      }

      if (!caches[url]) {
        setPreviewing(true);
        setPreviewInfo({
          open: true,
          blob: null,
          loading: true,
        });
        fetch(url)
          .then((res) => {
            res
              .clone()
              .blob()
              .then((blob) => {
                caches[url] = blob;
                setPreviewInfo((prev) => ({
                  ...prev,
                  blob,
                  loading: false,
                }));
              });
          })
          .finally(() => {
            setPreviewing(false);
          });
      } else {
        setPreviewInfo({
          open: true,
          blob: caches[url],
          loading: false,
        });
      }
    } else {
      const dp = getDatasetDownloadParamsFromQueryFile(queryFile);
      if (dp) {
        setPreviewInfo({
          open: true,
          blob: null,
          loading: true,
        });
        setPreviewing(true);
        const res = await downloadResourceFile(dp);
        if (res.file) {
          setPreviewInfo((prev) => ({
            ...prev,
            blob: res.file,
            loading: false,
          }));
        }
        setPreviewing(false);
      } else {
        AntdMessage.warning(intl.formatMessage({ id: 'fileRender.previewUnavailable' }));
      }
    }
  };

  const onClosePreviewModal = useCallback(() => {
    setPreviewInfo((prev) => ({ ...prev, open: false, blob: null }));
  }, []);

  return {
    onPreview,
    previewInfo,
    setPreviewInfo,
    onClosePreviewModal,
    previewing,
  };
};

export default usePreview;
