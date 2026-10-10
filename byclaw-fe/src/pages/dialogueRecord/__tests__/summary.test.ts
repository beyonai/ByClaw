import { resolveSessionSummary } from '../summary';

const EMPTY = '暂无会话摘要';

describe('resolveSessionSummary', () => {
  it('prefers sessionContent over first message content', () => {
    const result = resolveSessionSummary(
      { sessionContent: '会话总结', messageDtoList: [{ messageContent: '首条消息' }], sessionName: '标题' },
      EMPTY
    );
    expect(result).toEqual({ content: '会话总结', empty: false });
  });

  it('falls back to first message content when sessionContent is missing', () => {
    const result = resolveSessionSummary({ messageDtoList: [{ messageContent: '首条消息' }] }, EMPTY);
    expect(result).toEqual({ content: '首条消息', empty: false });
  });

  it('falls back when sessionContent only contains thinking content', () => {
    const result = resolveSessionSummary(
      { sessionContent: '任务规划\n企业资料\n已思考结束', messageDtoList: [{ messageContent: '真实正文' }] },
      EMPTY
    );
    expect(result).toEqual({ content: '真实正文', empty: false });
  });

  it('filters thinking labels before showing text', () => {
    const result = resolveSessionSummary({ sessionContent: '任务规划\n联网检索\n**答案**：42' }, EMPTY);
    expect(result).toEqual({ content: '答案：42', empty: false });
  });

  it('returns placeholder and never falls back to sessionName or messageStruct', () => {
    const result = resolveSessionSummary(
      {
        sessionName: '会话标题',
        messageStruct: 'should be ignored',
        sessionContent: '深度思考中...',
        messageDtoList: [{ messageContent: '任务规划\n任务结束' }],
      },
      EMPTY
    );
    expect(result).toEqual({ content: EMPTY, empty: true });
  });

  it('returns placeholder for empty item', () => {
    expect(resolveSessionSummary({}, EMPTY)).toEqual({ content: EMPTY, empty: true });
    expect(resolveSessionSummary(undefined, EMPTY)).toEqual({ content: EMPTY, empty: true });
  });
});
