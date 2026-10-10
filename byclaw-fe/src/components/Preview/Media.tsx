import { Alert } from 'antd';
import { useIntl } from '@umijs/max';
import { useEffect, useRef, useState } from 'react';

interface MediaPreviewProps {
  url?: string;
  type: 'audio' | 'video';
  title?: string;
  active: boolean;
}

export default function MediaPreview({ url, type, title, active }: MediaPreviewProps) {
  const intl = useIntl();
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const media = mediaRef.current;
    return () => {
      // 切换文件、关闭或隐藏预览时停止播放，避免后台音频继续占用旧 Blob。
      media?.pause();
    };
  }, [url]);

  useEffect(() => {
    if (!active) mediaRef.current?.pause();
  }, [active]);

  if (!url) return null;

  if (failed) {
    return <Alert type="warning" showIcon message={intl.formatMessage({ id: 'fileRender.mediaUnsupported' })} />;
  }

  const props = {
    src: url,
    controls: true,
    preload: 'metadata' as const,
    'aria-label': title,
    onError: () => setFailed(true),
    ref: (element: HTMLMediaElement | null) => {
      mediaRef.current = element;
    },
    style: { width: '100%', maxHeight: '100%' },
  };

  return type === 'video' ? <video {...props} /> : <audio {...props} />;
}
