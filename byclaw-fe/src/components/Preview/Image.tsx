import React, { useEffect, useState } from 'react';
import { Alert } from 'antd';
import { useIntl } from '@umijs/max';
import { PREVIEW_MIME_TYPES, resolvePreviewType } from './formats';

export interface ImagePreviewProps {
  url?: string;
  data?: string | Blob;
  title?: string;
}

export default React.memo(function ImagePreview(props: ImagePreviewProps) {
  const { url, data, title } = props;
  const intl = useIntl();
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  useEffect(() => {
    if (!data && url) {
      setSrc(url);
    }
  }, [data, url]);

  useEffect(() => {
    let uri: string | undefined;
    if (data instanceof Blob) {
      let blob: Blob = data;

      if (title) {
        const type = resolvePreviewType('image', title, data.type);
        blob = new File([data], title, { type: PREVIEW_MIME_TYPES[type] || data.type });
      }
      uri = URL.createObjectURL(blob);
      setSrc(uri);
    }
    return () => {
      if (uri) URL.revokeObjectURL(uri);
    };
  }, [data, title]);

  // SVG 使用 img 解码，不把文件中的脚本作为 HTML 插入页面。
  return (
    <figure style={{ width: '100%' }}>
      {failed ? (
        <Alert type="warning" showIcon message={intl.formatMessage({ id: 'fileRender.previewUnavailable' })} />
      ) : (
        src && <img style={{ width: '100%' }} src={src} alt={title} onError={() => setFailed(true)} />
      )}
    </figure>
  );
});
