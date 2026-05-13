import React from 'react';
import { Spin } from 'antd';
import { generateUniqueId } from '@/utils/math';

import useIframeAction from './useIframeAction';

import styles from './index.module.less';

type IProps = {
  url: string;
  onClose: () => void;
};

function WriterIframe(props: IProps) {
  const { url, onClose } = props;

  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const uuidRef = React.useRef<string>(generateUniqueId());

  const [isLoading, setIsLoading] = React.useState(true);

  useIframeAction({
    uuid: uuidRef.current,
    onClose,
  });

  const iframeSrc = React.useMemo(() => {
    if (!url) return '';

    const srcObj = new URL(url);

    srcObj.searchParams.append('uuid', uuidRef.current);

    return srcObj.toString();
  }, [url]);

  React.useEffect(() => {
    setIsLoading(true);
    const onLoad = () => {
      setIsLoading(false);
    };

    iframeRef.current?.addEventListener('load', onLoad);

    return () => {
      iframeRef.current?.removeEventListener('load', onLoad);
    };
  }, [iframeSrc]);

  if (!iframeSrc) return null;

  return (
    <Spin spinning={isLoading} wrapperClassName={styles.writer}>
      <iframe
        ref={iframeRef}
        width="100%"
        height="100%"
        frameBorder="0"
        src={iframeSrc}
        style={{
          border: 'none',
          overflow: 'hidden',
        }}
        title="WriterIframe"
      />
    </Spin>
  );
}
export default WriterIframe;
