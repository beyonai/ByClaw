jest.mock('@umijs/max', () => ({
  getIntl: jest.fn(() => ({
    formatMessage: ({ id }: { id: string }) => id,
  })),
}));

import { getDigitalEmployeeMentionItem, getResponseAgentInfoByMessage } from './utils';

describe('MessageList utils', () => {
  it('builds a rich input mention item from response agent info', () => {
    expect(
      getDigitalEmployeeMentionItem({
        agentId: '102',
        name: 'Agent B',
        chatAvatar: 'avatar.png',
        resourceDesc: 'desc',
        resourceCode: 'agent-b',
        agentType: 'agent' as any,
        isSuperAssistant: false,
      })
    ).toMatchObject({
      agentId: '102',
      id: '102',
      resourceId: '102',
      resourceName: 'Agent B',
      name: 'Agent B',
      resourceCode: 'agent-b',
      chatAvatar: 'avatar.png',
      agentType: 'agent',
    });
  });

  it('prefers inline digital employee resources over stale metadata when resolving response agent info', () => {
    const agentInfo = getResponseAgentInfoByMessage(
      {
        agentList: [],
        employeesList: [
          {
            id: 'default-agent',
            agentId: 'default-agent',
            resourceCode: 'default-agent',
            name: '鲸智百应',
            chatAvatar: 'default.png',
            resourceDesc: '',
          },
          {
            id: '102',
            agentId: '102',
            resourceCode: 'agent-b',
            name: 'Agent B',
            chatAvatar: 'agent-b.png',
            resourceDesc: '',
          },
        ],
      } as any,
      {
        metadata: JSON.stringify({ agentId: 'default-agent' }),
        resourceList: [
          {
            id: 'DIG_EMPLOYEE_102',
            resourceType: 'DIG_EMPLOYEE',
            resourceId: '102',
            resourceName: 'Agent B',
            resourceCode: 'agent-b',
          },
        ],
      }
    );

    expect(agentInfo).toMatchObject({
      agentId: '102',
      name: 'Agent B',
      chatAvatar: 'agent-b.png',
      resourceCode: 'agent-b',
    });
  });
});
