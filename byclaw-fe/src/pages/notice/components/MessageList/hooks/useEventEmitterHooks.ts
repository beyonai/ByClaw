import { useEffect, useState } from 'react';

import { createMessage } from '@/utils/messgae';

import { IMessageState } from '@/constants/message';
import { ISendConf, ISendProps } from '@/hooks/useChat';
import { IMessage } from '@/typescript/message';
import useGlobal from '@/hooks/useGlobal';

type IProps = {
  sendQuery: (sendProps: ISendProps, sendConf?: ISendConf) => void;
  updateMessage: (msg: IMessage, opt?: { isAssign?: boolean }) => void;
  deleteMessage: (msg: IMessage) => void;
};

function useEventEmitterHooks(props: IProps) {
  const { updateMessage, sendQuery, deleteMessage } = props;
  const { EventEmitter } = useGlobal();

  const [disabledInput, setDisabledInput] = useState(false);

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

  return {
    disabledInput,
  };
}

export default useEventEmitterHooks;
