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
] as const;

describe('skill group locale messages', () => {
  it.each(skillGroupLocaleIds)('defines %s in both locale files', (id) => {
    expect(enUS[id]).toBeTruthy();
    expect(zhCN[id]).toBeTruthy();
  });
});
