import { useState, useCallback, useEffect, useRef } from 'react';
import { message as AntdMessage } from 'antd';
import { useIntl } from '@umijs/max';
import { IFile } from '@/typescript/file';
import { downloadResourceFile, getDatasetDownloadParamsFromQueryFile, downloadMinIOFileURL } from '@/service/file';
import { getFileUrl } from '@/utils/file';
import { getCommonFilePreviewUrl, isSessionFilePath } from './relativeResource';

type PreviewInfo = {
  open: boolean;
  blob: Blob | null;
  loading: boolean;
  error?: string;
  resourceUrl?: string;
  resolvePreviewResource?: IFile['resolvePreviewResource'];
};

const usePreview = () => {
  const intl = useIntl();
  const generation = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const [previewing, setPreviewing] = useState(false);
  const [previewInfo, setPreviewInfo] = useState<PreviewInfo>({ open: false, blob: null, loading: false });

  const cancel = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
  }, []);
  useEffect(() => cancel, [cancel]);

  const onPreview = useCallback(
    async (fileItem: IFile) => {
      cancel();
      const current = generation.current;
      const abort = new AbortController();
      controller.current = abort;
      const { queryFile, downloadUrl, downloadRequest, resolvePreviewResource } = fileItem;
      const filePath = queryFile?.filePath || queryFile?.fileUrl || downloadUrl;
      let url = filePath && isSessionFilePath(filePath) ? getCommonFilePreviewUrl(filePath) : undefined;
      if (!url && (downloadUrl || queryFile?.fileUrl)) url = getFileUrl(downloadUrl || queryFile?.fileUrl || '');
      if (!url && queryFile?.fileId) {
        url = `${downloadMinIOFileURL}?${new URLSearchParams({ fileId: String(queryFile.fileId) })}`;
      }
      const initial: PreviewInfo = { open: true, blob: null, loading: true, resourceUrl: url, resolvePreviewResource };
      setPreviewInfo(initial);
      setPreviewing(true);
      try {
        let blob: Blob;
        if (downloadRequest) {
          blob = (await downloadRequest()).file;
        } else if (url) {
          const requestUrl = new URL(url, window.location.origin);
          requestUrl.searchParams.set('_previewTime', String(Date.now()));
          const response = await fetch(requestUrl.toString(), { cache: 'no-store', signal: abort.signal });
          if (!response.ok) throw new Error(response.statusText);
          blob = await response.blob();
        } else if (fileItem.file instanceof Blob) {
          blob = fileItem.file;
        } else {
          const params = getDatasetDownloadParamsFromQueryFile(queryFile);
          if (!params) throw new Error('Missing file source');
          blob = (await downloadResourceFile(params)).file;
        }
        if (!(blob instanceof Blob) || !blob.size) throw new Error('Empty file');
        if (current === generation.current) setPreviewInfo({ ...initial, blob, loading: false });
      } catch (error) {
        if (current === generation.current) {
          const errorMessage = intl.formatMessage({
            id:
              error instanceof Error && error.message === 'Empty file'
                ? 'preview.empty'
                : 'fileRender.previewUnavailable',
          });
          setPreviewInfo({ ...initial, open: false, loading: false, error: errorMessage });
          AntdMessage.warning(errorMessage);
        }
      } finally {
        if (current === generation.current) setPreviewing(false);
      }
    },
    [cancel, intl]
  );

  const onClosePreviewModal = useCallback(() => {
    cancel();
    setPreviewing(false);
    setPreviewInfo({ open: false, blob: null, loading: false });
  }, [cancel]);

  return { onPreview, previewInfo, setPreviewInfo, onClosePreviewModal, previewing };
};

export default usePreview;
