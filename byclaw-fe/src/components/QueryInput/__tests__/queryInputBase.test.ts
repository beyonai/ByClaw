import { ResourceType } from '../RichInput/utils/constants';
import { getLastMentionedDigitalEmployeeId } from '../utils/mention';

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
