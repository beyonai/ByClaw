import { SSEEventStatus, SSEMessageType } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import { getFinalAnswerProjection } from '../finalAnswer';

const item = (seq: number, substance: unknown, contentType = SSEMessageType.text): IMessageListItem => ({
  seq,
  contentType,
  content: { substance },
  status: SSEEventStatus.done,
  uuid: `item-${seq}`,
  orginContent: '',
});

const message = (messageList: IMessageListItem[], thinkList: IMessageListItem[] = []): IMessage =>
  ({ messageList, thinkList } as IMessage);

describe.each([
  ['legacy', false],
  ['ordered', true],
] as const)('final answer projection for %s messages', (_name, ordered) => {
  it.each([1, 2])('hides the last matching answer before %s trailing cards without hiding the cards', (count) => {
    const answer = item(1, '最终答复');
    const cards = Array.from({ length: count }, (_, index) =>
      item(index + 2, { type: 'file_changes', files: [] }, SSEMessageType.fileChanges)
    );

    const projection = getFinalAnswerProjection(message([answer, ...cards]), '最终答复', ordered);

    expect([...projection.hiddenAnswerItems]).toEqual([answer]);
    expect([...projection.hiddenAnswerItems][0]).toBe(answer);
    cards.forEach((card) => expect(projection.hiddenAnswerItems.has(card)).toBe(false));
    expect(projection.afterFinalItems).toEqual(cards);
  });

  it('deduplicates adjacent answer fragments before a trailing card', () => {
    const first = item(1, '最终');
    const last = item(2, '答复');
    const card = item(3, { type: 'file_changes' }, SSEMessageType.fileChanges);

    const projection = getFinalAnswerProjection(message([first, last, card]), '最终答复', ordered);

    expect(projection.hiddenAnswerItems.size).toBe(2);
    expect(projection.hiddenAnswerItems.has(first)).toBe(true);
    expect(projection.hiddenAnswerItems.has(last)).toBe(true);
    expect(projection.hiddenAnswerItems.has(card)).toBe(false);
  });

  it('does not concatenate fragments across an internal card', () => {
    const items = [
      item(1, '最终'),
      item(2, { type: 'file_changes' }, SSEMessageType.fileChanges),
      item(3, '答复'),
      item(4, { type: 'file_changes' }, SSEMessageType.fileChanges),
    ];

    expect(getFinalAnswerProjection(message(items), '最终答复', ordered).hiddenAnswerItems.size).toBe(0);
  });

  it('preserves an earlier matching answer when the last answer differs', () => {
    const earlier = item(1, '最终答复');
    const items = [earlier, item(2, '后续不同答复'), item(3, {}, SSEMessageType.fileChanges)];

    expect(getFinalAnswerProjection(message(items), '最终答复', ordered).hiddenAnswerItems.size).toBe(0);
  });

  it('treats malformed text as a boundary rather than skipping it as a card', () => {
    const items = [item(1, '最终答复'), item(2, { text: '结构化内容' }), item(3, {}, SSEMessageType.fileChanges)];

    expect(getFinalAnswerProjection(message(items), '最终答复', ordered).hiddenAnswerItems.size).toBe(0);
  });

  it('keeps file cards in the process when there is no final body or later text follows them', () => {
    const card = item(1, {}, SSEMessageType.fileChanges);
    expect(getFinalAnswerProjection(message([card]), undefined, ordered).afterFinalItems).toEqual([]);
    expect(getFinalAnswerProjection(message([card, item(2, '最终答复')]), '最终答复', ordered).afterFinalItems).toEqual(
      []
    );
  });
});

describe('ordered final answer boundaries', () => {
  it('only places chronologically trailing file cards after the final body', () => {
    const firstCard = item(2, {}, SSEMessageType.fileChanges);
    const lastCard = item(4, {}, SSEMessageType.fileChanges);
    const answers = [lastCard, item(1, '最终答复'), firstCard];
    const thinking = [item(3, '继续分析', SSEMessageType.thinkText)];
    const projection = getFinalAnswerProjection(message(answers, thinking), '最终答复', true);

    expect(projection.afterFinalItems).toEqual([lastCard]);
    expect(answers.map((entry) => entry.seq)).toEqual([4, 1, 2]);
  });

  it('does not join answer fragments separated by thinking', () => {
    const answers = [item(1, '最终'), item(3, '答复'), item(4, {}, SSEMessageType.fileChanges)];
    const thinking = [item(2, '继续分析', SSEMessageType.thinkText)];

    expect(getFinalAnswerProjection(message(answers, thinking), '最终答复', true).hiddenAnswerItems.size).toBe(0);
  });

  it('deduplicates the last answer even when thinking follows it before the trailing card', () => {
    const answer = item(1, '最终答复');
    const card = item(3, {}, SSEMessageType.fileChanges);
    const thinking = item(2, '收尾思考', SSEMessageType.thinkText);

    const projection = getFinalAnswerProjection(message([answer, card], [thinking]), '最终答复', true);

    expect([...projection.hiddenAnswerItems]).toEqual([answer]);
    expect(projection.hiddenAnswerItems.has(card)).toBe(false);
    expect(projection.hiddenAnswerItems.has(thinking)).toBe(false);
  });

  it('sorts chronologically while preserving the original array, item references and content', () => {
    const earlier = item(1, '过程答复');
    const answer = item(2, '最终答复');
    const card = item(3, {}, SSEMessageType.fileChanges);
    const items = [card, answer, earlier];
    items.forEach((entry) => {
      Object.freeze(entry.content);
      Object.freeze(entry);
    });
    Object.freeze(items);
    const msg = message(items);

    const projection = getFinalAnswerProjection(msg, '最终答复', true);

    expect([...projection.hiddenAnswerItems][0]).toBe(answer);
    expect(msg.messageList).toBe(items);
    expect(items.map((entry) => entry.seq)).toEqual([3, 2, 1]);
    expect(items[0]).toBe(card);
    expect(items[1]).toBe(answer);
    expect(items[2]).toBe(earlier);
    expect(answer.content.substance).toBe('最终答复');
  });
});
