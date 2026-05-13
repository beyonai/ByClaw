import React, { useState, useRef, useContext } from 'react';
import { AppBridgeContext } from '@/layout/mobileLayout/AppBridge';
import { isString } from 'lodash';

export default function Iframe() {
  const { myPostmessage, onMessageListener } = useContext(AppBridgeContext);

  const [iframeSrc, setIframeSrc] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    myPostmessage(JSON.stringify({ type: 'beyond-get-iframe-src' }));

    const onMessage = (event: MessageEvent) => {
      let payload = event.data;

      try {
        if (isString(payload)) {
          payload = JSON.parse(payload);
        }
      } catch (error) {
        console.error(error);
      }

      const { type, data } = payload;
      if (type === 'app-set-iframe-src') {
        setIframeSrc(data);
      }
    };

    const cancelFn = onMessageListener(onMessage);
    return cancelFn;
  }, []);

  if (!iframeSrc) return null;

  return (
    <iframe
      ref={iframeRef}
      width="100%"
      height="100%"
      frameBorder="0"
      src={iframeSrc}
      style={{
        border: 'none',
        overflow: 'hidden',
        backgroundColor: '#fff',
      }}
      title="beyond"
      allow="camera;microphone;clipboard-read;clipboard-write;self"
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads allow-popups-to-escape-sandbox"
    />
  );
}
