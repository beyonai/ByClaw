import { SSEMessageType } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import { hydrateV2RuntimeState } from '@/utils/messageV2Runtime';

const item = (seq: number, contentType: SSEMessageType): IMessageListItem =>
  ({
    seq,
    contentType,
    eventType: contentType === SSEMessageType.thinkText ? 'reasoningLogDelta' : 'answerDelta',
    content: { substance: `${seq}` },
  } as IMessageListItem);

describe('messageV2Runtime', () => {
  it('hydrates the global cursor from the latest item across both channels', () => {
    const message = {
      thinkList: [item(1, SSEMessageType.thinkText), item(4, SSEMessageType.thinkText)],
      messageList: [item(2, SSEMessageType.text)],
    } as IMessage;

    hydrateV2RuntimeState(message);

    expect((message as any)._v2NextSeq).toBe(5);
    expect((message as any)._v2LastSegment.seq).toBe(4);
    expect((message as any)._v2LastChannel).toBe('thinkList');
  });

  it('starts at one when a restored message has no sequenced items', () => {
    const message = { thinkList: [], messageList: [] } as unknown as IMessage;

    hydrateV2RuntimeState(message);

    expect((message as any)._v2NextSeq).toBe(1);
    expect((message as any)._v2LastSegment).toBeUndefined();
    expect((message as any)._v2LastChannel).toBeUndefined();
  });
});
