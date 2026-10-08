import enUS from '../en-US';
import zhCN from '../zh-CN';

describe('audit center employee type messages', () => {
  // 未审核与历史审核共用类型标签，两种语言均需提供文案，避免回退显示语言键。
  it.each([
    ['common.digitalEmployee', '数字员工', 'Employee'],
    ['common.digitalEmployeeGroup', '数字员工组', 'Employee Group'],
  ])('translates %s in both locales', (id, chinese, english) => {
    expect(zhCN[id as keyof typeof zhCN]).toBe(chinese);
    expect(enUS[id as keyof typeof enUS]).toBe(english);
  });
});
