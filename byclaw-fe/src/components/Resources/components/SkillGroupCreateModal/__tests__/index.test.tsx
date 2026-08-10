import { getSkillGroupMemberDiff } from '../editHelpers';
import { buildSkillGroupCandidateParams, normalizeSkillOptions } from '../skillOptions';

describe('SkillGroupCreateModal edit helpers', () => {
  it('calculates added and removed members from the original selection', () => {
    expect(getSkillGroupMemberDiff(['skill-1', 'skill-2'], ['skill-2', 'skill-3'])).toEqual({
      addedSkillIds: ['skill-3'],
      removedSkillIds: ['skill-1'],
    });
  });
});

describe('SkillGroupCreateModal skill options', () => {
  it('keeps every candidate returned by the backend regardless of skill type or permissions', () => {
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
      { resourceId: '3', resourceName: '上传技能' },
      { resourceId: '4', resourceName: '缺少技能类型' },
    ]);
  });

  it('builds create and edit candidate requests without exposing a creator id', () => {
    expect(buildSkillGroupCandidateParams()).toEqual({ keyword: '', pageNum: 1, pageSize: 100 });
    expect(buildSkillGroupCandidateParams('group-1')).toEqual({
      keyword: '',
      pageNum: 1,
      pageSize: 100,
      groupId: 'group-1',
    });
  });
});
