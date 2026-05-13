import { get, pick, reverse, slice, set, concat, omit, compact, size, last } from 'lodash';

import { getModelState } from '@/utils';
import { answerDeltaHandler, reasoningLogHandler } from '@/hooks/useSseSender/util';
import { substanceHandler } from '@/hooks/useChat/util';

import { IMessage, IMessageListItem } from '@/typescript/message';
import { IMessageState, SSEMessageType, SSEEventStatus } from '@/constants/message';
import { ResourceTypeMap } from '@/constants/resource';

export function getMsgId() {
  const crypto = window.crypto || window.webkitCrypto || window.mozCrypto || window.oCrypto || window.msCrypto;
  if (crypto) {
    const buff = crypto.getRandomValues(new Uint32Array(1));
    return String(buff[0]);
  }

  const arr = reverse(`${new Date().getTime()}`.split(''));
  return slice(arr, 0, 10).join('');
}

export const isTextContentType = (contentType?: SSEMessageType | string) => {
  if (!contentType) return false;
  return [`${SSEMessageType.text}`, `${SSEMessageType.thinkText}`].includes(`${contentType}`);
};

export const createMessage = (
  param: Omit<IMessage, 'msgId' | 'creatorId' | 'createTime'> & { msgId?: string; creatorId?: string }
): IMessage => {
  const userState = getModelState('user');

  return {
    creatorId: userState?.userInfo?.userId,
    creatorName: userState?.userInfo?.userName,
    createTime: `${new Date().getTime()}`,
    ...param,
    msgId: `${param.msgId || getMsgId()}`, // 使用参数中的 msgId，如果没有则生成新的
  };
};

export const initQueryMessage = (param: Partial<IMessage>): IMessage => {
  return createMessage({
    text: get(param, 'text', ''),
    fromBeyond: false,
    messageState: IMessageState.Done,
    ...pick(param, ['msgId', 'messageId', 'agentType', 'agentId', 'sessionId', 'createTime']),
  });
};

export const initAnswerMessage = (param: Partial<IMessage>): IMessage => {
  return createMessage({
    text: '',
    fromBeyond: true,
    messageState: IMessageState.Query,
    messageList: [],
    imageList: [],
    fileList: [],
    citeMsgList: [],
    thinkList: [],
    thinkDone: false,
    thinkCollapse: false,
    messageTip: '',
    traceback: '',
    metadata: '',
    resourceFrom: [],
    relatedQuestions: [],
    ...pick(param, [
      'msgId',
      'messageId',
      'agentType',
      'agentId',
      'sessionId',
      'queryMsgId',
      'createTime',
      'answerMsgId',
      // initMessage 时须保留流式已写入的 metadata（如 LangGraph checkpoint），否则会落回默认空串
      'metadata',
    ]),
  });
};

export const multiChoicesHandler = (choicesMsg: IMessage, choicesMsgIdx: number, messageList: IMessage[]) => {
  const list = [];
  const { fromBeyond, msgId, messageState } = choicesMsg;

  const canSelectStatusList = [IMessageState.Done, IMessageState.Cancel];

  if (!canSelectStatusList.includes(messageState)) {
    return [];
  }

  // 回答默认勾选提问
  const prevMessage = get(messageList, [choicesMsgIdx - 1]) || {};
  const { msgId: prevMessageId, fromBeyond: prevFromBeyond } = prevMessage;
  if (fromBeyond && !prevFromBeyond && prevMessageId) {
    list.push(prevMessageId);
  }

  list.push(msgId);

  // 提问默认勾选回答
  const nextMessage = get(messageList, [choicesMsgIdx + 1]) || {};
  const { msgId: nextMessageId, fromBeyond: nextFromBeyond, messageState: nextMessageState } = nextMessage;
  if (!fromBeyond && nextFromBeyond && nextMessageId && canSelectStatusList.includes(nextMessageState)) {
    list.push(nextMessageId);
  }

  return list;
};

export const fetchMessageHandler = (item: any) => {
  const userState = getModelState('user');
  const userId = get(userState, 'userInfo.userId');

  const {
    usage,
    messageContent,
    messageId = '',
    inferLog,
    metadata,
    messageStruct,
    relatedResources,
    creatorId,
    creatorName,
    msgStatus,
    resComIds,
    createTime,
    collectIds,
    sessionId,
  } = item;

  // usage： 1-用户 2-大模型 3-追问 4-转发消息 5-交互消息
  const isMyMessage = `${creatorId}` === `${userId}` && ['1', '4'].includes(`${usage}`);
  const fromOtherUser = `${creatorId}` !== `${userId}` && ['1', '4'].includes(`${usage}`);
  const isSystemMessage = ['5', '3'].includes(`${usage}`);
  const fromBeyond = !isMyMessage && !fromOtherUser;

  const myMessage: IMessage & { text: string } = {
    creatorId,
    creatorName,
    msgStatus,
    fromBeyond,
    fromOtherUser,
    usage,
    text: '',
    messageId: `${messageId}`,
    msgId: `${messageId}`,
    sessionId: sessionId ? `${sessionId}` : undefined,
    messageState: IMessageState.Done,
    metadata,
    createTime,
    collectIds,
    messageList: [],
    thinkList: [],
    fileList: [],
    imageList: [],
  };

  // 用户消息
  if (!fromBeyond) {
    let textFromObject = '';
    // uiagent 临时处理消息不是纯文本情况todo
    if (messageContent) {
      try {
        const jsonMsg = JSON.parse(messageContent);
        textFromObject = jsonMsg?.text;
      } catch (e) {
        console.log('不是json对象');
      }
    }
    Object.assign(myMessage, {
      text: textFromObject || messageContent,
    });
  }

  if (resComIds) {
    try {
      set(myMessage, 'resComIds', JSON.parse(resComIds));
    } catch (e) {
      console.error(e);
    }
  }

  // 百应消息
  // mcp思考过程
  if (inferLog) {
    try {
      const inferLogObj = JSON.parse(inferLog);

      const list: Partial<IMessageListItem>[] = [];

      inferLogObj.forEach((item: any) => {
        const res = get(reasoningLogHandler(item), 'message');
        if (!res) return;

        if (isTextContentType(`${res?.contentType}`)) {
          if (!res?.content?.substance) return;

          const lastMessageItem = last(list);

          const newMessageItem = substanceHandler(res, lastMessageItem);

          if (newMessageItem) {
            list.push(newMessageItem);
          }

          return;
        }

        list.push(res);
      });

      set(myMessage, 'thinkList', list);

      set(myMessage, 'thinkDone', true);
    } catch (e) {
      console.error(e);
    }
  }

  // 聊天sse消息载体内容
  if (messageStruct) {
    try {
      const messageStructObj = JSON.parse(messageStruct);
      const list = concat([], messageStructObj);
      list.forEach((item) => {
        const message = get(answerDeltaHandler(item), 'message');

        if (message) {
          const { contentType } = message;

          switch (`${contentType}`) {
            case `${SSEMessageType.text}`:
            case `${SSEMessageType.thinkText}`: {
              const substance = get(message, 'content.substance');
              if (substance) {
                myMessage.messageList?.push?.(message as IMessageListItem);
              }
              break;
            }
            default:
              myMessage.messageList?.push?.(message as IMessageListItem);
              break;
          }
        }
      });
    } catch (e) {
      console.error(e);
    }
  }

  // 企业资料思考过程、文件查询
  if (relatedResources) {
    try {
      const relatedResourcesObj = JSON.parse(relatedResources);

      set(myMessage, 'resourceFrom', get(relatedResourcesObj, 'resources', []));
      if (relatedResourcesObj.hasOwnProperty('resourceList')) {
        // 输入问题涉及到的资源（数字员工、企业员工、知识库、文件等等），放在了relatedResources里面，需要转移出来
        set(myMessage, 'resourceList', relatedResourcesObj.resourceList);
      }
      get(relatedResourcesObj, 'files', [])?.forEach(
        (item: {
          fileId: number;
          fileType: 'image' | 'file';
          fileUrl: string;
          fileSize: number;
          downloadUrl?: string;
        }) => {
          const { fileId, fileType, fileUrl, fileSize } = item;

          const filePayload = {
            fileType,
            uid: `${fileId || ''}`,
            imgUrl: fileType === 'image' ? fileUrl : undefined,
            status: 'done',
            downloadUrl: item.downloadUrl,
            queryFile: {
              ...omit(item, ['fileType']),
              length: fileSize,
            },
          };

          if (fileType === 'image') {
            myMessage.imageList?.push(filePayload);
          }
          if (fileType === 'file') {
            myMessage.fileList?.push(filePayload);
          }
        }
      );

      set(myMessage, 'extParams', get(relatedResourcesObj, 'extParams'));
    } catch (e) {
      console.error(e);
    }
  }

  if (usage === '4') {
    myMessage.messageList?.push?.({
      content: {
        substance: null,
      },
      contentType: SSEMessageType.forward,
      status: SSEEventStatus.done,
    });
  }

  if (isSystemMessage) {
    Object.assign(myMessage, {
      text: messageContent,
    });
  }

  return myMessage;
};

export const getMessageText = (message: IMessage) => {
  const { messageList } = message;

  if (message.text) {
    return message.text;
  }

  let text = '';
  (messageList || []).forEach((item) => {
    const { contentType } = item;
    if (`${contentType}` === `${SSEMessageType.text}`) {
      text += get(item, 'content.substance') || '';
    }
  });

  return text;
};

export const checkQueryMessageCanMemory = (queryMessage: IMessage) => {
  if (queryMessage && !queryMessage.fromBeyond) {
    const { resourceList, metadata } = queryMessage;
    if (resourceList) {
      const resources = (resourceList || []).filter((item) => item.resourceType === ResourceTypeMap.digitalEmployee);
      // 只有一个数字员工才能记忆固化
      if (size(resources) === 1) {
        return true;
      }
    }

    let metadataObj: Record<string, string> = {};

    try {
      metadataObj = JSON.parse(metadata || '{}');
    } catch (error) {
      console.error(error);
    }

    // 只有一个数字员工才能记忆固化
    return size(compact(`${metadataObj?.agentId || ''}`.split(','))) === 1;
  }

  return false;
};

export const checkAnswerMessageCanMemory = (answerMessage: IMessage) => {
  if (answerMessage && answerMessage.fromBeyond) {
    const { metadata } = answerMessage;
    let metadataObj: Record<string, string> = {};
    try {
      metadataObj = JSON.parse(metadata || '{}');
    } catch (error) {
      console.error(error);
    }

    // 只有一个数字员工才能记忆固化
    return size(compact(`${metadataObj?.agentId || ''}`.split(','))) === 1;
  }

  return false;
};
