import { IMessageListItem } from '@/typescript/message';
import { SSEMessageType } from '@/constants/message';
import { get } from 'lodash';

function getSubstanceText(substance: unknown): string {
  if (substance === null || substance === undefined) return '';
  if (typeof substance === 'string') return substance;
  if (typeof substance === 'number' || typeof substance === 'boolean') return `${substance}`;

  if (Array.isArray(substance)) {
    return substance.map((item) => getSubstanceText(item)).join('');
  }

  if (typeof substance === 'object') {
    return (
      getSubstanceText(get(substance, 'text')) ||
      getSubstanceText(get(substance, 'substance')) ||
      getSubstanceText(get(substance, 'content'))
    );
  }

  return '';
}

export default function getDisplayAnswer(messageList?: IMessageListItem[]) {
  if (!messageList || !messageList.length) return '';

  let text = '';
  messageList.forEach((item) => {
    if (`${item.contentType}` === `${SSEMessageType.text}`) {
      text += `${getSubstanceText(get(item, 'content.substance'))}\n`;
    }
  });

  return text;
}
