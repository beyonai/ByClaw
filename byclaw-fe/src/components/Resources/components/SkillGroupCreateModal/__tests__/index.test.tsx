import { getSkillGroupMemberDiff } from '../editHelpers';
import {
  buildSkillGroupCandidateParams,
  getSkillOptionLabel,
  getSkillOptionsForTab,
  normalizeSkillOptions,
  partitionSkillOptions,
  SKILL_CANDIDATE_LIST_HEIGHT,
  SKILL_CANDIDATE_TABS_SIZE,
} from '../skillOptions';

describe('SkillGroupCreateModal edit helpers', () => {
  it('calculates added and removed members from the original selection', () => {
    expect(getSkillGroupMemberDiff(['skill-1', 'skill-2'], ['skill-2', 'skill-3'])).toEqual({
      addedSkillIds: ['skill-3'],
      removedSkillIds: ['skill-1'],
    });
  });
});

describe('SkillGroupCreateModal skill options', () => {
  it('uses small tabs in the candidate dropdown', () => {
    expect(SKILL_CANDIDATE_TABS_SIZE).toBe('small');
  });

  it('uses a fixed candidate list height', () => {
    expect(SKILL_CANDIDATE_LIST_HEIGHT).toBe(256);
  });

  it('keeps every candidate returned by the backend regardless of skill type or permissions', () => {
    expect(
      normalizeSkillOptions([
        { resourceId: '1', resourceName: '内置技能', systemBuiltIn: true, creatorOwned: false },
        { resourceId: '2', resourceName: '个人技能', systemBuiltIn: false, creatorOwned: true },
        { resourceId: '3', resourceName: '重叠技能', systemBuiltIn: true, creatorOwned: true },
        { resourceId: '4', resourceName: '旧版个人技能' },
      ])
    ).toEqual([
      { resourceId: '1', resourceName: '内置技能', systemBuiltIn: true, creatorOwned: false },
      { resourceId: '2', resourceName: '个人技能', systemBuiltIn: false, creatorOwned: true },
      { resourceId: '3', resourceName: '重叠技能', systemBuiltIn: true, creatorOwned: true },
      { resourceId: '4', resourceName: '旧版个人技能', systemBuiltIn: false, creatorOwned: true },
    ]);
  });

  it('classifies legacy candidates when backend booleans are absent', () => {
    const options = normalizeSkillOptions([
      {
        resourceId: '1',
        resourceName: '按技能类型识别的内置技能',
        skillType: ' INNER ',
      },
      {
        resourceId: '2',
        resourceName: '按来源识别的内置技能',
        skillType: 'hub',
        sourceType: ' system_builtin ',
      },
      { resourceId: '3', resourceName: '旧版个人技能', skillType: 'hub', sourceType: 'UPLOAD' },
    ]);

    expect(options).toEqual([
      {
        resourceId: '1',
        resourceName: '按技能类型识别的内置技能',
        systemBuiltIn: true,
        creatorOwned: false,
      },
      {
        resourceId: '2',
        resourceName: '按来源识别的内置技能',
        systemBuiltIn: true,
        creatorOwned: false,
      },
      { resourceId: '3', resourceName: '旧版个人技能', systemBuiltIn: false, creatorOwned: true },
    ]);
  });

  it('keeps explicit backend classification authoritative over legacy metadata', () => {
    expect(
      normalizeSkillOptions([
        {
          resourceId: '1',
          resourceName: '显式非内置',
          skillType: 'inner',
          sourceType: 'SYSTEM_BUILTIN',
          systemBuiltIn: false,
          creatorOwned: false,
        },
      ])
    ).toEqual([
      {
        resourceId: '1',
        resourceName: '显式非内置',
        systemBuiltIn: false,
        creatorOwned: false,
      },
    ]);
  });

  it('partitions candidates into overlapping built-in and personal lists', () => {
    const options = normalizeSkillOptions([
      { resourceId: '1', resourceName: '内置技能', systemBuiltIn: true, creatorOwned: false },
      { resourceId: '2', resourceName: '个人技能', systemBuiltIn: false, creatorOwned: true },
      { resourceId: '3', resourceName: '重叠技能', systemBuiltIn: true, creatorOwned: true },
      { resourceId: '4', resourceName: '未分类技能', systemBuiltIn: false, creatorOwned: false },
    ]);

    const { builtInSkills, personalSkills } = partitionSkillOptions(options);

    expect(builtInSkills.map((skill) => skill.resourceId)).toEqual(['1', '3']);
    expect(personalSkills.map((skill) => skill.resourceId)).toEqual(['2', '3']);
  });

  it('returns the visible options for the active dropdown tab', () => {
    const options = normalizeSkillOptions([
      { resourceId: '1', resourceName: '内置技能', systemBuiltIn: true, creatorOwned: false },
      { resourceId: '2', resourceName: '个人技能', systemBuiltIn: false, creatorOwned: true },
      { resourceId: '3', resourceName: '重叠技能', systemBuiltIn: true, creatorOwned: true },
    ]);

    expect(getSkillOptionsForTab(options, 'builtIn').map((skill) => skill.resourceId)).toEqual(['1', '3']);
    expect(getSkillOptionsForTab(options, 'personal').map((skill) => skill.resourceId)).toEqual(['2', '3']);
  });

  it('resolves selected labels from the complete candidate list across tabs', () => {
    const options = normalizeSkillOptions([
      { resourceId: '2', resourceName: '个人技能', systemBuiltIn: false, creatorOwned: true },
    ]);

    expect(getSkillOptionLabel(options, '2', '2')).toBe('个人技能');
    expect(getSkillOptionLabel(options, 'missing', '回退标签')).toBe('回退标签');
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
