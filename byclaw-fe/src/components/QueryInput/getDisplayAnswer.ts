import { IMessageListItem } from '@/typescript/message';
import { SSEMessageType } from '@/constants/message';
import { get } from 'lodash';

export default function getDisplayAnswer(messageList?: IMessageListItem[]) {
  if (!messageList || !messageList.length) return '';

  let text = '';
  messageList.forEach((item) => {
    if (item.contentType === SSEMessageType.text) {
      text += `${get(item, 'content.substance') || ''}\n`;
    }
  });

  return text;
}
