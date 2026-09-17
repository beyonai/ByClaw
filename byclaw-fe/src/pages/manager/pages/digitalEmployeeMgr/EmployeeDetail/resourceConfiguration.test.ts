import { isSuperAssistant, preserveSuperAssistantResourceConfiguration } from './resourceConfiguration';

describe('super assistant resource configuration', () => {
  it.each(['personal', 'personal_default'])('recognizes the default assistant owned by %s', (ownerType) => {
    expect(isSuperAssistant({ ownerType, resourceCode: 'alice_main' })).toBe(true);
  });

  it.each([
    { ownerType: 'personal', resourceCode: 'alice_helper' },
    { ownerType: 'personal_default', resourceCode: 'another_default' },
    { ownerType: 'enterprise', resourceCode: 'enterprise_main' },
    { ownerType: 'personal', resourceCode: 'alice_main_copy' },
    { ownerType: 'personal' },
    null,
  ])('does not restrict an ordinary employee or missing details: %j', (employee) => {
    expect(isSuperAssistant(employee)).toBe(false);
  });

  it('keeps every original resource relation when saving other super assistant settings', () => {
    const detail = {
      ownerType: 'personal',
      resourceCode: 'alice_main',
      // 包含知识、工具、技能以及编辑页不再展示的本体资源 ID。
      relIds: ['101', '102', '103', '104'],
      relTools: ['*', 'browser'],
      skills: JSON.stringify([{ resourceId: '103', skillCode: 'search' }]),
      relSkills: [{ resourceId: '103', skillCode: 'search' }],
      employeeGroupMembers: [{ resourceId: '105', name: 'Researcher', teamRole: 'Research', sortOrder: 1 }],
    };
    const payload = {
      resourceName: 'Renamed assistant',
      corePersonaDefinition: 'Updated instructions',
      imageModelId: 'image-2',
      machineChannel: '[]',
      relIds: ['999'],
      relTools: [],
      skills: [],
      relSkills: [],
      employeeGroupMembers: [],
    };

    const saved = preserveSuperAssistantResourceConfiguration(payload, detail);

    expect(saved).toEqual({
      ...payload,
      relIds: detail.relIds,
      relTools: detail.relTools,
      skills: detail.skills,
      relSkills: detail.relSkills,
      employeeGroupMembers: detail.employeeGroupMembers,
    });
    expect(payload.relIds).toEqual(['999']);
    expect(detail.relIds).toEqual(['101', '102', '103', '104']);
  });

  it('does not add resources to a super assistant whose saved configuration is empty', () => {
    const saved = preserveSuperAssistantResourceConfiguration(
      { relIds: ['new-resource'], relTools: ['new-tool'], skills: ['new-skill'], relSkills: ['new-skill'] },
      {
        ownerType: 'personal_default',
        resourceCode: 'alice_main',
        relIds: [],
        relTools: [],
        skills: '[]',
        relSkills: [],
      }
    );

    expect(saved).toEqual({ relIds: [], relTools: [], skills: '[]', relSkills: [] });
  });

  it('keeps normal employees able to add and remove resources', () => {
    const payload = { relIds: ['new-resource'], relTools: [], skills: [], relSkills: [], employeeGroupMembers: [] };
    const detail = {
      ownerType: 'personal',
      resourceCode: 'alice_helper',
      relIds: ['old-resource'],
      employeeGroupMembers: [{ resourceId: 'old-member', teamRole: 'Research' }],
    };

    expect(preserveSuperAssistantResourceConfiguration(payload, detail)).toBe(payload);
  });
});
