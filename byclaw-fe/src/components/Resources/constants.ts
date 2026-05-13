// 状态相关常量
export const STATUS_ALL_VALUE = ''; // 全部状态
export const STATUS_IN_STOCK_VALUE = '2'; // 有效状态
export const STATUS_CANCELLED_VALUE = '3'; // 已注销状态

// 归属相关常量
export const BELONG_ALL_VALUE = 'ALL'; // 全部归属
export const BELONG_COMPANY_VALUE = 'COMPANY'; // 公司归属
export const BELONG_DEPT_VALUE = 'DEPT'; // 部门归属

// 状态筛选选项
export const statusOptions = [
  {
    label: 'common.all',
    value: STATUS_ALL_VALUE,
  },
  {
    label: 'resource.statusActive',
    value: STATUS_IN_STOCK_VALUE,
  },
  {
    label: 'resource.statusCancelled',
    value: STATUS_CANCELLED_VALUE,
  },
];

// 归属筛选选项
export const belongOptions = [
  {
    label: 'common.all',
    value: BELONG_ALL_VALUE,
  },
  {
    label: 'resource.belongCompany',
    value: BELONG_COMPANY_VALUE,
  },
  {
    label: 'resource.belongDept',
    value: BELONG_DEPT_VALUE,
  },
];

// 资源业务类型相关常量
export const RESOURCE_BIZ_TYPE_ALL_VALUE = ''; // 全部类型
export const RESOURCE_BIZ_TYPE_MCP_VALUE = 'MCP'; // MCP类型
export const RESOURCE_BIZ_TYPE_TOOLKIT_VALUE = 'TOOLKIT'; // 工具类型
export const RESOURCE_BIZ_TYPE_AGENT_VALUE = 'AGENT'; // 智能体类型
export const RESOURCE_BIZ_TYPE_KG_DOC_VALUE = 'KG_DOC'; // 文档知识
export const RESOURCE_BIZ_TYPE_KG_TERM_VALUE = 'KG_TERM'; // 术语知识
export const RESOURCE_BIZ_TYPE_KG_QA_VALUE = 'KG_QA'; // 问答知识
export const ALL_RESOURCE_BIZ_TYPE_VALUES = [
  RESOURCE_BIZ_TYPE_MCP_VALUE,
  RESOURCE_BIZ_TYPE_TOOLKIT_VALUE,
  RESOURCE_BIZ_TYPE_AGENT_VALUE,
];
export const ALL_KNOWLEDGE_RESOURCE_BIZ_TYPE_VALUES = [
  RESOURCE_BIZ_TYPE_KG_DOC_VALUE,
  RESOURCE_BIZ_TYPE_KG_TERM_VALUE,
  RESOURCE_BIZ_TYPE_KG_QA_VALUE,
];

// 资源业务类型筛选选项
export const resourceBizTypeOptions = [
  {
    label: 'common.all',
    value: RESOURCE_BIZ_TYPE_ALL_VALUE,
  },
  {
    label: 'resource.agent',
    value: RESOURCE_BIZ_TYPE_AGENT_VALUE,
  },
  {
    label: 'resource.toolkit',
    value: RESOURCE_BIZ_TYPE_TOOLKIT_VALUE,
  },
  {
    label: 'resource.mcp',
    value: RESOURCE_BIZ_TYPE_MCP_VALUE,
  },
];

export const knowledgeResourceBizTypeOptions = [
  {
    label: 'common.all',
    value: RESOURCE_BIZ_TYPE_ALL_VALUE,
  },
  {
    label: 'resource.kgDoc',
    value: RESOURCE_BIZ_TYPE_KG_DOC_VALUE,
  },
  // {
  //   label: 'resource.kgTerm',
  //   value: RESOURCE_BIZ_TYPE_KG_TERM_VALUE,
  // },
  {
    label: 'resource.kgQa',
    value: RESOURCE_BIZ_TYPE_KG_QA_VALUE,
  },
];

// 权限相关常量
export const PERMISSION_ALL_VALUE = ''; // 全部权限
export const PERMISSION_CREATED_BY_ME_VALUE = 'CREATED_BY_ME'; // 我创建的
export const PERMISSION_AUTHORIZED_TO_ME_VALUE = 'AUTHORIZED_TO_ME'; // 授权给我
export const PERMISSION_PENDING_MY_APPROVAL_VALUE = 'PENDING_MY_APPROVAL'; // 待我审核
export const PERMISSION_APPLIED_BY_ME_VALUE = 'APPLIED_BY_ME'; // 我申请的

// 权限筛选选项
export const permissionOptions = [
  {
    label: 'common.all',
    value: PERMISSION_ALL_VALUE,
  },
  {
    label: 'resource.createdByMe',
    value: PERMISSION_CREATED_BY_ME_VALUE,
  },
  {
    label: 'resource.authorizedToMe',
    value: PERMISSION_AUTHORIZED_TO_ME_VALUE,
  },
  {
    label: 'resource.pendingMyApproval',
    value: PERMISSION_PENDING_MY_APPROVAL_VALUE,
  },
  {
    label: 'resource.appliedByMe',
    value: PERMISSION_APPLIED_BY_ME_VALUE,
  },
];
