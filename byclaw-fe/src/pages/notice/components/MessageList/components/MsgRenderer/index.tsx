// tslint:disable:ordered-imports
import React, { Suspense } from 'react';

import { set } from 'lodash';

import Markdown from '@/components/Markdown';

import lazyHandler from '@/pages/notice/components/MessageList/lazyHandler';
import NotSupport from '@/components/NotSupport';

import type { IMessage, IMessageListItem } from '@/typescript/message';

type IProps = {
  msg: IMessage;
  updateMessage: (message: IMessage) => void;
};

function MsgRenderer(props: IProps) {
  const { msg, updateMessage } = props;

  const { text, messageList, msgId } = msg;

  const updateMessageList = React.useCallback(
    (path: string, val: any) => {
      const newMsg = { ...msg };
      set(newMsg, `messageList.${path}`, val);
      updateMessage(newMsg);
    },
    [updateMessage, msg]
  );

  return (
    <>
      {text && (
        <div className="askText">
          <Markdown msg={msg} text={text} />
        </div>
      )}
      {messageList?.map((messageListItem, messageIdx) => {
        const key = `${msgId}_message_${messageIdx}`;

        const { content, contentType } = messageListItem;

        const Comp = lazyHandler.lazyComp(`${contentType}`) as React.ComponentType<any> | null;

        if (!Comp) return <NotSupport />;
        return (
          <div data-comptype={contentType} key={`${key}_div`}>
            <Suspense key={`${key}_Suspense`}>
              <Comp
                key={`${key}_Comp`}
                message={msg}
                messageListItem={messageListItem}
                messageListItemContent={content}
                messageIdx={messageIdx}
                updateMessageListItemContent={(content: IMessageListItem['content']) => {
                  updateMessageList(`${messageIdx}.content`, content);
                }}
              />
            </Suspense>
          </div>
        );
      })}
    </>
  );
}

export default MsgRenderer;
