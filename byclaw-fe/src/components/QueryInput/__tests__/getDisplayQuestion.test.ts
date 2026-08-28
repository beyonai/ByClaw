import getDisplayQuestion from '../getDisplayQuestion';
import type { RichInputResourceList } from '../RichInput';
import { ResourceType } from '../RichInput/utils/constants';

describe('getDisplayQuestion', () => {
  it('returns the original text when no resources are available', () => {
    expect(getDisplayQuestion({ text: 'hello {{DIG_EMPLOYEE_agent-1}}' })).toBe('hello {{DIG_EMPLOYEE_agent-1}}');
    expect(getDisplayQuestion({ text: '', resourceList: [] })).toBe('');
  });

  it('replaces a digital employee resource with its mention text', () => {
    const resourceList: RichInputResourceList = [
      {
        id: 'DIG_EMPLOYEE_agent-1',
        resourceId: 'agent-1',
        resourceName: '数字员工',
        resourceType: ResourceType.digitalEmployee,
      },
    ];

    expect(getDisplayQuestion({ text: '请找{{DIG_EMPLOYEE_agent-1}}', resourceList })).toBe('请找@数字员工 ');
  });

  it('replaces an agent skill reference with the employee and skill names', () => {
    const resourceList: RichInputResourceList = [
      {
        id: 'DIG_EMPLOYEE_agent-1',
        resourceId: 'agent-1',
        resourceName: '数字员工',
        resourceType: ResourceType.digitalEmployee,
      },
      {
        id: 'SKILL_skill-1',
        resourceId: 'skill-1',
        resourceName: '查询技能',
        resourceType: ResourceType.SKILL,
      },
    ];

    expect(getDisplayQuestion({ text: '使用{{DIG_EMPLOYEE_agent-1#SKILL_skill-1}}', resourceList })).toBe(
      '使用#数字员工#查询技能'
    );
  });

  it('keeps unknown resource placeholders unchanged', () => {
    const resourceList: RichInputResourceList = [
      {
        id: 'SKILL_skill-1',
        resourceId: 'skill-1',
        resourceName: '查询技能',
        resourceType: ResourceType.SKILL,
      },
    ];

    expect(getDisplayQuestion({ text: '{{SKILL_missing}} and {{SKILL_skill-1}}', resourceList })).toBe(
      '{{SKILL_missing}} and #查询技能'
    );
  });

  it('formats replaced resources as markdown when requested', () => {
    const resourceList: RichInputResourceList = [
      {
        id: 'SKILL_skill-1',
        resourceId: 'skill-1',
        resourceName: '查询技能',
        resourceType: ResourceType.SKILL,
      },
    ];

    expect(getDisplayQuestion({ text: '{{SKILL_skill-1}}', resourceList, isMarkdown: true })).toBe('[#查询技能]("")');
  });
});
