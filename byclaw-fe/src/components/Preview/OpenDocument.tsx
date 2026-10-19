import { useEffect, useMemo, useState } from 'react';
import { Alert, Empty, Pagination, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { createPreviewWorker } from './createPreviewWorker';
import type { PreviewWorkerClient } from './previewWorkerClient';
import type { OpenDocumentContent, OpenDocumentType } from './openDocumentTypes';
import { staticPreviewHtml } from './staticPreviewHtml';
import styles from './StructuredPreview.module.less';

export default function OpenDocument({
  data,
  type,
  title,
}: {
  data?: string | Blob;
  type: OpenDocumentType;
  title?: string;
}) {
  const intl = useIntl();
  const [document, setDocument] = useState<OpenDocumentContent>();
  const [page, setPage] = useState(1);
  const [errorId, setErrorId] = useState<string>();
  useEffect(() => {
    let active = true;
    let client: PreviewWorkerClient | undefined;
    setDocument(undefined);
    setPage(1);
    setErrorId(undefined);
    void (async () => {
      if (!(data instanceof Blob) || !data.size) throw new BinaryPreviewError('invalid');
      if (data.size > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
      const buffer = await data.arrayBuffer();
      if (!active) return;
      client = createPreviewWorker();
      const result = await client.request('readOpenDocument', { buffer, type }, [buffer]);
      if (active) setDocument(result);
    })()
      .catch((error) => {
        if (!active) return;
        if (error instanceof BinaryPreviewError && error.code === 'timeout') {
          setErrorId('fileRender.binaryTimeout');
        } else if (error instanceof BinaryPreviewError && error.code === 'limit') {
          setErrorId('fileRender.openDocumentLimit');
        } else {
          setErrorId('fileRender.openDocumentFailed');
        }
      })
      .finally(() => client?.dispose());
    return () => {
      active = false;
      client?.dispose();
    };
  }, [data, type]);
  const current = document?.pages[page - 1];
  const html = useMemo(() => (current ? staticPreviewHtml(current.html) : ''), [current]);
  const label = (key: string) => intl.formatMessage({ id: `fileRender.${key}` });
  return (
    <div className={styles.preview}>
      <Alert showIcon type="info" message={label('openDocumentNotice')} />
      {document?.omitted && <Alert showIcon type="warning" message={label('openDocumentOmitted')} />}
      {errorId && <Alert showIcon type="warning" message={intl.formatMessage({ id: errorId })} />}
      {!document && !errorId && <Spin />}
      {document && !current && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      {current && (
        <>
          {type === 'odp' && (
            <span>
              {current.name || label('openDocumentPage')} · {page} / {document!.pages.length}
            </span>
          )}
          <iframe
            className={styles.document}
            title={title || label('openDocumentTitle')}
            srcDoc={html}
            sandbox=""
            referrerPolicy="no-referrer"
          />
          <Pagination
            current={page}
            pageSize={1}
            total={document!.pages.length}
            onChange={setPage}
            showSizeChanger={false}
            hideOnSinglePage
            size="small"
          />
        </>
      )}
    </div>
  );
}
