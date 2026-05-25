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
