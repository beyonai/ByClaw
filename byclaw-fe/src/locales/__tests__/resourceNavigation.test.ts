import zhCN from '../zh-CN';
import enUS from '../en-US';

describe('resource navigation translations', () => {
  // 浏览页使用“我的”，管理入口使用“管理”，四个模块保持相同的命名规则。
  it.each([
    ['resource.mySkills', '我的技能', 'My skills'],
    ['resource.myKnowledge', '我的知识', 'My knowledge'],
    ['resource.myTools', '我的工具', 'My tools'],
    ['resource.available', '我的资源', 'My resources'],
    ['resource.official', '企业推荐', 'Enterprise recommendations'],
    ['resource.skillMarketplace', '官方推荐', 'Official recommendations'],
    ['resource.marketplaceFullscreen', '全屏查看官方推荐', 'View official recommendations in fullscreen'],
    [
      'resource.skillMarketplaceUrlMissing',
      '官方推荐地址未配置或格式错误',
      'The official recommendations URL is missing or invalid',
    ],
    ['resourceCenter.mySkills', '管理技能', 'Manage skills'],
    ['resourceCenter.myKnowledge', '管理知识', 'Manage knowledge'],
    ['resourceCenter.myTools', '管理工具', 'Manage tools'],
    ['resourceCenter.myResources', '管理技能、知识、工具', 'Manage skills, knowledge and tools'],
    ['resourceCenter.myInstalled', '管理技能、知识、工具', 'Manage skills, knowledge and tools'],
    ['digitalEmployees.available', '我的员工', 'My employees'],
    ['digitalEmployees.official', '企业推荐', 'Enterprise recommendations'],
    ['digitalEmployees.myEmployees', '管理员工', 'Manage employees'],
    ['myEmployees.personal', '个人员工', 'Personal employees'],
    ['myEmployees.enterprise', '企业员工', 'Enterprise employees'],
    ['resourceCenter.personalSkills', '个人技能', 'Personal skills'],
    ['resourceCenter.enterpriseSkills', '企业技能', 'Enterprise skills'],
    ['resourceCenter.personalKnowledge', '个人知识', 'Personal knowledge'],
    ['resourceCenter.enterpriseKnowledge', '企业知识', 'Enterprise knowledge'],
    ['resourceCenter.personalTools', '个人工具', 'Personal tools'],
    ['resourceCenter.enterpriseTools', '企业工具', 'Enterprise tools'],
  ])('localizes navigation label %s', (key, chinese, english) => {
    expect(zhCN[key as keyof typeof zhCN]).toBe(chinese);
    expect(enUS[key as keyof typeof enUS]).toBe(english);
  });

  it('points the skill import review hint to the renamed navigation entries', () => {
    expect(zhCN['resource.import.skillReviewHint']).toContain('企业推荐');
    expect(zhCN['resource.import.skillReviewHint']).toContain('管理技能 → 企业技能');
    expect(enUS['resource.import.skillReviewHint']).toContain('Enterprise Recommendations');
    expect(enUS['resource.import.skillReviewHint']).toContain('Manage Skills → Enterprise Skills');
  });
});
