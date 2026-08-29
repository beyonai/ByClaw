import type { ConversationOutlineItem } from '@/service/message';
import { buildConversationTurns, mergeOutlineItems, normalizeConversationSummary } from './utils';

const item = (messageId: string, usage: number, content: string, position: number): ConversationOutlineItem => ({
  messageId,
  usage,
  content,
  position,
  totalCount: 4,
});

describe('ConversationNavigator utils', () => {
  it('groups a question and its answer into one turn', () => {
    const turns = buildConversationTurns([item('1', 1, 'How does this work?', 4), item('2', 2, 'Like this.', 3)]);

    expect(turns).toEqual([
      expect.objectContaining({
        targetMessageId: '1',
        messageIds: ['1', '2'],
        question: 'How does this work?',
        answer: 'Like this.',
        position: 4,
      }),
    ]);
  });

  it('uses loaded message summaries without losing remote paging positions', () => {
    const merged = mergeOutlineItems([item('1', 1, 'remote', 8)], [item('1', 1, 'local', 1)]);

    expect(merged[0]).toEqual(expect.objectContaining({ content: 'local', position: 8 }));
  });

  it('normalizes JSON, HTML, and markdown before showing a tooltip', () => {
    expect(normalizeConversationSummary('{"text":"# Hello <b>world</b>"}')).toBe('Hello world');
  });
});
