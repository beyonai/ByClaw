import useGlobal from '@/hooks/useGlobal';
import { IMessageState } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import React, { useCallback, useEffect } from 'react';
import { isPendingEasyConfirmListItem } from './easyConfirm';

export type EasyConfirmComponentProps = {
  message: IMessage;
  messageListItemContent: any;
  messageIdx: number;
  messageListItem?: IMessageListItem;
  thinkListItem?: IMessageListItem;
  updateMessageListItemContent: (messageListItemContent: any) => IMessage;

  /** 仅供 EasyConfirm 外部承载实例使用，普通消息实例仍隐藏待处理交互。 */
  renderInEasyConfirm?: boolean;
};

function getLatestListItem(
  messageList: IMessageListItem[],
  messageIdx: number | undefined,
  currentListItem: IMessageListItem
): IMessageListItem | undefined {
  if (messageIdx !== undefined && messageList[messageIdx]?.uuid === currentListItem.uuid) {
    return messageList[messageIdx];
  }

  return messageList.find((item) => item.uuid === currentListItem.uuid);
}

/** 将需要在快捷确认区域展示的消息组件注册到事件总线。 */
export default function withEasyConfirm<P extends EasyConfirmComponentProps>(Comp: React.ComponentType<P>) {
  const EasyConfirmComponent = (props: P) => {
    const { EventEmitter } = useGlobal();

    const isThinkingProcess = !!props.thinkListItem;
    const listItemProp = isThinkingProcess ? 'thinkListItem' : 'messageListItem';
    const messageListProp = isThinkingProcess ? 'thinkList' : 'messageList';

    const updateMessageListItemContent = useCallback(
      (messageListItemContent: P['messageListItemContent']) => {
        const message = props.updateMessageListItemContent(messageListItemContent);

        const currentListItem = props[listItemProp];

        if (!currentListItem) {
          EventEmitter.emit('beyond-easyconfirm-set-approvalform-item', {
            ...props,
            message,
            messageListItemContent,
          });
          return message;
        }

        const latestListItem = getLatestListItem(message[messageListProp] || [], props.messageIdx, currentListItem);
        const latestListItemContent = latestListItem?.content || messageListItemContent;

        EventEmitter.emit('beyond-easyconfirm-set-approvalform-item', {
          ...props,
          message,
          [listItemProp]: latestListItem || {
            ...currentListItem,
            content: latestListItemContent,
          },
          messageListItemContent: latestListItemContent,
        });

        return message;
      },
      [EventEmitter, props.updateMessageListItemContent, listItemProp, messageListProp, props.messageIdx]
    );

    useEffect(() => {
      if (props.message.messageState === IMessageState.Answer) {
        EventEmitter.emit('beyond-easyconfirm-set-approvalform-item', props);
      }
    }, []);

    if (!props.renderInEasyConfirm) {
      const currentItem = props.thinkListItem || props.messageListItem;
      if (currentItem && isPendingEasyConfirmListItem(props.message, currentItem)) return null;
    }

    return <Comp {...props} updateMessageListItemContent={updateMessageListItemContent} />;
  };

  EasyConfirmComponent.displayName = `withEasyConfirm(${Comp.displayName || Comp.name || 'Component'})`;

  return EasyConfirmComponent;
}
