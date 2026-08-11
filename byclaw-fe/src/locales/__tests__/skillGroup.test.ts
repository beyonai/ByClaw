import enUS from '../en-US';
import zhCN from '../zh-CN';

const skillGroupLocaleIds = [
  'resource.skillGroup.fallbackCover',
  'resource.skillGroup.memberCount',
  'resource.category',
  'resource.description',
  'resource.memberSkills',
  'resource.installSkillGroup',
  'resource.installSkillGroupSuccess',
  'resource.skillGroup.editTitle',
  'resource.skillGroup.updateSuccess',
  'resource.skillGroup.edit',
  'resource.skillGroup.uploadPersonalSkill',
  'resource.skillGroup.uploadRefreshFailed',
] as const;

describe('skill group locale messages', () => {
  it.each(skillGroupLocaleIds)('defines %s in both locale files', (id) => {
    expect(enUS[id]).toBeTruthy();
    expect(zhCN[id]).toBeTruthy();
  });

  it('uses the group-specific label for member skills in Chinese', () => {
    expect(zhCN['resource.memberSkills']).toBe('组内技能');
  });

  it('uses the expected personal skill upload messages in Chinese', () => {
    expect(zhCN['resource.skillGroup.uploadPersonalSkill']).toBe('上传个人技能');
    expect(zhCN['resource.skillGroup.uploadRefreshFailed']).toBe('技能上传成功，但技能列表刷新失败，请重试');
  });
});
