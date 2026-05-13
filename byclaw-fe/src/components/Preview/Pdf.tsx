import { useEffect, useState } from 'react';

export interface PdfPreviewProps {
  url?: string;
  data?: string | Blob;
  title?: string;
}

export default function PdfPreview(props: PdfPreviewProps) {
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
        blob = new File([data], title, { type: 'application/pdf' });
      }
      console.log('blob', blob);
      uri = URL.createObjectURL(blob);
      setSrc(uri);
    }
    return () => {
      if (uri) URL.revokeObjectURL(uri);
    };
  }, [data, title]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <iframe style={{ width: '100%', height: '100%', border: 'none' }} title={title} src={src} />
    </div>
  );
}
