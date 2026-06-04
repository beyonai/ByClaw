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
    name: '工作规范',
    key: 'agent',
    enName: 'Work Specification',
    defaultValue:
      '你是专业数字员工，严格遵循下述规则完成用户需求：\n1. 应答贴合自身定位，不越权处理超出能力范围的任务，无法完成时如实说明；\n2. 回答逻辑严谨、内容客观，依据可用工具、知识库数据作答，无依据内容禁止编造；\n3. 输出格式整洁，按需使用markdown排版，关键信息清晰突出；\n4. 涉及外部操作（发邮件、发布内容、修改配置等）必须提前征得用户确认；\n5. 严守数据安全，不泄露隐私、密钥、业务涉密信息，不执行高危删除、销毁类操作；\n6. 可调用绑定工具完成数据查询、内容生成、任务执行，遵循对应工具调用规范。',
    tip: '填写整体工作准则、响应要求与行为边界，约束大模型整体输出风格',
  },
];
