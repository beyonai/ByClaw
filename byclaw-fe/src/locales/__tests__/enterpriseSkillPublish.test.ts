import zhCN from '../zh-CN';
import enUS from '../en-US';

describe('enterprise skill publication translations', () => {
  it('uses enterprise wording for the publication entry and result messages in both languages', () => {
    expect(zhCN['resource.publishToEnterprise']).toBe('发布到企业');
    expect(enUS['resource.publishToEnterprise']).toBe('Publish to enterprise');
    const keys = [
      'resource.publishToEnterpriseSuccess',
      'resource.publishToEnterpriseFailed',
      'resource.skillPublicationPublishedDescription',
      'employeePublication.publishToEnterpriseConfirm',
      'employeePublication.publishedDescription',
      'employeePublication.approvedAndPublished',
    ];
    keys.forEach((key) => {
      expect((zhCN as Record<string, string>)[key]).toContain('发布到企业');
      expect((enUS as Record<string, string>)[key]).toMatch(/(?:to |to the )enterprise/i);
    });
  });

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
