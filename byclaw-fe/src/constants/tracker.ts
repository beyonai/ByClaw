export const trackerEventCodeMap = {
  agentRedirect: {
    eventCode: 'agent_redirect',
    eventName: '数字员工-跳转',
    pagePath: '/employees',
    pageTitle: '数字员工',
  },
};

export const trackerElementMap = {
  AtAgentRedirect: {
    ...trackerEventCodeMap.agentRedirect,
    // elementId: '',
    elementCode: 'at_agent_redirect',
    elementName: '数字员工@点击跳转',
  },
  marketAgentRedirect: {
    ...trackerEventCodeMap.agentRedirect,
    // elementId: '',
    elementCode: 'market_agent_redirect',
    elementName: '数字员工市场点击跳转',
  },
  siderAgentRedirect: {
    ...trackerEventCodeMap.agentRedirect,
    // elementId: '',
    elementCode: 'sider_agent_redirect',
    elementName: '侧边目录数字员工点击跳转',
  },
  headerEmployeeClick: {
    ...trackerEventCodeMap.agentRedirect,
    // elementId: '',
    elementCode: 'header_agent_redirect',
    elementName: '头部数字员工点击跳转',
  },
  sessionAgentRedirect: {
    ...trackerEventCodeMap.agentRedirect,
    // elementId: '',
    elementCode: 'session_agent_redirect',
    elementName: '会话数字员工点击跳转',
  },
  referenceAgentRedirect: {
    ...trackerEventCodeMap.agentRedirect,
    // elementId: '',
    elementCode: 'reference_agent_redirect',
    elementName: '引用数字员工点击跳转',
  },
  default: {
    eventCode: 'default',
    eventName: 'default',
    elementCode: 'default',
    elementName: 'default',
  },
};
