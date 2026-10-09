import enUS from '@/locales/en-US';
import zhCN from '@/locales/zh-CN';
import { stripThinkingContent, THINKING_LABELS_EN, THINKING_LABELS_ZH } from '../sessionSummary';

const LABEL_KEYS = [
  'thinkTitle.taskPlan',
  'thinkTitle.companyData',
  'thinkTitle.networkSearch',
  'thinkTitle.optimizeData',
  'thinkTitle.digitalEmployee',
  'thinkTitle.taskEnd',
  'thinkingProcess.done',
  'thinkingProcess.thinking',
];

describe('stripThinkingContent', () => {
  it('keeps label constants in sync with locales', () => {
    expect(THINKING_LABELS_ZH).toEqual(LABEL_KEYS.map((key) => (zhCN as Record<string, string>)[key]));
    expect(THINKING_LABELS_EN).toEqual(LABEL_KEYS.map((key) => (enUS as Record<string, string>)[key]));
  });

  it('returns empty string for non-string or blank input', () => {
    expect(stripThinkingContent(undefined)).toBe('');
    expect(stripThinkingContent(null)).toBe('');
    expect(stripThinkingContent(123)).toBe('');
    expect(stripThinkingContent('   ')).toBe('');
  });

  it('removes label-only lines and keeps the answer', () => {
    const input = ['任务规划', '企业资料', '联网检索', '已思考结束', '这是最终的回答正文。'].join('\n');
    expect(stripThinkingContent(input)).toBe('这是最终的回答正文。');
  });

  it('removes labels wrapped by markdown markers', () => {
    const input = ['### 任务规划', '- **企业资料**', '> 深度思考中...', '正文'].join('\n');
    expect(stripThinkingContent(input)).toBe('正文');
  });

  it('returns empty string when only thinking labels remain', () => {
    expect(stripThinkingContent('任务规划\n企业资料\n优化资料\n数字员工\n任务结束')).toBe('');
    expect(stripThinkingContent('任务规划企业资料联网检索')).toBe('');
    expect(stripThinkingContent('Task Plan\nCompleted')).toBe('');
  });

  it('strips leading labels collapsed into one line', () => {
    expect(stripThinkingContent('任务规划 企业资料 已思考结束 查询结果如下')).toBe('查询结果如下');
  });

  it('does not touch label words inside normal text', () => {
    const input = '请根据企业资料完成任务规划，并说明联网检索的结果';
    expect(stripThinkingContent(input)).toBe(input);
    // 标签后紧跟正文（无分隔）不视为标签前缀
    expect(stripThinkingContent('任务规划需要三步')).toBe('任务规划需要三步');
  });

  it('removes <think> blocks including unclosed ones', () => {
    expect(stripThinkingContent('<think>内部推理</think>最终答案')).toBe('最终答案');
    expect(stripThinkingContent('答案前缀<think>未闭合的推理')).toBe('答案前缀');
  });
});
