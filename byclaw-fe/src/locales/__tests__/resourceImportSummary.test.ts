import zhCN from '../zh-CN';
import enUS from '../en-US';

const summaryKey = 'resource.import.summary' as const;

// 导入结果汇总曾因 en-US 缺少该键而直接显示键名，此处锁定中英文文案与插值参数。
it('provides the import summary message in both locales', () => {
  expect(zhCN[summaryKey]).toBe('本次新增{createdCount}条、更新{updatedCount}条');
  expect(enUS[summaryKey]).toBe('Added {createdCount} and updated {updatedCount} items in this import.');
});

it('keeps import summary interpolation parameters aligned', () => {
  const parameters = (message: string) => (message.match(/\{\w+\}/g) || []).sort();
  expect(parameters(enUS[summaryKey])).toEqual(parameters(zhCN[summaryKey]));
});
