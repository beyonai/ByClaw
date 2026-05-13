import { isEmpty, get, set } from 'lodash';
import { getIntl } from '@umijs/max';

import { IMessage } from '@/typescript/message';
import { ResourceTypeMap } from '@/constants/resource';
import { SSEMessageType } from '@/constants/message';
import { getMessageText } from '@/utils/messgae';

const getExportMessageInfo = (msg: IMessage, intl = getIntl()) => {
  let metadata: Record<string, any> = {};

  try {
    metadata = JSON.parse(msg?.metadata || '{}');
  } catch (error) {
    metadata = {};
  }

  const sender = ['1', '4'].includes(`${msg?.usage || ''}`)
    ? intl.formatMessage({ id: 'multiChoices.export.senderUser' })
    : intl.formatMessage({ id: 'multiChoices.export.senderAssistant' });
  const content = getMessageText(msg) || '';
  const resourceName = metadata?.resourceName || msg?.resourceList?.[0]?.resourceName || '';
  const resourceType = metadata?.resourceType || msg?.resourceList?.[0]?.resourceType || '';

  return {
    sender,
    content,
    resourceName,
    resourceType,
    messageId: msg?.messageId || msg?.msgId || '',
    sessionId: msg?.sessionId || '',
    createTime: new Date(msg?.createTime || Date.now()).toLocaleString(),
  };
};

export const referenceToOpenClawHandler = (messageList: IMessage[], multiChoicesMsgId: string[], fileName?: string) => {
  const participants: string[] = [];
  const selectedMessages = multiChoicesMsgId
    .map((msgId) => messageList.find((item) => item.msgId === msgId))
    .filter(Boolean);
  const intl = getIntl();

  let messageContent = '';
  selectedMessages.forEach((msg, index) => {
    if (msg) {
      const messageInfo = getExportMessageInfo(msg, intl);
      const responderNames = msg.fromBeyond
        ? (msg.resourceList || [])
          .filter((item) => item.resourceType === ResourceTypeMap.digitalEmployee)
          .map((item) => item.resourceName)
        : [];

      if (msg.fromBeyond) {
        participants.push(
          ...(isEmpty(responderNames) ? [intl.formatMessage({ id: 'messageList.defaultAIName' })] : responderNames)
        );
      } else {
        participants.push(msg?.creatorName || 'User');
      }

      messageContent += `# ${intl.formatMessage({ id: 'multiChoices.export.messageTitle' }, { index: index + 1 })}\n`;
      messageContent += `**${intl.formatMessage({ id: 'multiChoices.export.messageId' })}**: ${
        messageInfo.messageId
      }\n`;
      messageContent += `**${intl.formatMessage({ id: 'multiChoices.export.sessionId' })}**: ${
        messageInfo.sessionId
      }\n`;
      messageContent += `**${intl.formatMessage({ id: 'multiChoices.export.sender' })}**: ${messageInfo.sender}\n`;
      messageContent += `**${intl.formatMessage({ id: 'common.time' })}**: ${messageInfo.createTime}\n`;
      if (messageInfo.resourceName || messageInfo.resourceType) {
        messageContent += `**${intl.formatMessage({ id: 'multiChoices.export.resource' })}**: ${
          messageInfo.resourceName || '-'
        }${messageInfo.resourceType ? ` (${messageInfo.resourceType})` : ''}\n`;
      }
      messageContent += `**${intl.formatMessage({ id: 'multiChoices.export.content' })}**:\n${
        messageInfo.content || ''
      }\n\n`;
    }
  });

  const fileNameList = [...new Set(participants)];
  const defaultFileName = `${fileNameList.splice(0, 3).join('、')}${
    fileNameList.length > 0 ? `等${fileNameList.length}人` : ''
  }对话记录_${new Date().getTime()}.md`;
  const finalFileName = fileName || defaultFileName;

  const textFile = new File([messageContent], finalFileName, { type: 'text/markdown' });

  return textFile;
};

export const referenceToWisdomPenContentList = (messageList: IMessage[], multiChoicesMsgId: string[]) => {
  const outlineRetrieveList: any[] = [];
  const participants: string[] = [];

  messageList.forEach((message, idx, arr) => {
    const isInclude = multiChoicesMsgId.includes(message.msgId);
    if (!isInclude) return;

    const { fromBeyond, messageList = [], resourceList } = message;

    if (fromBeyond) {
      let Responder: string[] = [];
      (resourceList || []).forEach((item) => {
        if (item.resourceType === ResourceTypeMap.digitalEmployee) {
          Responder.push(item.resourceName);
        }
      });

      if (isEmpty(Responder)) {
        Responder = [getIntl().formatMessage({ id: 'messageList.defaultAIName' })];
      }
      participants.push(...Responder);

      let isCollected = false;
      messageList.forEach((messageListItem) => {
        const { contentType } = messageListItem;
        const outlineRetrieveListItem = { text: '' };

        const isChatBI = `${contentType}` === `${SSEMessageType.chartBI}`;
        const isWriterContentType = [
          `${SSEMessageType.ppt}`,
          `${SSEMessageType.article}`,
          `${SSEMessageType.outline}`,
        ].includes(`${contentType}`);
        const isAsr = `${contentType}` === `${SSEMessageType.asr}`;

        if (isChatBI) {
          const chatbi: any[] = [];
          set(outlineRetrieveListItem, 'chatbi', chatbi);

          const {
            queryQuestion = '',
            measureFieldList = [],
            componentList = [],
            dimFieldList = [],
            resultData = [],
          } = get(messageListItem, 'content.substance.0') || {};

          const chatbiItem = {
            question: queryQuestion,
            renderType: componentList,
            dimFieldList: dimFieldList?.map((i: any) => i.aliasFieldCode || i.fieldCode),
            measureFieldList: measureFieldList?.map((i: any) => i.aliasFieldCode || i.fieldCode),
            resultData,
          };

          chatbi.push(chatbiItem);
          outlineRetrieveList.push(outlineRetrieveListItem);
        }

        if (isWriterContentType) {
          try {
            set(outlineRetrieveListItem, 'text', JSON.stringify(get(messageListItem, 'content.substance')));
          } catch (e) {
            console.error(e);
          }
          outlineRetrieveList.push(outlineRetrieveListItem);
        }

        if (isAsr) {
          set(outlineRetrieveListItem, 'text', get(messageListItem, 'content.substance.minute'));
          outlineRetrieveList.push(outlineRetrieveListItem);
        }

        isCollected = isChatBI || isWriterContentType || isAsr;
      });

      const text = getMessageText(message);
      if (!isCollected) {
        const outlineRetrieveListItem = { text: '' };

        let myText = '';
        const prevMessage = get(arr, `${idx - 1}`);
        if (!prevMessage.fromBeyond) {
          myText += `Q：${get(prevMessage, 'text') || ''}\n`;
        }
        myText += `A：${text || ''}`;
        set(outlineRetrieveListItem, 'text', myText);
        outlineRetrieveList.push(outlineRetrieveListItem);
      }
    } else {
      participants.push(message?.creatorName || getIntl().formatMessage({ id: 'common.user' }));
    }
  });

  return {
    outlineRetrieveList,
    participants,
  };
};

export const referenceToWisdomPenHandler = (messageList: IMessage[], multiChoicesMsgId: string[]) => {
  const { outlineRetrieveList, participants } = referenceToWisdomPenContentList(messageList, multiChoicesMsgId);

  const messageContent = outlineRetrieveList
    .map((item) => {
      if (item.text) {
        return item.text;
      }

      if (item.chatbi) {
        try {
          return JSON.stringify(item.chatbi);
        } catch (error) {
          return '';
        }
      }

      return '';
    })
    .join('\n\n');

  const fileNameList = [...new Set(participants)];
  const fileName = `${fileNameList.splice(0, 3).join('、')}${
    fileNameList.length > 0 ? `等${fileNameList.length}人` : ''
  }对话记录_${new Date().getTime()}.md`;
  const textFile = new File([messageContent], fileName, { type: 'text/markdown' });

  return textFile;
};
