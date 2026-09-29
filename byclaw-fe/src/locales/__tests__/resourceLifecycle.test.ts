import zhCN from '../zh-CN';
import enUS from '../en-US';

// 数据和员工使用独立语言键，避免修改资源中心时覆盖员工菜单称谓。
it.each([
  ['shelfData', '上架数据', 'Publish data'],
  ['unShelfData', '下架数据', 'Unpublish data'],
  ['deleteData', '注销数据', 'Deregister data'],
])('localizes resource lifecycle action %s', (action, chinese, english) => {
  expect(zhCN[`resource.lifecycle.${action}` as keyof typeof zhCN]).toBe(chinese);
  expect(enUS[`resource.lifecycle.${action}` as keyof typeof enUS]).toBe(english);
});

// 浏览标签与管理状态独立，三个模块均提供中英文归属文案。
it.each([
  ['personalKnowledge', '个人知识', 'Personal knowledge'],
  ['enterpriseKnowledge', '企业知识', 'Enterprise knowledge'],
  ['personalSkill', '个人技能', 'Personal skill'],
  ['enterpriseSkill', '企业技能', 'Enterprise skill'],
  ['personalTool', '个人工具', 'Personal tool'],
  ['enterpriseTool', '企业工具', 'Enterprise tool'],
])('localizes resource ownership tag %s', (tag, chinese, english) => {
  expect(zhCN[`resource.tag.${tag}` as keyof typeof zhCN]).toBe(chinese);
  expect(enUS[`resource.tag.${tag}` as keyof typeof enUS]).toBe(english);
});
