jest.mock('@umijs/max', () => ({
  getIntl: jest.fn(() => ({
    formatMessage: ({ id }: { id: string }) => id,
  })),
}));

import { getDigitalEmployeeMentionItem, getResponseAgentInfoByMessage, getUsedModelFromMetadata } from './utils';

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
            resourceDesc: 'Creates product plans and code reviews',
          },
        ],
      }
    );

    expect(agentInfo).toMatchObject({
      agentId: '102',
      name: 'Agent B',
      chatAvatar: 'agent-b.png',
      resourceCode: 'agent-b',
      resourceDesc: 'Creates product plans and code reviews',
    });
  });
});

describe('getUsedModelFromMetadata', () => {
  it('reads the used model written by the backend', () => {
    expect(
      getUsedModelFromMetadata(
        JSON.stringify({
          usedModel: { id: '10004014', code: 'deepseek-v4-flash', name: 'lwt-deepseek-v4-flash', provider: 'DeepSeek' },
        })
      )
    ).toEqual({
      id: '10004014',
      code: 'deepseek-v4-flash',
      name: 'lwt-deepseek-v4-flash',
      provider: 'DeepSeek',
    });
  });

  it('falls back to the model code when no display name was recorded', () => {
    expect(getUsedModelFromMetadata(JSON.stringify({ usedModel: { code: 'qwen3.6-27b' } }))).toEqual({
      id: undefined,
      code: 'qwen3.6-27b',
      name: undefined,
      provider: undefined,
    });
  });

  it('returns null for missing, malformed or empty metadata', () => {
    expect(getUsedModelFromMetadata(undefined)).toBeNull();
    expect(getUsedModelFromMetadata('')).toBeNull();
    expect(getUsedModelFromMetadata('not-json')).toBeNull();
    expect(getUsedModelFromMetadata(JSON.stringify({ agentId: '1' }))).toBeNull();
    expect(getUsedModelFromMetadata(JSON.stringify({ usedModel: {} }))).toBeNull();
  });
});
