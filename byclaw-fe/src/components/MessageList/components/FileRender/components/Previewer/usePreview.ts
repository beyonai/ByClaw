import { useState, useCallback } from 'react';
import { message as AntdMessage } from 'antd';
import { useIntl } from '@umijs/max';

import { IFile } from '@/typescript/file';
import { downloadResourceFile, getDatasetDownloadParamsFromQueryFile, downloadMinIOFileURL } from '@/service/file';
import { getFileUrl } from '@/utils/file';
import { getCommonFilePreviewUrl, isSessionFilePath } from './relativeResource';

const caches: Record<string, Blob> = {};

const usePreview = () => {
  const intl = useIntl();

  const [previewing, setPreviewing] = useState(false);
  const [previewInfo, setPreviewInfo] = useState<{
    open: boolean;
    blob: Blob | null;
    loading: boolean;
    resourceUrl?: string;
    resolvePreviewResource?: IFile['resolvePreviewResource'];
  }>({
    open: false,
    blob: null,
    loading: false,
  });

  const onPreview = useCallback(
    async (fileItem: IFile) => {
      const { queryFile, downloadUrl, downloadRequest, resolvePreviewResource } = fileItem;
      const filePath = queryFile?.filePath || queryFile?.fileUrl || downloadUrl;
      const sessionPreviewUrl = filePath && isSessionFilePath(filePath) ? getCommonFilePreviewUrl(filePath) : undefined;

      if (downloadRequest) {
        setPreviewing(true);
        setPreviewInfo({
          open: true,
          blob: null,
          loading: true,
          resourceUrl: sessionPreviewUrl,
          resolvePreviewResource,
        });
        try {
          const res = await downloadRequest();
          setPreviewInfo({
            open: true,
            blob: res.file,
            loading: false,
            resourceUrl: sessionPreviewUrl,
            resolvePreviewResource,
          });
        } catch (error) {
          console.error(error);
          setPreviewInfo({
            open: false,
            blob: null,
            loading: false,
            resourceUrl: undefined,
            resolvePreviewResource: undefined,
          });
          AntdMessage.warning(intl.formatMessage({ id: 'fileRender.previewUnavailable' }));
        } finally {
          setPreviewing(false);
        }
      } else if (queryFile?.fileUrl || downloadUrl || queryFile?.fileId) {
        let url = sessionPreviewUrl || getFileUrl(downloadUrl || queryFile?.fileUrl || '');

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
            resourceUrl: url,
            resolvePreviewResource: undefined,
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
                    resourceUrl: url,
                    resolvePreviewResource: undefined,
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
            resourceUrl: url,
            resolvePreviewResource: undefined,
          });
        }
      } else {
        const dp = getDatasetDownloadParamsFromQueryFile(queryFile);
        if (dp) {
          setPreviewInfo({
            open: true,
            blob: null,
            loading: true,
            resourceUrl: undefined,
            resolvePreviewResource: undefined,
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
    },
    [intl]
  );

  const onClosePreviewModal = useCallback(() => {
    setPreviewInfo((prev) => ({
      ...prev,
      open: false,
      blob: null,
      resourceUrl: undefined,
      resolvePreviewResource: undefined,
    }));
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
