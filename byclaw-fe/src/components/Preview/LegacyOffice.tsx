import { useEffect, useState } from 'react';
import { Alert, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { convertLegacyOfficePreview, MAX_LEGACY_PREVIEW_SIZE } from '@/service/filePreview';
import { HtmlRender } from './Html';
import styles from './LegacyOffice.module.less';

interface LegacyOfficeProps {
  data?: string | Blob | ArrayBuffer;
  type: 'doc' | 'ppt';
  fileName?: string;
}

export default function LegacyOffice({ data, type, fileName }: LegacyOfficeProps) {
  const intl = useIntl();
  const [url, setUrl] = useState<string>();
  const [errorId, setErrorId] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setErrorId(undefined);
    const source = data instanceof Blob ? data : data instanceof ArrayBuffer ? new Blob([data]) : undefined;
    if (!source?.size || source.size > MAX_LEGACY_PREVIEW_SIZE) {
      setErrorId(
        source && source.size > MAX_LEGACY_PREVIEW_SIZE ? 'fileRender.legacyTooLarge' : 'fileRender.legacyFailed'
      );
      return () => controller.abort();
    }

    void convertLegacyOfficePreview(source, fileName || `preview.${type}`, controller)
      .then(({ file }) => {
        if (disposed) return;
        // 鉴权失败或业务错误可能被网关包装成 JSON，不能交给 PDF 渲染器显示为空白。
        if (!(file instanceof Blob) || !file.size || file.type.split(';')[0] !== 'application/pdf') {
          throw new Error('Invalid PDF preview response');
        }
        objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setErrorId('fileRender.legacyFailed');
      });

    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data, type, fileName]);

  return (
    <div className={styles.preview}>
      <Alert type="info" showIcon message={intl.formatMessage({ id: 'fileRender.legacyNotice' })} />
      {errorId ? (
        <Alert type="warning" showIcon message={intl.formatMessage({ id: errorId })} />
      ) : url ? (
        <div className={styles.document}>
          <HtmlRender href={url} />
        </div>
      ) : (
        <Spin />
      )}
    </div>
  );
}
