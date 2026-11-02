import { useEffect, useState } from 'react';
import { Alert, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { Office } from './Office';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { createPreviewWorker } from './createPreviewWorker';
import type { PreviewWorkerClient } from './previewWorkerClient';
import { OFFICE_VARIANTS, type OfficeVariantType } from './officeVariantTypes';
import { PREVIEW_MIME_TYPES } from './formats';
import styles from './LegacyOffice.module.less';

export default function OfficeVariant({ data, type }: { data?: string | Blob; type: OfficeVariantType }) {
  const intl = useIntl();
  const [result, setResult] = useState<{
    source: typeof data;
    type: OfficeVariantType;
    blob?: Blob;
    errorId?: string;
  }>();
  // 文件切换的首帧也不能把旧副本交给新类型的渲染器。
  const preview = result?.source === data && result?.type === type ? result : undefined;
  useEffect(() => {
    let active = true;
    let client: PreviewWorkerClient | undefined;
    setResult(undefined);
    void (async () => {
      if (!(data instanceof Blob) || !data.size) throw new BinaryPreviewError('invalid');
      if (data.size > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
      const buffer = await data.arrayBuffer();
      if (!active) return;
      client = createPreviewWorker();
      const result = await client.request('prepareOfficeVariant', { buffer, type }, [buffer]);
      if (active)
        setResult({
          source: data,
          type,
          blob: new Blob([result], { type: PREVIEW_MIME_TYPES[OFFICE_VARIANTS[type]] }),
        });
    })()
      .catch((error) => {
        if (!active) return;
        let errorId = 'fileRender.officeVariantFailed';
        if (error instanceof BinaryPreviewError && error.code === 'timeout') errorId = 'fileRender.binaryTimeout';
        else if (error instanceof BinaryPreviewError && error.code === 'limit')
          errorId = 'fileRender.officeVariantLimit';
        setResult({ source: data, type, errorId });
      })
      .finally(() => client?.dispose());
    return () => {
      active = false;
      client?.dispose();
    };
  }, [data, type]);
  return (
    <div className={styles.preview}>
      <Alert showIcon type="info" message={intl.formatMessage({ id: 'fileRender.officeVariantNotice' })} />
      {preview?.errorId ? (
        <Alert showIcon type="warning" message={intl.formatMessage({ id: preview.errorId })} />
      ) : preview?.blob ? (
        <div className={styles.document}>
          <Office
            data={preview.blob}
            type={OFFICE_VARIANTS[type]}
            onPreviewError={() =>
              setResult((current) =>
                current && current === preview ? { ...current, errorId: 'fileRender.officeVariantFailed' } : current
              )
            }
          />
        </div>
      ) : (
        <Spin />
      )}
    </div>
  );
}
