import { SSEMessageType } from '@/constants/message';
import type { IMessageListItem } from '@/typescript/message';
import getDisplayAnswer from '../getDisplayAnswer';

const messageList = [{ contentType: SSEMessageType.text, content: { substance: '过程答复' } }] as IMessageListItem[];

describe('getDisplayAnswer', () => {
  it('copies a final-only answer', () => {
    expect(getDisplayAnswer([], '**最终答复**')).toBe('**最终答复**');
  });

  it('prefers the final body to earlier process text', () => {
    expect(getDisplayAnswer(messageList, '**最终答复**')).toBe('**最终答复**');
  });

  it('preserves existing copy formatting without a valid final body', () => {
    expect(getDisplayAnswer(messageList)).toBe('过程答复\n');
    expect(getDisplayAnswer(messageList, '  ')).toBe('过程答复\n');
  });
});
