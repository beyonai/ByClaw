// @ts-nocheck
import { getIntl } from '@umijs/max';

// 资源状态（列表）
export const resourceStatus = [
  {
    text: getIntl().formatMessage({ id: 'resourceStatus.draft' }),
    value: 0,
    color: '#A4AAB2',
  },
  {
    text: getIntl().formatMessage({ id: 'resourceStatus.reviewing' }),
    value: 1,
    color: '#F7BA1E',
  },
  {
    text: getIntl().formatMessage({ id: 'resourceStatus.published' }),
    value: 2,
    color: '#00B42A',
  },
  {
    text: getIntl().formatMessage({ id: 'resourceStatus.unpublished' }),
    value: 3,
    color: '#A4AAB2',
  },
  {
    text: getIntl().formatMessage({ id: 'resourceStatus.reviewing' }),
    value: 4,
    color: '#F7BA1E',
  },
  {
    text: getIntl().formatMessage({ id: 'resourceStatus.notPassed' }),
    value: 5,
    color: '#f53f3f',
  },
];

// 资源状态（查询）
export const queryStatus = [
  {
    text: getIntl().formatMessage({ id: 'digitalResourceMgr.status.all' }), // 全部
    value: -1,
  },
  {
    text: getIntl().formatMessage({ id: 'digitalResourceMgr.status.draft' }), // 草稿箱
    value: 0,
  },
  {
    text: getIntl().formatMessage({ id: 'resourceStatus.reviewing' }), // 审核中
    value: 4,
  },
  {
    text: getIntl().formatMessage({ id: 'resourceStatus.notPassed' }), // 审核不通过
    value: 5,
  },
  {
    text: getIntl().formatMessage({
      id: 'digitalResourceMgr.status.published', // 已上架
    }),
    value: 2,
  },
  {
    text: getIntl().formatMessage({
      id: 'digitalResourceMgr.status.unpublished', // 已下架
    }),
    value: 3,
  },
];

// 授权类型：使用授权 / 管理授权
export const grantTypeMap = {
  useAuth: 'FORCE_USE',
  mgrAuth: 'ALLOW_MANAGE',
};

export const resourceBizTypeMap = {
  PLUGIN: 'PLUGIN',
  DB: 'KG_DB',
  AGENT: 'AGENT',
  MCP: 'MCP',
  TOOL: 'TOOL',
  DIG_EMPLOYEE: 'DIG_EMPLOYEE',

  KG_DOC: 'KG_DOC',
  KG_DB: 'KG_DB',
  KG_QA: 'KG_QA',

  TOOLKIT: 'TOOLKIT',
};

// 类型：个人、企业、默认
export const ownerTypeMap = [
  {
    text: getIntl().formatMessage({ id: 'orgMgr.digital.ownerType.personal' }),
    value: 'personal',
  },
  {
    text: getIntl().formatMessage({ id: 'orgMgr.digital.ownerType.enterprise' }),
    value: 'enterprise',
  },
  {
    text: getIntl().formatMessage({ id: 'orgMgr.digital.ownerType.default' }),
    value: 'personal_default',
  },
];

// 默认数字员工模板
export const DEFAULT_DIGITAL_EMPLOYEE_TEMPLATES = [
  {
    name: '个人助理',
    key: 'BYCLAW_ASSISTANT',
    ownerType: 'personal',
    agentType: '001',
    relTools: ['*'],
    relSkills: ['dws'],
    skillPath: '',
    prompts: [
      { name: '工作规范', key: 'agent', enName: 'Work Specification', defaultValue: '' },
      { name: '人格定义', key: 'soul', enName: 'Personality Definition', defaultValue: '' },
      { name: '工具规范', key: 'tools', enName: 'Tool Specification', defaultValue: '' },
      { name: '记忆规范', key: 'memory', enName: 'Memory Specification', defaultValue: '' },
    ],
  },
  {
    name: '助手',
    key: 'BYCLAW_EXE',
    ownerType: 'enterprise',
    agentType: '001',
    relTools: ['*'],
    relSkills: [],
    skillPath: '',
    prompts: [
      { name: '工作规范', key: 'agent', enName: 'Work Specification', defaultValue: '' },
      { name: '人格定义', key: 'soul', enName: '', defaultValue: '' },
      { name: '工具规范', key: 'tools', enName: 'Tool Specification', defaultValue: '' },
      { name: '记忆规范', key: 'memory', enName: 'Memory Specification', defaultValue: '' },
    ],
  },
  {
    name: '问答',
    key: 'BYCLAW_QA',
    ownerType: 'enterprise',
    agentType: '006',
    relTools: [],
    relSkills: [],
    skillPath: '/.ByKC/{userCode}/agent_{resourceId}/skills',
    prompts: [
      {
        name: '问题分解',
        key: 'questionDecompose',
        enName: 'Question Decomposition',
        defaultValue:
          '将用户的自然语言问题拆解为一个或多个独立的子查询，并标注每个子查询的推理跳数（hop count），用于后续并行调度检索。',
      },
      {
        name: '单跳问题处理',
        key: 'singleHop',
        enName: 'Single Hop Processing',
        defaultValue: '指导单跳检索代理通过多轮检索收集充分证据，生成有据可查且无引用标记的自然语言回答。',
      },
      {
        name: '多跳问题信息检索',
        key: 'multiHopSearch',
        enName: 'Multi-hop Search',
        defaultValue:
          '指导多跳检索代理逐跳推理、逐跳检索，通过调用 next_hop 或 finalize 链接各步结论，最终完成链式问答。',
      },
      {
        name: '多跳问题回答',
        key: 'multiHopSummary',
        enName: 'Multi-hop Summary',
        defaultValue: '将多跳推理代理的逐跳结果（子问题、证据、结论）合成为一份结构完整、证据可追溯的最终报告。',
      },
      {
        name: '复合问题回答',
        key: 'subanswerAggregator',
        enName: 'Composite Answer Aggregation',
        defaultValue:
          '将多个子查询的回答整合为一份逻辑连贯、无引用标记的 Markdown 格式综合回答，直接回应用户的原始问题。',
      },
    ],
  },
  {
    name: '问数',
    key: 'BYCLAW_DATA',
    ownerType: 'enterprise',
    agentType: '005',
    relTools: [],
    relSkills: [],
    skillPath: '/.ByDC/{userCode}/agent_{resourceId}/skills',
    prompts: [
      {
        name: '工作规范',
        key: 'agent',
        enName: 'Work Specification',
        defaultValue: '请依据已有的工具进行数据查询、数据分析、数据操作。',
      },
    ],
  },
  {
    name: '调试',
    key: 'BYCLAW_DEBUG',
    ownerType: 'enterprise',
    agentType: '010',
    relTools: [],
    relSkills: [],
    skillPath: '',
    prompts: [{ name: '工作规范', key: 'agent', enName: 'Work Specification', defaultValue: '' }],
  },
  {
    name: '编码',
    key: 'BYCLAW_CODE',
    ownerType: 'enterprise',
    agentType: '011',
    relTools: [],
    relSkills: [],
    skillPath: '',
    prompts: [{ name: '工作规范', key: 'agent', enName: 'Work Specification', defaultValue: '' }],
  },
];
