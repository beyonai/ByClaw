import classnames from 'classnames';
import React, { Suspense, useMemo } from 'react';

import lazyHandler from '@/components/MessageList/lazyHandler';
import NotSupport from '@/components/NotSupport';

import { SSEMessageType } from '@/constants/message';
import type { IMessage, IMessageListItem, NewIMessageListItem } from '@/typescript/message';

import styles from './index.module.less';

const ThinkingProcessItemRender = (props: {
  thinkListItem: NewIMessageListItem;
  compKey: string;
  message: IMessage;
  updateMessageListItem: (path: string, val: any) => void;
  messageIdx: number;
}) => {
  const { thinkListItem, compKey, updateMessageListItem, message, messageIdx } = props;

  const { content, contentType } = thinkListItem;
  const Comp = React.useMemo(() => {
    return lazyHandler.lazyComp(`${contentType}`);
  }, [contentType]);

  const updateMessageListItemContent = React.useCallback(
    (content: IMessageListItem['content']) => {
      updateMessageListItem('content', content);
    },
    [updateMessageListItem]
  );

  const isNotThinkingProcessItem = useMemo(() => {
    return [
      `${SSEMessageType.thinkTitle}`,
      `${SSEMessageType.thinkSubTitle}`,
      `${SSEMessageType.thinkStatusTitle}`,
      `${SSEMessageType.thinkRootTitle}`,
      `${SSEMessageType.thinkTaskPrepare}`,
      `${SSEMessageType.thinkTaskExecute}`,
      `${SSEMessageType.thinkTaskResult}`,
    ].includes(`${contentType}`);
  }, [contentType]);

  const isThinkingProcessItemInline = useMemo(() => {
    return [
      `${SSEMessageType.thinkTaskPrepare}`,
      `${SSEMessageType.thinkTaskExecute}`,
      `${SSEMessageType.thinkTaskResult}`,
    ].includes(`${contentType}`);
  }, [contentType]);

  if (!Comp) return <NotSupport />;

  return (
    <div
      className={classnames({
        [styles.thinkingProcessItem]: !isNotThinkingProcessItem,
        [styles.thinkingProcessItemInline]: isThinkingProcessItemInline,
        [styles.isThinkTaskPrepare]: `${contentType}` === `${SSEMessageType.thinkTaskPrepare}`,
      })}
      data-comptype={contentType}
    >
      <Suspense>
        <Comp
          key={`${compKey}_comp`}
          messageListItemContent={content}
          thinkListItem={thinkListItem}
          message={message}
          messageIdx={messageIdx}
          updateMessageListItemContent={updateMessageListItemContent}
        />
      </Suspense>
    </div>
  );
};

export default ThinkingProcessItemRender;
