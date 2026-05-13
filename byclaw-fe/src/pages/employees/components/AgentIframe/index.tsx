import React from 'react';

import { Spin } from 'antd';
import { useSelector, useDispatch } from '@umijs/max';

import useIframeAction from './useIframeAction';
import { agentHomeUrlHandler } from '@/utils/agent';

import { IAgentCache } from '@/typescript/agent';
import type { ISessionState } from '@/models/session';

import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';

type IProps = {
  agent: IAgentCache;
};

function AgentIframe(props: IProps) {
  const dispatch = useDispatch();

  const { agent } = props;

  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const uuidRef = React.useRef<string>('');

  const { nextSessionIFileCache } = useSelector(({ session }: { session: ISessionState }) => session);

  const { sessionId } = useGlobal();

  const [isLoading, setIsLoading] = React.useState(true);

  const onLoadedCb = React.useCallback(() => {}, []);
  const onClose = React.useCallback(() => {}, []);

  useIframeAction({
    uuidRef,
    onClose,
    onLoadedCb,
  });

  const iframeSrc = React.useMemo(() => {
    if (!agent.agentHomeUrl) return '';

    const myUrl = agentHomeUrlHandler(agent, sessionId, nextSessionIFileCache);
    if (!myUrl) return '';

    const u = new URL(myUrl);
    uuidRef.current = u.searchParams.get('uuid') || '';

    return myUrl;
  }, [agent, sessionId, nextSessionIFileCache]);

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

  React.useEffect(() => {
    return () => {
      dispatch({
        type: 'session/save',
        payload: {
          nextSessionIFileCache: [],
        },
      });
    };
  }, [sessionId]);

  if (!iframeSrc) return null;

  return (
    <Spin spinning={isLoading} wrapperClassName={styles.spin}>
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
        title="WriterEditorIframe"
        allow="camera;microphone;clipboard-read;clipboard-write;self"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads allow-popups-to-escape-sandbox"
      />
    </Spin>
  );
}
export default AgentIframe;
