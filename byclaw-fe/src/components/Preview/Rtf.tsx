import { useEffect, useState } from 'react';
import { Alert, Spin } from 'antd';
import { useIntl } from '@umijs/max';
import { BinaryPreviewError } from './binaryPreview';
import { MAX_RTF_BYTES, renderRtf } from './rtfDecoder';
import styles from './Rtf.module.less';

export default function Rtf({ data, title }: { data?: string | Blob; title?: string }) {
  const intl = useIntl();
  const pictureLabel = intl.formatMessage({ id: 'fileRender.rtfPictureOmitted' });
  const [html, setHtml] = useState<string>();
  const [errorId, setErrorId] = useState<string>();
  useEffect(() => {
    let active = true;
    setHtml(undefined);
    setErrorId(undefined);
    void (async () => {
      if (!(data instanceof Blob) || !data.size) throw new BinaryPreviewError('invalid');
      if (data.size > MAX_RTF_BYTES) throw new BinaryPreviewError('limit');
      const buffer = await data.arrayBuffer();
      if (!active) return;
      const result = await renderRtf(buffer, pictureLabel, () => active);
      if (active) setHtml(result);
    })().catch((error) => {
      if (active)
        setErrorId(
          error instanceof BinaryPreviewError && error.code === 'limit' ? 'fileRender.rtfLimit' : 'fileRender.rtfFailed'
        );
    });
    return () => {
      active = false;
    };
  }, [data, pictureLabel]);
  return (
    <div className={styles.preview}>
      <Alert type="info" showIcon message={intl.formatMessage({ id: 'fileRender.rtfNotice' })} />
      {errorId ? (
        <Alert type="warning" showIcon message={intl.formatMessage({ id: errorId })} />
      ) : html === undefined ? (
        <Spin />
      ) : (
        <iframe
          className={styles.document}
          title={title || intl.formatMessage({ id: 'fileRender.rtfDocument' })}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={html}
        />
      )}
    </div>
  );
}
