import { getSkillGroupMemberDiff } from '../editHelpers';
import { normalizeSkillOptions } from '../skillOptions';

describe('SkillGroupCreateModal edit helpers', () => {
  it('calculates added and removed members from the original selection', () => {
    expect(getSkillGroupMemberDiff(['skill-1', 'skill-2'], ['skill-2', 'skill-3'])).toEqual({
      addedSkillIds: ['skill-3'],
      removedSkillIds: ['skill-1'],
    });
  });
});

describe('SkillGroupCreateModal skill options', () => {
  it('only keeps system built-in skills without requiring resource permissions', () => {
    expect(
      normalizeSkillOptions([
        { resourceId: '1', resourceName: '内置技能', skillType: 'inner', hasUsePermission: false },
        { resourceId: '2', resourceName: '大写内置技能', skillType: 'INNER' },
        { resourceId: '3', resourceName: '上传技能', skillType: 'hub', hasUsePermission: true },
        { resourceId: '4', resourceName: '缺少技能类型', canManageAuth: true },
      ])
    ).toEqual([
      { resourceId: '1', resourceName: '内置技能' },
      { resourceId: '2', resourceName: '大写内置技能' },
    ]);
  });
});
