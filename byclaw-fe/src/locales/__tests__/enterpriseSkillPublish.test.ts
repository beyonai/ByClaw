import zhCN from '../zh-CN';
import enUS from '../en-US';

describe('enterprise skill publication translations', () => {
  it.each([
    'publishToEnterprise',
    'publishToEnterpriseConfirm',
    'publishToEnterpriseSuccess',
    'enterpriseSkillExists',
    'viewEnterpriseSkill',
    'publishToEnterpriseFailed',
  ])('provides Chinese and English text for %s', (key) => {
    expect((zhCN as Record<string, string>)[`resource.${key}`]).toBeTruthy();
    expect((enUS as Record<string, string>)[`resource.${key}`]).toBeTruthy();
  });
});
