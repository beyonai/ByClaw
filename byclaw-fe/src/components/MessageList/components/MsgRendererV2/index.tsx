import React, { Suspense, useMemo } from 'react';
import { set } from 'lodash';

import Markdown from '@/components/Markdown';
import NotSupport from '@/components/NotSupport';
import lazyHandler from '@/components/MessageList/lazyHandler';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import getDisplayQuestion from '@/components/QueryInput/getDisplayQuestion';
import ThinkingBlock from './ThinkingBlock';
import { groupOrderedItems, isThinkingGroupEnded, mergeOrderedItems, validateOrderedItems } from './ordered';
import MsgRenderer from '@/components/MessageList/components/MsgRenderer';

type Props = {
  msg: IMessage;
  updateMessage: (message: IMessage) => IMessage | void;
  hideThinking?: boolean;
};

export default function MsgRendererV2({ msg, updateMessage, hideThinking }: Props) {
  const orderedItems = useMemo(
    () => mergeOrderedItems(msg.thinkList, msg.messageList),
    [msg.thinkList, msg.messageList]
  );
  const valid = validateOrderedItems(orderedItems.map(({ item }) => item));
  const groups = valid ? groupOrderedItems(orderedItems) : [];
  const displayTextMarkdown = getDisplayQuestion({ text: msg.text, resourceList: msg.resourceList, isMarkdown: true });

  if (!valid) {
    console.warn('[message-v2] invalid seq; falling back to legacy renderer', msg.msgId);
    return <MsgRenderer msg={msg} updateMessage={updateMessage} hideThinking={hideThinking} />;
  }

  return (
    <>
      {msg.text && <Markdown msg={msg} text={displayTextMarkdown} />}
      {groups.map((group, groupIndex) => {
        if (group.channel === 'think') {
          if (hideThinking) return null;
          const hasNextGroup = groupIndex < groups.length - 1;
          const ended = isThinkingGroupEnded(hasNextGroup, msg.messageState, Boolean(msg.thinkDone));
          return (
            <ThinkingBlock
              key={`${msg.msgId}_${group.blockId}`}
              blockId={group.blockId}
              items={group.items}
              message={msg}
              ended={ended}
              updateMessage={updateMessage}
            />
          );
        }
        return group.items.map((messageListItem: IMessageListItem) => {
          const Comp = lazyHandler.lazyComp(`${messageListItem.contentType}`) as React.ComponentType<any> | null;
          if (!Comp) return <NotSupport key={`${msg.msgId}_${messageListItem.seq}`} />;
          return (
            <Suspense key={`${msg.msgId}_${messageListItem.seq}`}>
              <Comp
                message={msg}
                messageListItem={messageListItem}
                messageListItemContent={messageListItem.content}
                updateMessageListItemContent={(content: IMessageListItem['content']) => {
                  const index = msg.messageList?.findIndex((item) => item.seq === messageListItem.seq) ?? -1;
                  if (index < 0) return msg;
                  const next = { ...msg };
                  set(next, `messageList.${index}.content`, content);
                  updateMessage(next);
                  return next;
                }}
              />
            </Suspense>
          );
        });
      })}
    </>
  );
}
