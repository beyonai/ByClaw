import React from 'react';

import { SSEMessageType, IMessageState, SSEEventStatus } from '@/constants/message';
import { agentTypeMap } from '@/constants/agent';
import { createMessage } from '@/utils/messgae';

import { IMessage } from '@/typescript/message';
import useAppStore from '@/models/common/useAppStore';

type IDrawerMessage = Partial<IMessage> & {
  messageId: string;
};

type IProps = {
  uuid: string;
  templateId: string;
  saveExtraPayload: {
    sessionId: string;
    messageId?: string;
    agentId?: string;
    msgId?: string;
  };

  onClose: () => void;
  onCreateMessage: (payload: IDrawerMessage) => void;
  onUpdateMessage: (payload: IDrawerMessage) => void;
  onDelMessage: (payload: Omit<IDrawerMessage, 'messageId'>) => void;
  onLoadedCb: () => void;
};

function useIframeAction(props: IProps) {
  const { uuid, templateId, saveExtraPayload } = props;
  const { onClose, onCreateMessage, onUpdateMessage, onDelMessage, onLoadedCb } = props;

  const { sessionId } = saveExtraPayload;

  const [msgId, setMsgId] = React.useState(saveExtraPayload.msgId);

  const { setSiderCollapsed } = useAppStore();

  const getMsg = React.useCallback(
    (content: { data: { docId: string }; html: string }, messageId: string): IMessage => {
      const { data, html } = content || {};
      const { docId } = data || {};

      return createMessage({
        fromBeyond: true,
        agentType: agentTypeMap.writer,
        messageState: IMessageState.Done,
        sessionId,
        messageId,
        msgId,
        messageList: [
          {
            content: {
              substance: {
                docId,
                templateId,
                content: html,
              },
            },
            contentType: SSEMessageType.article,
            status: SSEEventStatus.done,
          },
        ],
      });
    },
    [templateId, sessionId, msgId]
  );

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { eventType, data, type } = event.data;

      console.log(event);
      const myEventType = eventType || type;

      if (event.data.uuid !== uuid) return;

      if (myEventType === 'onload') {
        onLoadedCb();
      }

      if (myEventType === 'addMessage') {
        const { content, messageId } = data;

        const msg = getMsg(content, messageId);
        setMsgId(msg.msgId);

        onCreateMessage(msg);
      }
      if (myEventType === 'updateMessage') {
        const { content, messageId } = data;

        const msg = getMsg(content, messageId);
        setMsgId(msg.msgId);

        onUpdateMessage(msg);
      }
      if (myEventType === 'deleteMessage') {
        onDelMessage({
          msgId,
        });
      }
      if (myEventType === 'siderIsCollapsed') {
        const { content } = data;
        setSiderCollapsed(!!content);
      }
      if (myEventType === 'close') {
        onClose();
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [onCreateMessage, onUpdateMessage, onClose, onDelMessage, onLoadedCb, uuid, msgId]);

  return {
    sessionId,
    messageId: saveExtraPayload.messageId,
  };
}

export default useIframeAction;
