import getDisplayAnswer from '@/components/QueryInput/getDisplayAnswer';
import getDisplayQuestion from '@/components/QueryInput/getDisplayQuestion';
import type { ConversationOutlineItem } from '@/service/message';
import type { IMessage } from '@/typescript/message';

export type ConversationTurn = {
  id: string;
  targetMessageId: string;
  messageIds: string[];
  question: string;
  answer: string;
  position: number;
  totalCount: number;
};

const SUMMARY_LENGTH = 160;

export const MINIMUM_CONVERSATION_TURNS_FOR_NAVIGATOR = 3;

const DIGITAL_EMPLOYEE_PLACEHOLDER = /\{\{DIG_EMPLOYEE_[^}#]+(?:#[^}]*)?}}/;

const extractObjectText = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractObjectText).filter(Boolean).join(' ');
  if (typeof value !== 'object') return `${value}`;

  const objectValue = value as Record<string, unknown>;
  return (
    extractObjectText(objectValue.text) ||
    extractObjectText(objectValue.substance) ||
    extractObjectText(objectValue.content)
  );
};

export const normalizeConversationSummary = (content?: string) => {
  let text = `${content || ''}`;
  try {
    text = extractObjectText(JSON.parse(text)) || text;
  } catch (error) {
    // Plain text and markdown are expected here as well.
  }

  text = text
    .replace(new RegExp(DIGITAL_EMPLOYEE_PLACEHOLDER.source, 'g'), '@数字员工 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[#>*+\-\d.\s]+/gm, '')
    .replace(/[`_*~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= SUMMARY_LENGTH) return text;
  return `${text.slice(0, SUMMARY_LENGTH)}...`;
};

const selectResolvedDisplayContent = (preferred?: string, fallback?: string) => {
  if (preferred && !DIGITAL_EMPLOYEE_PLACEHOLDER.test(preferred)) return preferred;
  if (fallback && !DIGITAL_EMPLOYEE_PLACEHOLDER.test(fallback)) return fallback;
  return preferred || fallback;
};

const getLocalDisplayContent = (message: IMessage) => {
  if (message.fromBeyond) {
    return getDisplayAnswer(message.messageList) || message.text;
  }
  return (
    selectResolvedDisplayContent(
      getDisplayQuestion({ text: message.text, resourceList: message.resourceList }),
      message.displayText
    ) || message.text
  );
};

export const createLocalOutlineItems = (messageList: IMessage[]): ConversationOutlineItem[] =>
  messageList
    .filter((message) => !message.isHide && !['3', '5'].includes(`${message.usage || ''}`))
    .map((message, index) => {
      return {
        messageId: `${message.messageId || message.msgId}`,
        usage: Number(message.usage || (message.fromBeyond ? 2 : 1)),
        content: message.text,
        displayContent: getLocalDisplayContent(message),
        creatorName: message.creatorName || message.agentName,
        createTime: message.createTime,
        position: index + 1,
        totalCount: messageList.length,
      };
    });

export const mergeOutlineItems = (
  remoteItems: ConversationOutlineItem[],
  localItems: ConversationOutlineItem[]
): ConversationOutlineItem[] => {
  const localMap = new Map(localItems.map((item) => [`${item.messageId}`, item]));
  const merged = remoteItems.map((item) => {
    const localItem = localMap.get(`${item.messageId}`);
    localMap.delete(`${item.messageId}`);
    if (!localItem) return item;
    return {
      ...item,
      displayContent: selectResolvedDisplayContent(
        localItem.displayContent || localItem.content,
        item.displayContent || item.content
      ),
      creatorName: localItem.creatorName || item.creatorName,
    };
  });
  return [...merged, ...localMap.values()];
};

export const buildConversationTurns = (items: ConversationOutlineItem[]): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];

  items.forEach((item) => {
    const messageId = `${item.messageId}`;
    const usage = `${item.usage}`;
    const content = normalizeConversationSummary(item.displayContent || item.content);
    if (['1', '4'].includes(usage)) {
      turns.push({
        id: messageId,
        targetMessageId: messageId,
        messageIds: [messageId],
        question: content,
        answer: '',
        position: Number(item.position),
        totalCount: Number(item.totalCount),
      });
      return;
    }

    if (usage !== '2') return;
    const currentTurn = turns[turns.length - 1];
    if (!currentTurn || !currentTurn.question) {
      turns.push({
        id: messageId,
        targetMessageId: messageId,
        messageIds: [messageId],
        question: '',
        answer: content,
        position: Number(item.position),
        totalCount: Number(item.totalCount),
      });
      return;
    }
    currentTurn.messageIds.push(messageId);
    currentTurn.answer = normalizeConversationSummary([currentTurn.answer, content].filter(Boolean).join(' '));
  });

  return turns;
};

export const shouldShowConversationNavigator = (turns: ConversationTurn[]) =>
  turns.length >= MINIMUM_CONVERSATION_TURNS_FOR_NAVIGATOR;
