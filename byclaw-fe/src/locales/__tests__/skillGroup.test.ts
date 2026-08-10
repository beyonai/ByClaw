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
] as const;

describe('skill group locale messages', () => {
  it.each(skillGroupLocaleIds)('defines %s in both locale files', (id) => {
    expect(enUS[id]).toBeTruthy();
    expect(zhCN[id]).toBeTruthy();
  });

  it('uses the group-specific label for member skills in Chinese', () => {
    expect(zhCN['resource.memberSkills']).toBe('组内技能');
  });
});
