import { IMessageState, SSEMessageType } from '@/constants/message';
import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import type { IMessage, IMessageListItem } from '@/typescript/message';

export type EasyConfirmDescriptor = {
  message: IMessage;
  messageListItemContent: IMessageListItem['content'];
  messageIdx: number;
  messageListItem?: IMessageListItem;
  thinkListItem?: IMessageListItem;
  updateMessageListItemContent: (messageListItemContent: IMessageListItem['content']) => IMessage;
};

type UpdateMessage = (message: IMessage) => IMessage | void;
type MessageListKey = 'messageList' | 'thinkList';

const easyConfirmContentTypes = new Set<string>([
  `${SSEMessageType.approvalForm}`,
  `${SSEMessageType.thinkRewriteQuestion}`,
  `${SSEMessageType.thinkTaskUserInput}`,
  `${SSEMessageType.askUserQuestions}`,
]);

export const isEasyConfirmContentType = (contentType: SSEMessageType) => easyConfirmContentTypes.has(`${contentType}`);

const terminalFormStatuses = new Set<IFormStatus>([IFormStatus.FINISH, IFormStatus.DISABLED, IFormStatus.ERROR]);

const getFormStatus = (item: IMessageListItem): IFormStatus | undefined => {
  const content = item.content as {
    formStatus?: IFormStatus;
    substance?: { formStatus?: IFormStatus };
  };
  return content?.formStatus ?? content?.substance?.formStatus;
};

/** 判断消息项是否仍需要用户在快捷确认区完成操作。 */
export const isPendingEasyConfirmListItem = (message: IMessage, item: IMessageListItem) => {
  if (message.messageState !== IMessageState.Answer || !isEasyConfirmContentType(item.contentType)) {
    return false;
  }

  const formStatus = getFormStatus(item);
  if (formStatus !== undefined && terminalFormStatuses.has(formStatus)) {
    return false;
  }

  return true;
};

export const hasPendingEasyConfirmItem = (message: IMessage, items: IMessageListItem[] = []) =>
  items.some((item) => isPendingEasyConfirmListItem(message, item));

const createDescriptor = (
  message: IMessage,
  item: IMessageListItem,
  messageIdx: number,
  listKey: MessageListKey,
  updateMessage: UpdateMessage
): EasyConfirmDescriptor => {
  const itemProp = listKey === 'thinkList' ? 'thinkListItem' : 'messageListItem';

  return {
    message,
    messageIdx,
    [itemProp]: item,
    messageListItemContent: item.content,
    updateMessageListItemContent: (messageListItemContent) => {
      const currentList = message[listKey] || [];
      const currentIndex =
        currentList[messageIdx]?.uuid === item.uuid
          ? messageIdx
          : currentList.findIndex((currentItem) => currentItem.uuid === item.uuid);
      if (currentIndex < 0) {
        return message;
      }

      const nextList = [...currentList];
      nextList[currentIndex] = {
        ...nextList[currentIndex],
        content: messageListItemContent,
      };
      const nextMessage = {
        ...message,
        [listKey]: nextList,
      };

      return updateMessage(nextMessage) || nextMessage;
    },
  };
};

/** 从消息数据直接提取快捷确认项，避免依赖业务组件是否已经挂载。 */
export const collectEasyConfirmItems = (message: IMessage | undefined, updateMessage: UpdateMessage) => {
  if (!message) return [];

  const candidates = (['thinkList', 'messageList'] as MessageListKey[]).flatMap((listKey, channelIndex) =>
    (message[listKey] || []).map((item, messageIdx) => ({
      item,
      messageIdx,
      listKey,
      channelIndex,
    }))
  );

  return candidates
    .filter(({ item }) => isPendingEasyConfirmListItem(message, item))
    .sort((left, right) => {
      const leftSeq = left.item.seq;
      const rightSeq = right.item.seq;
      if (Number.isFinite(leftSeq) && Number.isFinite(rightSeq)) {
        return Number(leftSeq) - Number(rightSeq);
      }
      return left.channelIndex - right.channelIndex || left.messageIdx - right.messageIdx;
    })
    .map(({ item, messageIdx, listKey }) => createDescriptor(message, item, messageIdx, listKey, updateMessage));
};
