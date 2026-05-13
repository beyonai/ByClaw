import { useEffect, useState } from 'react';

export interface ImagePreviewProps {
  url?: string;
  data?: string | Blob;
  title?: string;
}

export default function ImagePreview(props: ImagePreviewProps) {
  const { url, data, title } = props;
  const [src, setSrc] = useState<string>();

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
        blob = new File([data], title, { type: 'image/*' });
      }
      uri = URL.createObjectURL(blob);
      setSrc(uri);
    }
    return () => {
      if (uri) URL.revokeObjectURL(uri);
    };
  }, [data, title]);

  return <figure style={{ width: '100%' }}>{src && <img style={{ width: '100%' }} src={src} alt={title} />}</figure>;
}
