import useGlobal from '@/hooks/useGlobal';
import { IMessageState } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';
// import { message as antMessage } from 'antd';
import React, { useCallback, useEffect } from 'react';
import { isPendingEasyConfirmListItem } from './easyConfirm';

export type EasyConfirmNotificationContent = {
  title: string;
  body: string;
  permissionDenied: string;
  tag: string;
};

let notificationPermissionRequest: Promise<NotificationPermission> | null = null;

/*
let pendingPermissionDeniedMessage = '';
let permissionReminderListening = false;

const isBrowserWindowActive = () => document.visibilityState === 'visible' && document.hasFocus();

function showPendingPermissionDeniedMessage() {
  if (!pendingPermissionDeniedMessage || !isBrowserWindowActive()) return;

  antMessage.info({
    content: pendingPermissionDeniedMessage,
    key: 'easy-confirm-notification-permission-denied',
    duration: 6,
  });
  pendingPermissionDeniedMessage = '';
  if (permissionReminderListening) {
    window.removeEventListener('focus', showPendingPermissionDeniedMessage);
    document.removeEventListener('visibilitychange', showPendingPermissionDeniedMessage);
    permissionReminderListening = false;
  }
}

const remindNotificationPermissionDenied = (content: string) => {
  pendingPermissionDeniedMessage = content;
  showPendingPermissionDeniedMessage();

  if (!pendingPermissionDeniedMessage || permissionReminderListening) return;

  // 同时监听焦点和可见性，兼容 Windows 与 macOS 上浏览器恢复窗口的不同事件顺序。
  window.addEventListener('focus', showPendingPermissionDeniedMessage);
  document.addEventListener('visibilitychange', showPendingPermissionDeniedMessage);
  permissionReminderListening = true;
};
*/

const requestNotificationPermission = () => {
  if (!notificationPermissionRequest) {
    notificationPermissionRequest = new Promise<NotificationPermission>((resolve, reject) => {
      try {
        // 回调参数兼容旧版 Safari，返回的 Promise 覆盖现代 Windows/macOS 浏览器。
        const request = Notification.requestPermission(resolve);
        request?.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    }).finally(() => {
      notificationPermissionRequest = null;
    });
  }

  return notificationPermissionRequest;
};

/** 为新出现的待处理快捷交互发送跨平台浏览器通知。 */
export const notifyEasyConfirmInteraction = async (content: EasyConfirmNotificationContent) => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !('Notification' in window)) return;

  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await requestNotificationPermission();
    } catch {
      // 部分浏览器会在非安全上下文或策略限制下拒绝权限请求，保持聊天流程不受影响。
      return;
    }
  }

  /*
  if (permission === 'denied') {
    remindNotificationPermissionDenied(content.permissionDenied);
    return;
  }
  */
  if (permission !== 'granted') return;

  try {
    const notice = new Notification(content.title, {
      body: content.body,
      tag: content.tag,
    });
    notice.onclick = () => {
      window.focus();
      notice.close();
    };
  } catch {
    // 浏览器或系统策略禁用通知构造器时，不中断 WebSocket 消息处理。
  }
};

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
