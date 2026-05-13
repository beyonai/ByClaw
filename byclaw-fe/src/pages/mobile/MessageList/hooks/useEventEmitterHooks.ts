import { get, head, isBoolean, isEmpty, uniq } from 'lodash';
import { useEffect, useState } from 'react';

import { createMessage, multiChoicesHandler } from '@/utils/messgae';

import { IMessageState } from '@/constants/message';
import { ISendConf, ISendProps } from '@/hooks/useChat';
import type { IAgentType } from '@/typescript/agent';
import { IMessage, IResourceFromItem } from '@/typescript/message';
import useGlobal from '@/hooks/useGlobal';

type IProps = {
  sendQuery: (sendProps: ISendProps, sendConf?: ISendConf) => void;
  updateMessage: (msg: IMessage, opt?: { isAssign?: boolean }) => void;
  deleteMessage: (msg: IMessage) => void;
  messageList: IMessage[];
  openDrawerSourceFromInfo: (sourceFrom: IResourceFromItem[]) => void;
  setMyAgentType: (agentType: IAgentType) => void;
};

export type IMultiChoicesType = 'reference' | 'shared' | 'collect';

function useEventEmitterHooks(props: IProps) {
  const { updateMessage, messageList, openDrawerSourceFromInfo, sendQuery, setMyAgentType, deleteMessage } = props;
  const { EventEmitter } = useGlobal();

  const [disabledInput, setDisabledInput] = useState(false);
  const [multiChoicesList, setMultiChoicesList] = useState<IMultiChoicesType[]>([]);
  const [multiChoicesMsgId, setMultiChoicesMsgId] = useState<string[]>([]);

  useEffect(() => {
    const handler = (msgIds: string[] = []) => {
      const myMsgIds: string[] = [];
      msgIds.forEach((msgId) => {
        const msgItemIdx = messageList.findIndex((msgItem) => msgItem.msgId === msgId);
        if (msgItemIdx >= 0) {
          const msgItem = messageList[msgItemIdx];

          myMsgIds.push(...multiChoicesHandler(msgItem, msgItemIdx, messageList));
        }
      });

      setMultiChoicesMsgId(uniq(myMsgIds));
    };

    EventEmitter.on('beyond-messageList-set-multichoices-msgid', handler);

    return () => {
      EventEmitter.off('beyond-messageList-set-multichoices-msgid', handler);
    };
  }, [messageList]);

  useEffect(() => {
    const handler = (isMultichoices: boolean | IMultiChoicesType[] = []) => {
      let res: IMultiChoicesType[] = [];

      if (isBoolean(isMultichoices)) {
        res = isMultichoices ? ['reference', 'shared'] : [];
      }

      if (Array.isArray(isMultichoices)) {
        res = isMultichoices;
      }

      setMultiChoicesList(res);

      if (!isEmpty(res)) {
        requestIdleCallback(() => {
          setMultiChoicesMsgId((list) => {
            if (isEmpty(list)) return list;

            const target = document.getElementById(`wrapper_${head(list)}`);
            if (target) {
              target.scrollIntoView(true);
            }

            return list;
          });
        });
      }
    };

    EventEmitter.on('beyond-messageList-open-multichoices', handler);

    return () => {
      EventEmitter.off('beyond-messageList-open-multichoices', handler);
    };
  }, [multiChoicesList, multiChoicesMsgId]);

  useEffect(() => {
    const onCreateMessage = (payload: IMessage & { messageId: string; msgId?: string }) => {
      const { msgId, messageId, ...rest } = payload;

      updateMessage(
        createMessage({
          msgId: msgId || messageId,
          messageId,
          ...rest,
          messageState: IMessageState.Done,
        })
      );
    };

    EventEmitter.on('beyond-create-message', onCreateMessage);

    return () => {
      EventEmitter.off('beyond-create-message', onCreateMessage);
    };
  }, [updateMessage]);

  useEffect(() => {
    const onUpdateMessage = (payload: {
      message: IMessage & { messageId: string; msgId?: string };
      opt?: { isAssign?: boolean };
    }) => {
      const { message, opt } = payload;
      const { msgId, messageId, ...rest } = message;
      updateMessage(
        {
          msgId: msgId || messageId,
          messageId,
          ...rest,
        },
        opt
      );
    };

    EventEmitter.on('beyond-update-message', onUpdateMessage);

    return () => {
      EventEmitter.off('beyond-update-message', onUpdateMessage);
    };
  }, [updateMessage]);

  useEffect(() => {
    const onDelMessage = (payload: { message: IMessage }) => {
      const { message } = payload;

      deleteMessage(message);
    };

    EventEmitter.on('beyond-delete-message', onDelMessage);

    return () => {
      EventEmitter.off('beyond-delete-message', onDelMessage);
    };
  }, [deleteMessage]);

  useEffect(() => {
    const getSourceFrom = (msgId: string) => {
      const msgItem = messageList.find((msgItem) => msgItem.msgId === msgId);

      if (msgItem) {
        openDrawerSourceFromInfo(get(msgItem, 'resourceFrom', []));
      }
    };

    EventEmitter.on('beyond-show-sourceFrom', getSourceFrom);

    return () => {
      EventEmitter.off('beyond-show-sourceFrom', getSourceFrom);
    };
  }, [messageList, openDrawerSourceFromInfo]);

  useEffect(() => {
    const onSendMsg = (param: { sendProps: ISendProps; sendConf?: ISendConf }) => {
      const { sendProps, sendConf } = param;

      sendQuery(sendProps, sendConf);
    };

    EventEmitter.on('beyond-chat-on-send-msg', onSendMsg);

    return () => {
      EventEmitter.off('beyond-chat-on-send-msg', onSendMsg);
    };
  }, [sendQuery]);

  useEffect(() => {
    const disabledInputHandler = (flag: boolean) => {
      setDisabledInput(flag);
    };

    EventEmitter.on('beyond-input-disabled', disabledInputHandler);
    return () => {
      EventEmitter.off('beyond-input-disabled', disabledInputHandler);
    };
  }, []);

  useEffect(() => {
    const changeMyAgentType = (agentType: IAgentType) => {
      setMyAgentType(agentType);
    };

    EventEmitter.on('beyond-input-change-agenttype', changeMyAgentType);
    return () => {
      EventEmitter.off('beyond-input-change-agenttype', changeMyAgentType);
    };
  }, []);

  return {
    disabledInput,

    multiChoicesList,
    setMultiChoicesList,

    multiChoicesMsgId,
    setMultiChoicesMsgId,
  };
}

export default useEventEmitterHooks;
