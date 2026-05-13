import React from 'react';

import { generateUniqueId } from '@/utils/math';
import { chain, concat, pick } from 'lodash';
import { Spin } from 'antd';
import { getLocale, useSelector, useDispatch } from '@umijs/max';

import useIframeAction from './useIframeAction';
import { getToken, getssoToken } from '@/utils/auth';
import { spliceOrigin, getFileUrl } from '@/utils/file';

import { IAgentCache } from '@/typescript/agent';
import type { ISessionState } from '@/models/session';

import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';

type IProps = {
  agent: Partial<IAgentCache> & Pick<IAgentCache, 'agentHomeUrl' | 'id'>;
};

function AgentIframe(props: IProps) {
  const dispatch = useDispatch();

  const { agent } = props;
  const { agentHomeUrl, id, resourceCode } = agent;

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
    if (!agentHomeUrl) return '';

    const myUrl = chain(agentHomeUrl)
      .replace('{beyond-token}', getToken())
      .replace('{sso-token}', getssoToken())
      .value();

    const srcObj = new URL(myUrl);

    if (!agentHomeUrl.includes('{beyond-token}')) {
      srcObj.searchParams.append('beyondtoken', getToken());
    }

    const uniqueId = generateUniqueId();
    uuidRef.current = uniqueId;

    const files: Array<{
      fileId: number;
      fileName: string;
      fileType: string;
      fileUrl: string;
    }> = [];
    concat([], nextSessionIFileCache || []).forEach((item) => {
      if (item.queryFile) {
        files.push({
          ...(pick(item.queryFile, ['fileId', 'fileName', 'fileType']) as {
            fileId: number;
            fileName: string;
            fileType: string;
          }),
          fileUrl: spliceOrigin(getFileUrl(item?.queryFile?.fileUrl || '')),
        });
      }
    });

    srcObj.searchParams.append('uuid', uuidRef.current);
    srcObj.searchParams.append('objectId', `${id}`);
    srcObj.searchParams.append('resourceCode', resourceCode || '');
    srcObj.searchParams.append('sessionId', `${sessionId}`);
    srcObj.searchParams.append('files', btoa(encodeURIComponent(JSON.stringify(files))));
    srcObj.searchParams.append('language', `${getLocale()}`);

    return srcObj.toString();
  }, [agentHomeUrl, id, resourceCode, sessionId, nextSessionIFileCache]);

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
