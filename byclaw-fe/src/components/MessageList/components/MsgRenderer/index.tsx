// tslint:disable:ordered-imports
import React, { Suspense } from 'react';

import { set } from 'lodash';

import Markdown from '@/components/Markdown';

import ThinkingProcessRender from '@/components/MessageList/components/ThinkingProcessRender';

import lazyHandler from '@/components/MessageList/lazyHandler';
import NotSupport from '@/components/NotSupport';

import type { IMessage, IMessageListItem } from '@/typescript/message';
import getDisplayQuestion from '@/components/QueryInput/getDisplayQuestion';

type IProps = {
  msg: IMessage;
  updateMessage: (message: IMessage) => void;
  hideThinking?: boolean;
};

const CompRenderer = React.memo(
  (props: {
    Comp: React.ComponentType<any>;
    message: IMessage;
    messageListItem: IMessageListItem;
    messageListItemContent: IMessageListItem['content'];
    messageIdx: number;
    updateMessageList: (path: string, val: any) => void;
  }) => {
    const { Comp, message, messageListItem, messageListItemContent, messageIdx, updateMessageList } = props;

    const updateMessageListItemContent = React.useCallback(
      (content: IMessageListItem['content']) => {
        updateMessageList(`${messageIdx}.content`, content);
      },
      [updateMessageList, messageIdx]
    );

    return (
      <Comp
        message={message}
        messageListItem={messageListItem}
        messageListItemContent={messageListItemContent}
        messageIdx={messageIdx}
        updateMessageListItemContent={updateMessageListItemContent}
      />
    );
  }
);

function MsgRenderer(props: IProps) {
  const { msg, hideThinking, updateMessage } = props;

  const { text, messageList, msgId } = msg;

  const updateMessageList = React.useCallback(
    (path: string, val: any) => {
      const newMsg = { ...msg };
      set(newMsg, `messageList.${path}`, val);
      updateMessage(newMsg);
    },
    [updateMessage, msg]
  );

  const displayTextMarkdown = React.useMemo(() => {
    return getDisplayQuestion({
      text,
      resourceList: msg.resourceList,
      isMarkdown: true,
    });
  }, [text, msg.resourceList]);

  return (
    <>
      {!hideThinking && <ThinkingProcessRender msg={msg} updateMessage={updateMessage} />}
      {text && (
        <div className="askText">
          <Markdown msg={msg} text={displayTextMarkdown} />
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
              <CompRenderer
                Comp={Comp}
                message={msg}
                messageListItem={messageListItem}
                messageListItemContent={content}
                messageIdx={messageIdx}
                updateMessageList={updateMessageList}
              />
            </Suspense>
          </div>
        );
      })}
    </>
  );
}

export default MsgRenderer;
