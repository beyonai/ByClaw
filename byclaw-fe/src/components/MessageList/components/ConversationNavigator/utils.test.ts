import type { ConversationOutlineItem } from '@/service/message';
import type { IMessage } from '@/typescript/message';
import { ResourceType } from '@/components/QueryInput/RichInput/utils/constants';
import {
  buildConversationTurns,
  createLocalOutlineItems,
  mergeOutlineItems,
  normalizeConversationSummary,
  shouldShowConversationNavigator,
} from './utils';

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

    expect(merged[0]).toEqual(expect.objectContaining({ content: 'remote', displayContent: 'local', position: 8 }));
  });

  it('resolves a loaded message from its resource list', () => {
    const localItems = createLocalOutlineItems([
      {
        messageId: '1',
        msgId: '1',
        usage: '1',
        fromBeyond: false,
        text: '请找{{DIG_EMPLOYEE_11105921}}处理',
        resourceList: [
          {
            id: 'DIG_EMPLOYEE_11105921',
            resourceId: '11105921',
            resourceName: '覃小迪的代码生成助手',
            resourceType: ResourceType.digitalEmployee,
          },
        ],
      } as IMessage,
    ]);

    expect(localItems[0].displayContent).toBe('请找@覃小迪的代码生成助手 处理');
  });

  it('does not let an unresolved local placeholder replace a resolved server summary', () => {
    const remote = item('1', 1, '请找{{DIG_EMPLOYEE_11105921}}处理', 8);
    remote.displayContent = '请找@覃小迪的代码生成助手 处理';
    const local = item('1', 1, '请找{{DIG_EMPLOYEE_11105921}}处理', 1);
    local.displayContent = local.content;

    expect(mergeOutlineItems([remote], [local])[0].displayContent).toBe('请找@覃小迪的代码生成助手 处理');
  });

  it('normalizes JSON, HTML, and markdown before showing a tooltip', () => {
    expect(normalizeConversationSummary('{"text":"# Hello <b>world</b>"}')).toBe('Hello world');
  });

  it('uses display content instead of exposing a resource placeholder', () => {
    const outline = item('1', 1, '请找{{DIG_EMPLOYEE_11105921}}处理', 1);
    outline.displayContent = '请找@百应操作员 处理';

    expect(buildConversationTurns([outline])[0].question).toBe('请找@百应操作员 处理');
  });

  it('hides unresolved digital employee identifiers', () => {
    expect(normalizeConversationSummary('请找{{DIG_EMPLOYEE_11105921}}处理')).toBe('请找@数字员工 处理');
  });

  it('shows the navigator only when there are at least three conversation turns', () => {
    const turns = buildConversationTurns([
      item('1', 1, 'first', 1),
      item('2', 1, 'second', 2),
      item('3', 1, 'third', 3),
    ]);

    expect(shouldShowConversationNavigator(turns.slice(0, 2))).toBe(false);
    expect(shouldShowConversationNavigator(turns)).toBe(true);
  });
});
