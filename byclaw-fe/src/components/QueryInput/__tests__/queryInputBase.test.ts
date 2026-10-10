import { agentTypeMap } from '@/constants/agent';
import type { IAgentCache } from '@/typescript/agent';
import type { Resource } from '../RichInput/types';
import { ResourceType } from '../RichInput/utils/constants';
import { getLastMentionedDigitalEmployeeId, isEmployeeGroupChat } from '../utils/mention';

describe('employee group chat resource visibility', () => {
  const employee = {
    id: 'employee-record',
    agentId: 'employee-agent',
    resourceId: 'employee-resource',
    resourceCode: 'employee-code',
    agentType: agentTypeMap.openclaw,
  } as IAgentCache;
  const group = {
    id: 'group-record',
    agentId: 'group-agent',
    resourceId: 'group-resource',
    resourceCode: 'group-code',
    agentType: agentTypeMap.employeeGroup,
  } as IAgentCache;
  const mention = (agent: IAgentCache): Resource => ({
    id: `DIG_EMPLOYEE_${agent.resourceId}`,
    resourceType: ResourceType.digitalEmployee,
    resourceId: agent.resourceId,
    resourceName: agent.resourceId,
    agentType: agent.agentType,
  });
  const context = { resourceList: [], employeesList: [employee, group] };

  it.each(['group-agent', 'group-record', 'group-resource', 'group-code'])(
    'recognizes group detail/session identity %s',
    (agentId) => {
      expect(isEmployeeGroupChat({ ...context, agentId })).toBe(true);
    }
  );

  it('recognizes the detail route type before employee lists have loaded', () => {
    expect(
      isEmployeeGroupChat({ resourceList: [], agentId: 'group-resource', agentType: agentTypeMap.employeeGroup })
    ).toBe(true);
  });

  it('uses matching global detail metadata without a cached employee', () => {
    expect(isEmployeeGroupChat({ resourceList: [], agentId: group.resourceId, agentInfo: group })).toBe(true);
  });

  it('prefers a mentioned group over an ordinary session and default employee without a loaded list', () => {
    expect(
      isEmployeeGroupChat({
        resourceList: [mention(group)],
        agentId: employee.agentId,
        agentType: employee.agentType,
        agentInfo: employee,
        defaultDigEmployeeId: employee.resourceId,
      })
    ).toBe(true);
  });

  it('keeps resources for a mentioned employee even when the session and default are groups', () => {
    expect(
      isEmployeeGroupChat({
        ...context,
        resourceList: [mention(employee)],
        agentId: group.agentId,
        agentType: group.agentType,
        agentInfo: group,
        defaultDigEmployeeId: group.resourceId,
      })
    ).toBe(false);
  });

  it('resolves legacy mention nodes without an embedded agent type', () => {
    expect(isEmployeeGroupChat({ ...context, resourceList: [{ ...mention(group), agentType: undefined }] })).toBe(true);
  });

  it('ignores a group node deactivated after switching to an employee', () => {
    expect(
      isEmployeeGroupChat({
        ...context,
        resourceList: [{ ...mention(group), isInactiveAgentSelection: true }, mention(employee)],
      })
    ).toBe(false);
  });

  it('ignores an employee node deactivated after switching to a group', () => {
    expect(
      isEmployeeGroupChat({
        ...context,
        resourceList: [{ ...mention(employee), isInactiveAgentSelection: true }, mention(group)],
      })
    ).toBe(true);
  });

  it.each([employee.agentId, employee.resourceId])('keeps resources for employee detail/session %s', (agentId) => {
    expect(isEmployeeGroupChat({ ...context, agentId, defaultDigEmployeeId: group.resourceId })).toBe(false);
  });

  it('hides resources for a default group when there is no mention or session employee', () => {
    expect(isEmployeeGroupChat({ ...context, defaultDigEmployeeId: group.resourceId })).toBe(true);
  });

  it('keeps resources for a default employee despite a stale group type', () => {
    expect(
      isEmployeeGroupChat({ ...context, defaultDigEmployeeId: employee.resourceId, agentType: group.agentType })
    ).toBe(false);
  });

  it('does not classify an unknown mention using the previous group session', () => {
    expect(
      isEmployeeGroupChat({
        ...context,
        agentId: group.agentId,
        resourceList: [{ ...mention(employee), resourceId: 'unknown-employee', agentType: undefined }],
      })
    ).toBe(false);
  });

  it('keeps resources without a known chat object and ignores non-employee references', () => {
    expect(isEmployeeGroupChat({ resourceList: [] })).toBe(false);
    expect(
      isEmployeeGroupChat({
        ...context,
        resourceList: [{ ...mention(group), resourceType: ResourceType.SKILL }],
        defaultDigEmployeeId: employee.resourceId,
      })
    ).toBe(false);
  });
});

describe('getLastMentionedDigitalEmployeeId', () => {
  it('uses the last mentioned digital employee for the sider linkage', () => {
    expect(
      getLastMentionedDigitalEmployeeId([
        {
          id: 'DIG_EMPLOYEE_agent-1',
          resourceType: ResourceType.digitalEmployee,
          resourceId: 'agent-1',
          resourceName: 'Employee One',
        },
        {
          id: 'SKILL_skill-1',
          resourceType: ResourceType.SKILL,
          resourceId: 'skill-1',
          resourceName: 'Skill One',
        },
        {
          id: 'DIG_EMPLOYEE_agent-2',
          resourceType: ResourceType.digitalEmployee,
          resourceId: 'agent-2',
          resourceName: 'Employee Two',
        },
      ])
    ).toBe('agent-2');
  });
});
