import enUS from '../en-US';
import zhCN from '../zh-CN';

// 数字员工模块和资源安装弹窗复用相同翻译，归属标签使用完整数字员工称谓。
describe('digital employee type tag messages', () => {
  it.each([
    ['digitalEmployees.tag.personalEmployee', '个人数字员工', 'Personal Digital Employee'],
    ['digitalEmployees.tag.enterpriseEmployee', '企业数字员工', 'Enterprise Digital Employee'],
  ])('uses the full digital employee label for %s', (id, chinese, english) => {
    expect(zhCN[id as keyof typeof zhCN]).toBe(chinese);
    expect(enUS[id as keyof typeof enUS]).toBe(english);
  });
});
