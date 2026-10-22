import { ResourceTypeMap } from '@/constants/resource';
import { queryDigEmployeeRelResourceAuth } from '@/pages/manager/service/resources';
import {
  getEmployeeResourceReplacementTab,
  hasUnresolvedEmployeeResource,
  isEmployeeResourceAvailable,
} from '../employeeResourceCompatibility';

jest.mock('@/pages/manager/service/resources', () => ({
  queryDigEmployeeRelResourceAuth: jest.fn(),
  queryWorkspaceSkillList: jest.fn(),
}));

describe('employee resource compatibility', () => {
  it.each([
    [ResourceTypeMap.SKILL, 'skill'],
    [ResourceTypeMap.knowledgeBase, 'knowledge'],
    [ResourceTypeMap.MCP, 'tool'],
  ])('maps %s to the corresponding replacement picker', (resourceType, tab) => {
    expect(getEmployeeResourceReplacementTab(resourceType)).toBe(tab);
  });

  it('blocks sending while a resource is checking or requires replacement', () => {
    expect(hasUnresolvedEmployeeResource([{ isAgentResourceValidationPending: true }])).toBe(true);
    expect(hasUnresolvedEmployeeResource([{ requiresAgentResourceReplacement: true }])).toBe(true);
    expect(hasUnresolvedEmployeeResource([{}])).toBe(false);
  });

  it('matches a resource against the new employee bound resources', async () => {
    jest.mocked(queryDigEmployeeRelResourceAuth).mockResolvedValue({
      rows: [{ resourceId: 'tool-1', resourceBizType: ResourceTypeMap.MCP }],
    } as any);

    await expect(
      isEmployeeResourceAvailable('agent-2', {
        id: 'tool-1',
        name: 'Tool One',
        resourceType: ResourceTypeMap.MCP,
      })
    ).resolves.toBe(true);
    await expect(
      isEmployeeResourceAvailable('agent-2', {
        id: 'tool-2',
        name: 'Tool Two',
        resourceType: ResourceTypeMap.MCP,
      })
    ).resolves.toBe(false);
  });
});
