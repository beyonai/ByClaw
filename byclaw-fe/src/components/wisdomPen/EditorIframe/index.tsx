import React from 'react';

import { generateUniqueId } from '@/utils/math';
import { Spin } from 'antd';

import useIframeAction from './useIframeAction';
import { getWriterEditorUrl } from '@/utils/agent';

import { IMessage } from '@/typescript/message';

import styles from './index.module.less';

type IDrawerMessage = Partial<IMessage> & {
  messageId: string;
};

type IProps = {
  url?: string;
  saveExtraPayload: {
    sessionId: string;
    messageId?: string;
    agentId?: string;
  };
  editorData?: string;
  docId: string;
  templateId: string;
  generateType: 'add';

  onClose: () => void;
  onCreateMessage: (payload: IDrawerMessage) => void;
  onUpdateMessage: (payload: IDrawerMessage) => void;
  onDelMessage: (payload: Omit<IDrawerMessage, 'messageId'>) => void;
};

function WriterEditorIframe(props: IProps) {
  const { url, saveExtraPayload, docId, templateId, generateType } = props;
  const { onClose, onCreateMessage, onUpdateMessage, onDelMessage } = props;

  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const uuidRef = React.useRef<string>(generateUniqueId());

  const [isLoading, setIsLoading] = React.useState(true);

  const onLoadedCb = React.useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe || !props.editorData) return;

    const { contentWindow } = iframe;
    if (!contentWindow) return;

    contentWindow.postMessage(
      {
        eventType: 'send-editor-data-from-beyond',
        data: {
          uuid: uuidRef.current,
          editorData: props.editorData,
        },
      },
      '*'
    );
  }, [props.editorData]);

  const { messageId, sessionId } = useIframeAction({
    uuid: uuidRef.current,
    templateId,
    saveExtraPayload,

    onClose,
    onCreateMessage,
    onUpdateMessage,
    onDelMessage,

    onLoadedCb,
  });

  const iframeSrc = React.useMemo(() => {
    const myUrl =
      url ||
      getWriterEditorUrl({
        messageId,
        docId,
        templateId,
        sessionId,
        generateType,
      });

    if (!myUrl) return '';

    const srcObj = new URL(myUrl);

    srcObj.searchParams.append('uuid', uuidRef.current);
    console.log('iframeSrc:', srcObj.toString());
    return srcObj.toString();
  }, [url, sessionId, docId, templateId, messageId, generateType]);

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
      />
    </Spin>
  );
}
export default WriterEditorIframe;
