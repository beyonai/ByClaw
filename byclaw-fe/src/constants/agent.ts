export const agentTypeMap = {
  common: '0',
  agent: '001', // 助手型
  chatbi: '002',
  writer: '003',
  dighuman: '004',
  askAgent: '005', // 问数型
  qAndaAgent: '006', // 问答型
  dbAgent: '007',
  mcpAgent: '008',
  uiAgent: '009',
  botAgent: '010', // 调试型
  personalKnowledge: '011', // 编码型
  networkSearch: '012',
  openclaw: '013',
  searchAndQuery: '014',
  functionCloud: '015',
  dataCloud: '016',
} as const;

export const specialAgentType = [agentTypeMap.searchAndQuery, agentTypeMap.functionCloud];

export const agentMap: {
  [key in (typeof agentTypeMap)[keyof typeof agentTypeMap]]?: {
    avatar?: string;
    path: string;
    customPath?: string;
    chatAvatar?: string;
  };
} = {
  [agentTypeMap.common]: {
    avatar: 'beyond/logo256.svg',
    path: '/chat',
    chatAvatar: 'beyond/logo256.svg',
  },
  [agentTypeMap.agent]: {
    // avatar: 'beyond/logo.png',
    path: '/employees',
    // chatAvatar: 'beyond/logo.png'
  },
  [agentTypeMap.searchAndQuery]: {
    // avatar: 'beyond/logo256.svg',
    path: '/searchAndQuery',
    // chatAvatar: 'beyond/logo256.svg',
  },
  [agentTypeMap.functionCloud]: {
    // avatar: 'beyond/logo256.svg',
    path: '/functionCloud',
    // chatAvatar: 'beyond/logo256.svg',
  },
};

export const specialAgentCode = {
  uiagent: 'WHAGE_AGENT_AGENT_888888',
  searchAndQuery: 'SEARCH_QUERY',
  functionCloud: 'FUNCTION_CLOUD',
  dataCloud: 'DATA_CLOUD',
};

export const ownerTypeMap = {
  personalDefault: 'personal_default',
  personal: 'personal',
  enterprise: 'enterprise',
} as const;

export const ROOT_AGENT_ID = 'ROOT_AGENT_ID';
