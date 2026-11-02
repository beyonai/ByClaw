import { getIntl } from '@umijs/max';
import { localizeDefaultTemplateTip } from './digitalResource';
import { getLocaleIntl } from '@/testUtils/localeIntl';

jest.mock('@umijs/max', () => ({
  getIntl: jest.fn(() => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl('zh-CN')),
}));

it('translates built-in tips at call time while preserving custom guidance', () => {
  const tip = '填写数字员工组的任务拆分、成员调度、结果汇总和安全边界';
  expect(localizeDefaultTemplateTip(tip)).toBe(tip);
  (getIntl as jest.Mock).mockReturnValue(getLocaleIntl('en-US'));
  expect(localizeDefaultTemplateTip(tip)).toBe(
    'Define task breakdown, member coordination, result synthesis, and safety boundaries for the employee group.'
  );
  expect(localizeDefaultTemplateTip('用户自定义说明')).toBe('用户自定义说明');
});
