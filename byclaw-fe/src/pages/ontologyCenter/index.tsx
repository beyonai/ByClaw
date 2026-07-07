// @ts-nocheck
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Button, Dropdown, Empty, Form, Input, Modal, Progress, Spin, Table, Tabs, Tooltip, message } from 'antd';
import {
  ApiOutlined,
  CloseOutlined,
  DatabaseOutlined,
  EllipsisOutlined,
  EyeOutlined,
  LinkOutlined,
  ReloadOutlined,
  SearchOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import CommonTabs from '@/components/CommonTabs';
import ResourceFilter, {
  getDefaultParams,
  IOnOkParams,
  PERMISSION_ALL_VALUE,
  PERMISSION_APPLIED_BY_ME_VALUE,
  PERMISSION_AUTHORIZED_TO_ME_VALUE,
  PERMISSION_CREATED_BY_ME_VALUE,
  STATUS_ALL_VALUE,
  STATUS_CANCELLED_VALUE,
  STATUS_IN_STOCK_VALUE,
} from '@/components/Resources/components/ResourceFilter';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { findDetailsById, installDigitalEmployeeRelResources } from '@/pages/manager/service/DigitalEmployeeMgr';
import { queryCatalogTree } from '@/service/digitalEmployees';
import { pageOntologyResources, syncOntologyResources } from '@/service/ontology';
import { normalizeCatalogTree } from '@/utils/catalog';
import OntologyNodeDrawer from './OntologyNodeDrawer';
import styles from './index.module.less';

type OwnerTab = 'personal' | 'enterprise' | 'enterpriseTerm';
type StatusFilter = 'valid' | 'all' | 'offline';
type PermissionFilter = 'all' | 'manage' | 'use' | 'apply';
type SyncBatchStatus = 'pending' | 'running' | 'done' | 'failed';

type SyncBatch = {
  pageNum: number;
  status: SyncBatchStatus;
  created?: number;
  updated?: number;
  synced?: number;
  batchSize?: number;
};

const ALL_CATEGORY_ID = '-1';

const toResourceFilterStatus = (statusFilter: StatusFilter) => {
  if (statusFilter === 'all') return STATUS_ALL_VALUE;
  if (statusFilter === 'offline') return STATUS_CANCELLED_VALUE;
  return STATUS_IN_STOCK_VALUE;
};

const toOntologyStatusFilter = (resourceStatus: string): StatusFilter => {
  if (resourceStatus === STATUS_ALL_VALUE) return 'all';
  if (resourceStatus === STATUS_CANCELLED_VALUE) return 'offline';
  return 'valid';
};

const toResourceFilterPermission = (permissionFilter: PermissionFilter) => {
  if (permissionFilter === 'manage') return PERMISSION_CREATED_BY_ME_VALUE;
  if (permissionFilter === 'use') return PERMISSION_AUTHORIZED_TO_ME_VALUE;
  if (permissionFilter === 'apply') return PERMISSION_APPLIED_BY_ME_VALUE;
  return PERMISSION_ALL_VALUE;
};

const toOntologyPermissionFilter = (permission: string): PermissionFilter => {
  if (permission === PERMISSION_CREATED_BY_ME_VALUE) return 'manage';
  if (permission === PERMISSION_AUTHORIZED_TO_ME_VALUE) return 'use';
  if (permission === PERMISSION_APPLIED_BY_ME_VALUE) return 'apply';
  return 'all';
};

const StaticTablePanel = ({
  title,
  rows,
  columns,
  rowKey,
  onClose,
}: {
  title: React.ReactNode;
  rows: any[];
  columns: any[];
  rowKey: any;
  onClose: () => void;
}) => (
  <div className={styles.sidePanel}>
    <div className={styles.sidePanelHeader}>
      <span>{title}</span>
      <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
    </div>
    <div className={styles.sidePanelBody}>
      <Table
        size="small"
        tableLayout="fixed"
        rowKey={rowKey}
        dataSource={rows || []}
        columns={columns}
        pagination={false}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />
    </div>
  </div>
);

const FALLBACK_CATALOGS = [
  { catalogId: 'platform', catalogName: '平台能力' },
  { catalogId: 'marketing', catalogName: '市场营销' },
  { catalogId: 'sales', catalogName: '销售领域' },
  { catalogId: 'rd', catalogName: '研发领域' },
  { catalogId: 'delivery', catalogName: '交付领域' },
  { catalogId: 'hr', catalogName: '人力资源' },
  { catalogId: 'finance', catalogName: '财务领域' },
  { catalogId: 'office', catalogName: '行政办公' },
  { catalogId: 'other', catalogName: '其他领域' },
];

const getCatalogParentId = (item: any) =>
  item?.pcatalogId ?? item?.pCatalogId ?? item?.parentCatalogId ?? item?.parentDirId;

const getCatalogSceneCode = (item: any) =>
  item?.sceneCode ?? item?.catalogCode ?? item?.code ?? item?.resourceCode ?? item?.sceneId ?? item?.catalogId;

const getCatalogTabKey = (item: any) => {
  const value = getCatalogSceneCode(item);
  return value === undefined || value === null || value === '' ? ALL_CATEGORY_ID : `${value}`;
};

const getDisplayCatalogs = (list: any[] = []) => {
  if (!Array.isArray(list) || !list.length) return FALLBACK_CATALOGS;
  if (list.some((item) => Array.isArray(item?.children) && item.children.length > 0)) {
    return list;
  }

  const idSet = new Set(list.map((item) => `${item?.catalogId}`));
  const childrenMap = new Map<string, any[]>();
  const roots: any[] = [];
  list.forEach((item) => {
    const parentId = getCatalogParentId(item);
    if (parentId !== undefined && parentId !== null && idSet.has(`${parentId}`)) {
      const key = `${parentId}`;
      childrenMap.set(key, [...(childrenMap.get(key) || []), item]);
      return;
    }
    roots.push(item);
  });

  return roots;
};

const MOCK_RESOURCES = [
  {
    resourceId: 'mock-personal-view-customer360',
    ownerType: 'personal',
    resourceBizType: 'VIEW',
    resourceName: '客户360视图',
    resourceCode: 'personal_customer_360_view',
    resourceDesc: '面向客户旅程分析的个人视图。',
    resourceStatus: 'valid',
    permission: 'manage',
    catalogId: 'platform',
    catalogName: '平台能力',
    creator: '黄药师',
    baseId: 'personal_demo_base',
    baseName: '个人演示本体库',
    sceneId: 'customer_operation',
    sceneName: '客户运营',
    viewCode: 'personal_customer_360_view',
    viewName: '客户360视图',
    objectCodes: ['customer_profile', 'customer_order'],
    relations: [
      {
        relationCode: 'customer_has_order',
        relationName: '客户下单',
        relationCardinality: '1:N',
        sourceObjectCode: 'customer_profile',
        sourceObjectName: '客户档案',
        targetObjectCode: 'customer_order',
        targetObjectName: '客户订单',
      },
    ],
  },
  {
    resourceId: 'mock-personal-object-customer',
    ownerType: 'personal',
    resourceBizType: 'OBJECT',
    resourceName: '客户档案对象',
    resourceCode: 'customer_profile',
    resourceDesc: '沉淀客户基础资料、等级和触达偏好。',
    resourceStatus: 'valid',
    permission: 'use',
    catalogId: 'marketing',
    catalogName: '市场营销',
    creator: '黄药师',
    baseId: 'personal_demo_base',
    baseName: '个人演示本体库',
    sceneId: 'customer_operation',
    sceneName: '客户运营',
    objectCode: 'customer_profile',
    objectName: '客户档案对象',
    properties: [
      { propertyName: '客户名称', propertyCode: 'customer_name', dataType: 'STRING' },
      { propertyName: '客户等级', propertyCode: 'customer_level', dataType: 'STRING' },
    ],
    actions: [
      { actionCode: 'sync_customer_profile', actionName: '同步客户档案', actionDesc: '从客户系统同步最新档案。' },
      { actionCode: 'score_customer_value', actionName: '客户价值评分', actionDesc: '计算客户价值分层。' },
    ],
  },
  {
    resourceId: 'mock-personal-view-sales',
    ownerType: 'personal',
    resourceBizType: 'VIEW',
    resourceName: '销售机会跟进视图',
    resourceCode: 'sales_opportunity_view',
    resourceDesc: '跟踪销售机会阶段、预计金额和下一步动作。',
    resourceStatus: 'valid',
    permission: 'manage',
    catalogId: 'sales',
    catalogName: '销售领域',
    creator: '黄药师',
    baseId: 'personal_demo_base',
    baseName: '个人演示本体库',
    sceneId: 'sales_followup',
    sceneName: '销售跟进',
    viewCode: 'sales_opportunity_view',
    viewName: '销售机会跟进视图',
    objectCodes: ['sales_opportunity', 'customer_profile'],
    relations: [
      {
        relationCode: 'customer_has_opportunity',
        relationName: '客户关联商机',
        relationCardinality: '1:N',
        sourceObjectCode: 'customer_profile',
        sourceObjectName: '客户档案',
        targetObjectCode: 'sales_opportunity',
        targetObjectName: '销售机会',
      },
    ],
  },
  {
    resourceId: 'mock-personal-object-opportunity',
    ownerType: 'personal',
    resourceBizType: 'OBJECT',
    resourceName: '销售机会对象',
    resourceCode: 'sales_opportunity',
    resourceDesc: '记录商机阶段、预计成交时间和负责人。',
    resourceStatus: 'valid',
    permission: 'use',
    catalogId: 'sales',
    catalogName: '销售领域',
    creator: '黄药师',
    baseId: 'personal_demo_base',
    baseName: '个人演示本体库',
    sceneId: 'sales_followup',
    sceneName: '销售跟进',
    objectCode: 'sales_opportunity',
    objectName: '销售机会对象',
    properties: [
      { propertyName: '商机名称', propertyCode: 'opportunity_name', dataType: 'STRING' },
      { propertyName: '预计金额', propertyCode: 'estimated_amount', dataType: 'DECIMAL' },
    ],
    actions: [{ actionCode: 'advance_stage', actionName: '推进商机阶段', actionDesc: '更新商机当前阶段。' }],
  },
  {
    resourceId: 'mock-personal-view-task',
    ownerType: 'personal',
    resourceBizType: 'VIEW',
    resourceName: '待办任务视图',
    resourceCode: 'todo_task_view',
    resourceDesc: '汇总个人待办、负责人、截止时间和完成状态。',
    resourceStatus: 'offline',
    permission: 'apply',
    catalogId: 'office',
    catalogName: '行政办公',
    creator: '黄药师',
    baseId: 'personal_demo_base',
    baseName: '个人演示本体库',
    sceneId: 'office_task',
    sceneName: '办公协同',
    viewCode: 'todo_task_view',
    viewName: '待办任务视图',
    objectCodes: ['todo_task'],
    relations: [],
  },
  {
    resourceId: 'mock-personal-object-task',
    ownerType: 'personal',
    resourceBizType: 'OBJECT',
    resourceName: '待办任务对象',
    resourceCode: 'todo_task',
    resourceDesc: '个人任务的状态、优先级与截止时间。',
    resourceStatus: 'valid',
    permission: 'manage',
    catalogId: 'office',
    catalogName: '行政办公',
    creator: '黄药师',
    baseId: 'personal_demo_base',
    baseName: '个人演示本体库',
    sceneId: 'office_task',
    sceneName: '办公协同',
    objectCode: 'todo_task',
    objectName: '待办任务对象',
    properties: [
      { propertyName: '任务标题', propertyCode: 'task_title', dataType: 'STRING' },
      { propertyName: '截止时间', propertyCode: 'deadline', dataType: 'DATETIME' },
    ],
    actions: [{ actionCode: 'complete_task', actionName: '完成任务', actionDesc: '将任务标记为完成。' }],
  },
  {
    resourceId: 'mock-enterprise-view-order',
    ownerType: 'enterprise',
    resourceBizType: 'VIEW',
    resourceName: '订单履约全景视图',
    resourceCode: 'order_fulfillment_view',
    resourceDesc: '聚合订单、合同、交付节点和回款状态。',
    resourceStatus: 'valid',
    permission: 'use',
    catalogId: 'delivery',
    catalogName: '交付领域',
    creator: '企业本体中心',
    baseId: 'enterprise_demo_base',
    baseName: '企业演示本体库',
    sceneId: 'order_delivery',
    sceneName: '订单履约',
    viewCode: 'order_fulfillment_view',
    viewName: '订单履约全景视图',
    objectCodes: ['sales_order', 'delivery_task'],
    relations: [
      {
        relationCode: 'order_create_task',
        relationName: '订单生成交付任务',
        relationCardinality: '1:N',
        sourceObjectCode: 'sales_order',
        sourceObjectName: '销售订单',
        targetObjectCode: 'delivery_task',
        targetObjectName: '交付任务',
      },
    ],
  },
  {
    resourceId: 'mock-enterprise-object-order',
    ownerType: 'enterprise',
    resourceBizType: 'OBJECT',
    resourceName: '销售订单对象',
    resourceCode: 'sales_order',
    resourceDesc: '企业订单主数据对象，包含金额、状态和客户信息。',
    resourceStatus: 'valid',
    permission: 'manage',
    catalogId: 'sales',
    catalogName: '销售领域',
    creator: '企业本体中心',
    baseId: 'enterprise_demo_base',
    baseName: '企业演示本体库',
    sceneId: 'order_delivery',
    sceneName: '订单履约',
    objectCode: 'sales_order',
    objectName: '销售订单对象',
    properties: [
      { propertyName: '订单编号', propertyCode: 'order_no', dataType: 'STRING' },
      { propertyName: '订单金额', propertyCode: 'order_amount', dataType: 'DECIMAL' },
    ],
    actions: [
      { actionCode: 'create_delivery_task', actionName: '创建交付任务', actionDesc: '基于订单创建履约任务。' },
      { actionCode: 'query_payment_status', actionName: '查询回款状态', actionDesc: '拉取订单回款状态。' },
    ],
  },
  {
    resourceId: 'mock-enterprise-view-contract',
    ownerType: 'enterprise',
    resourceBizType: 'VIEW',
    resourceName: '合同风险视图',
    resourceCode: 'contract_risk_view',
    resourceDesc: '汇总合同条款、履约节点和风险等级。',
    resourceStatus: 'valid',
    permission: 'manage',
    catalogId: 'delivery',
    catalogName: '交付领域',
    creator: '企业本体中心',
    baseId: 'enterprise_demo_base',
    baseName: '企业演示本体库',
    sceneId: 'contract_manage',
    sceneName: '合同管理',
    viewCode: 'contract_risk_view',
    viewName: '合同风险视图',
    objectCodes: ['contract_record', 'sales_order'],
    relations: [
      {
        relationCode: 'order_sign_contract',
        relationName: '订单签订合同',
        relationCardinality: '1:1',
        sourceObjectCode: 'sales_order',
        sourceObjectName: '销售订单',
        targetObjectCode: 'contract_record',
        targetObjectName: '合同记录',
      },
    ],
  },
  {
    resourceId: 'mock-enterprise-object-contract',
    ownerType: 'enterprise',
    resourceBizType: 'OBJECT',
    resourceName: '合同记录对象',
    resourceCode: 'contract_record',
    resourceDesc: '企业合同主数据，包含合同金额、期限和风险状态。',
    resourceStatus: 'valid',
    permission: 'use',
    catalogId: 'delivery',
    catalogName: '交付领域',
    creator: '企业本体中心',
    baseId: 'enterprise_demo_base',
    baseName: '企业演示本体库',
    sceneId: 'contract_manage',
    sceneName: '合同管理',
    objectCode: 'contract_record',
    objectName: '合同记录对象',
    properties: [
      { propertyName: '合同编号', propertyCode: 'contract_no', dataType: 'STRING' },
      { propertyName: '风险等级', propertyCode: 'risk_level', dataType: 'STRING' },
    ],
    actions: [{ actionCode: 'evaluate_contract_risk', actionName: '评估合同风险', actionDesc: '计算合同风险等级。' }],
  },
  {
    resourceId: 'mock-enterprise-view-finance',
    ownerType: 'enterprise',
    resourceBizType: 'VIEW',
    resourceName: '现金流分析视图',
    resourceCode: 'cash_flow_view',
    resourceDesc: '按客户、合同和回款周期分析现金流。',
    resourceStatus: 'offline',
    permission: 'apply',
    catalogId: 'finance',
    catalogName: '财务领域',
    creator: '企业本体中心',
    baseId: 'enterprise_demo_base',
    baseName: '企业演示本体库',
    sceneId: 'finance_analysis',
    sceneName: '财务分析',
    viewCode: 'cash_flow_view',
    viewName: '现金流分析视图',
    objectCodes: ['invoice_record', 'sales_order'],
    relations: [],
  },
  {
    resourceId: 'mock-enterprise-object-invoice',
    ownerType: 'enterprise',
    resourceBizType: 'OBJECT',
    resourceName: '发票记录对象',
    resourceCode: 'invoice_record',
    resourceDesc: '记录开票金额、税率、状态和关联订单。',
    resourceStatus: 'valid',
    permission: 'use',
    catalogId: 'finance',
    catalogName: '财务领域',
    creator: '企业本体中心',
    baseId: 'enterprise_demo_base',
    baseName: '企业演示本体库',
    sceneId: 'finance_analysis',
    sceneName: '财务分析',
    objectCode: 'invoice_record',
    objectName: '发票记录对象',
    properties: [
      { propertyName: '发票号', propertyCode: 'invoice_no', dataType: 'STRING' },
      { propertyName: '开票金额', propertyCode: 'invoice_amount', dataType: 'DECIMAL' },
    ],
    actions: [{ actionCode: 'sync_invoice_status', actionName: '同步发票状态', actionDesc: '同步发票最新状态。' }],
  },
  {
    resourceId: 'mock-enterprise-object-employee',
    ownerType: 'enterprise',
    resourceBizType: 'OBJECT',
    resourceName: '员工主数据对象',
    resourceCode: 'employee_master',
    resourceDesc: '组织、岗位、员工状态等基础人力数据。',
    resourceStatus: 'valid',
    permission: 'manage',
    catalogId: 'hr',
    catalogName: '人力资源',
    creator: '企业本体中心',
    baseId: 'enterprise_demo_base',
    baseName: '企业演示本体库',
    sceneId: 'employee_operation',
    sceneName: '员工运营',
    objectCode: 'employee_master',
    objectName: '员工主数据对象',
    properties: [
      { propertyName: '员工姓名', propertyCode: 'employee_name', dataType: 'STRING' },
      { propertyName: '所属部门', propertyCode: 'department_name', dataType: 'STRING' },
    ],
    actions: [{ actionCode: 'query_employee_status', actionName: '查询在职状态', actionDesc: '查询员工当前状态。' }],
  },
];

const getData = (res: any) => res?.data ?? res ?? {};

const findResourceRows = (source: any, depth = 0): any[] => {
  if (!source || depth > 4) return [];
  if (Array.isArray(source)) return source;

  const rowKeys = ['rows', 'list', 'records', 'items', 'content'];
  for (const key of rowKeys) {
    if (Array.isArray(source?.[key])) return source[key];
  }
  if (Array.isArray(source?.objects) || Array.isArray(source?.views)) {
    return [
      ...(source.objects || []).map((item: any) => ({ ...item, resourceBizType: 'OBJECT' })),
      ...(source.views || []).map((item: any) => ({ ...item, resourceBizType: 'VIEW' })),
    ];
  }

  const nestedKeys = ['data', 'result', 'resultObject', 'page', 'pageData'];
  for (const key of nestedKeys) {
    const rows = findResourceRows(source?.[key], depth + 1);
    if (rows.length) return rows;
  }

  return [];
};

const getResourceRows = (res: any) => {
  const data = getData(res);
  return findResourceRows(data);
};

const getSyncData = (res: any) => {
  const data = getData(res);
  return data?.resultObject || data?.data || data || {};
};

const parseMaybeArray = (value: any) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    } catch {
      return [];
    }
  }
  return [value];
};

const getEntryBizType = (entry: any) => {
  if (entry?.resourceBizType) return entry.resourceBizType;
  if (entry?.objectCode || entry?.object_code) return 'OBJECT';
  if (entry?.viewCode || entry?.view_code) return 'VIEW';
  return '';
};

const getResourceKey = (resource: any) => {
  if (resource?.resourceId && !`${resource.resourceId}`.startsWith('mock-')) {
    return `ID:${resource.resourceId}`;
  }
  const bizType = getEntryBizType(resource);
  if (bizType === 'OBJECT') {
    return `OBJECT:${resource?.ontologyBaseCode || resource?.baseId || ''}:${resource?.sceneId || ''}:${
      resource?.viewCode || ''
    }:${resource?.objectCode || resource?.resourceCode || ''}`;
  }
  if (bizType === 'VIEW') {
    return `VIEW:${resource?.ontologyBaseCode || resource?.baseId || ''}:${resource?.sceneId || ''}:${
      resource?.viewCode || resource?.resourceCode || ''
    }`;
  }
  const fallback = resource?.resourceId || resource?.resourceCode || '';
  return bizType || fallback ? `${bizType}:${fallback}` : '';
};

const getResourceKeys = (resource: any) => {
  const keys = new Set<string>();
  const key = getResourceKey(resource);
  if (key) keys.add(key);
  if (resource?.resourceId) keys.add(`ID:${resource.resourceId}`);
  return Array.from(keys);
};

const normalizeResourceStatus = (status: any) => {
  if (status === 'offline' || status === 3 || status === 6 || status === '3' || status === '6') return 'offline';
  return 'valid';
};

const normalizePermission = (row: any) => {
  if (row?.permission) return row.permission;
  if (row?.canManageAuth || row?.hasManagePermission) return 'manage';
  if (row?.canUseAuth || row?.hasUsePermission) return 'use';
  return 'apply';
};

const normalizeOntologyResource = (row: any, ownerType: OwnerTab) => {
  const bizType = `${row?.resourceBizType || ''}`.toUpperCase();
  const resourceCode =
    row?.resourceCode ||
    row?.resource_code ||
    row?.viewCode ||
    row?.view_code ||
    row?.objectCode ||
    row?.object_code ||
    row?.code ||
    '';
  const resourceName =
    row?.resourceName ||
    row?.resource_name ||
    row?.viewName ||
    row?.view_name ||
    row?.objectName ||
    row?.object_name ||
    row?.name ||
    resourceCode;
  const baseId = row?.ontologyBaseCode || row?.baseId || row?.pid || row?.baseCode || '';
  return {
    ...row,
    ownerType: row?.ownerType || ownerType,
    resourceBizType: bizType,
    resourceId: row?.resourceId || `${ownerType}-${bizType}-${resourceCode}`,
    resourceCode,
    resourceName,
    resourceDesc: row?.resourceDesc || row?.resource_desc || row?.description || row?.desc || '',
    resourceStatus: normalizeResourceStatus(row?.resourceStatus),
    permission: normalizePermission(row),
    catalogId: row?.catalogId || '',
    catalogName: row?.catalogName || '',
    creator: row?.createUserName || row?.creator || row?.createBy || '',
    baseId,
    baseName: row?.ontologyBaseName || row?.baseName || '',
    sceneId: row?.sceneId || row?.sceneCode || '',
    sceneName: row?.sceneName || '',
    viewCode: bizType === 'VIEW' ? resourceCode : row?.viewCode || row?.view_code,
    viewName: bizType === 'VIEW' ? resourceName : row?.viewName || row?.view_name,
    objectCode: bizType === 'OBJECT' ? resourceCode : row?.objectCode || row?.object_code,
    objectName: bizType === 'OBJECT' ? resourceName : row?.objectName || row?.object_name,
    objectCodes: parseMaybeArray(row?.objectCodes || row?.objects).map(
      (item: any) => item?.objectCode || item?.code || item
    ),
    actions: parseMaybeArray(row?.actions),
    relations: parseMaybeArray(row?.relations),
  };
};

const resourceToRelEntry = (resource: any) => {
  const isView = resource.resourceBizType === 'VIEW';
  return {
    resourceId: resource.resourceId,
    resourceBizType: resource.resourceBizType,
    ontologyBaseCode: resource.baseId,
    ontologyBaseName: resource.baseName,
    ownerType: resource.ownerType,
    resourceName: resource.resourceName,
    resourceCode: resource.resourceCode,
    sceneId: resource.sceneId,
    sceneName: resource.sceneName,
    viewCode: isView ? resource.viewCode : resource.viewCode,
    viewName: isView ? resource.viewName : resource.viewName,
    objectCode: isView ? undefined : resource.objectCode,
    objectName: isView ? undefined : resource.objectName,
  };
};

const matchesKeyword = (item: any, keyword: string) => {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return true;
  return [item.resourceName, item.resourceCode, item.viewName, item.viewCode, item.objectName, item.objectCode].some(
    (value) => `${value || ''}`.toLowerCase().includes(kw)
  );
};

const OntologyCenter: React.FC = () => {
  const intl = useIntl();
  const t = (id: string, values?: any) => intl.formatMessage({ id }, values);
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);
  const activeSiderAgent = useActiveSiderAgent();
  const [providerForm] = Form.useForm();

  const [activeTab, setActiveTab] = useState<OwnerTab>('personal');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('valid');
  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>('all');
  const [catalogId, setCatalogId] = useState(ALL_CATEGORY_ID);
  const [catalogList, setCatalogList] = useState<any[]>(FALLBACK_CATALOGS);
  const [loading, setLoading] = useState(false);
  const [resourceList, setResourceList] = useState<any[]>([]);
  const [providerOpen, setProviderOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncBatches, setSyncBatches] = useState<SyncBatch[]>([]);
  const [syncSummary, setSyncSummary] = useState({ created: 0, updated: 0, synced: 0, totalPages: 0 });
  const [installedKeys, setInstalledKeys] = useState<Set<string>>(new Set());
  const [installingKeys, setInstallingKeys] = useState<Set<string>>(new Set());

  const catalogTabs = useMemo(() => {
    const tabs = getDisplayCatalogs(catalogList);
    return tabs.length ? tabs : FALLBACK_CATALOGS;
  }, [catalogList]);

  const loadInstalledKeys = useCallback(async () => {
    if (!activeSiderAgent?.resourceId) {
      setInstalledKeys(new Set());
      return;
    }
    try {
      const res: any = await findDetailsById({ resourceId: String(activeSiderAgent.resourceId) });
      const detail = getData(res) || {};
      const relEntries = [
        ...parseMaybeArray(detail.relResourceList),
        ...parseMaybeArray(detail.relIds).map((resourceId) => ({ resourceId })),
      ];
      setInstalledKeys(new Set(relEntries.flatMap(getResourceKeys).filter(Boolean)));
    } catch {
      setInstalledKeys((prev) => new Set(prev));
    }
  }, [activeSiderAgent?.resourceId]);

  useEffect(() => {
    queryCatalogTree({ catalogType: '6' })
      .then((res: any) => {
        const treeData = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        const normalized = normalizeCatalogTree(treeData);
        setCatalogList(normalized.length ? normalized : FALLBACK_CATALOGS);
        setCatalogId((prev) => prev || ALL_CATEGORY_ID);
      })
      .catch(() => setCatalogList(FALLBACK_CATALOGS));
  }, []);

  useEffect(() => {
    loadInstalledKeys();
  }, [loadInstalledKeys]);

  const loadResources = useCallback(async () => {
    if (activeTab === 'enterpriseTerm') {
      setResourceList([]);
      return;
    }
    setLoading(true);
    try {
      const res: any = await pageOntologyResources({
        ownerType: activeTab,
        resourceBizTypeList: ['VIEW', 'OBJECT'],
        keyword,
        catalogId,
        statusList: statusFilter === 'all' ? [0, 1, 2, 3, 4, 5] : statusFilter === 'offline' ? [3] : [2],
        pageNum: 1,
        pageSize: 100,
      });
      const rows = getResourceRows(res);
      setResourceList(
        parseMaybeArray(rows)
          .map((row) => normalizeOntologyResource(row, activeTab))
          .filter((item) => item.resourceBizType === 'VIEW' || item.resourceBizType === 'OBJECT')
      );
    } catch {
      setResourceList(MOCK_RESOURCES.filter((item) => item.ownerType === activeTab));
    } finally {
      setLoading(false);
    }
  }, [activeTab, catalogId, keyword, statusFilter]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  useEffect(() => {
    const onInstalled = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      const entries = parseMaybeArray(detail.entries || detail.entry);
      if (!entries.length) return;
      setInstalledKeys((prev) => {
        const next = new Set(prev);
        entries.forEach((entry) => {
          getResourceKeys(entry).forEach((key) => key && next.add(key));
        });
        return next;
      });
    };
    const onUninstalled = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      const keys = [detail.key, ...getResourceKeys(detail.entry)].filter(Boolean);
      if (!keys.length) return;
      setInstalledKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((key) => next.delete(key));
        return next;
      });
    };
    window.addEventListener('ontologyBindSaved', onInstalled);
    window.addEventListener('ontologyResourceUninstalled', onUninstalled);
    return () => {
      window.removeEventListener('ontologyBindSaved', onInstalled);
      window.removeEventListener('ontologyResourceUninstalled', onUninstalled);
    };
  }, []);

  const visibleResources = useMemo(() => {
    if (activeTab === 'enterpriseTerm') return [];
    return resourceList
      .filter((item) => item.ownerType === activeTab)
      .filter((item) => catalogId === ALL_CATEGORY_ID || !item.catalogId || `${item.catalogId}` === `${catalogId}`)
      .filter((item) => statusFilter === 'all' || item.resourceStatus === statusFilter)
      .filter((item) => permissionFilter === 'all' || item.permission === permissionFilter)
      .filter((item) => matchesKeyword(item, keyword));
  }, [activeTab, catalogId, keyword, permissionFilter, resourceList, statusFilter]);

  const syncDoneCount = syncBatches.filter((item) => item.status === 'done').length;
  const syncProgress = syncBatches.length ? Math.round((syncDoneCount / syncBatches.length) * 100) : 0;

  const updateSyncBatch = (pageNum: number, patch: Partial<SyncBatch>) => {
    setSyncBatches((prev) => {
      const exists = prev.some((item) => item.pageNum === pageNum);
      const next = exists
        ? prev.map((item) => (item.pageNum === pageNum ? { ...item, ...patch } : item))
        : [...prev, { pageNum, status: 'pending' as SyncBatchStatus, ...patch }];
      return next.sort((a, b) => a.pageNum - b.pageNum);
    });
  };

  const openDetail = useCallback(
    (resource: any) => {
      const isView = resource.resourceBizType === 'VIEW';
      setDetailPanel?.(
        <OntologyNodeDrawer
          open
          panel
          node={{
            level: isView ? 'VIEW' : resource.viewCode ? 'OBJECT_IN_VIEW' : 'OBJECT_IN_SCENE',
            baseName: resource.baseName,
            sceneId: resource.sceneId,
            sceneName: resource.sceneName,
            viewCode: resource.viewCode,
            viewName: resource.viewName,
            objectCode: resource.objectCode,
            objectName: resource.objectName,
          }}
          baseId={resource.baseId}
          ownerType={resource.ownerType}
          showReference={false}
          onClose={() => clearDetailPanel?.()}
        />,
        { width: isView ? 380 : 350 }
      );
    },
    [clearDetailPanel, setDetailPanel]
  );

  const handleRefresh = async () => {
    if (activeTab === 'enterpriseTerm') {
      message.info('企业术语正在建设中');
      return;
    }

    const pageSize = 100;
    let pageNum = 1;
    let hasMore = true;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSynced = 0;
    let totalPages = 0;

    setSyncOpen(true);
    setSyncing(true);
    setSyncBatches([{ pageNum: 1, status: 'running' }]);
    setSyncSummary({ created: 0, updated: 0, synced: 0, totalPages: 0 });

    try {
      while (hasMore && pageNum <= 1000) {
        updateSyncBatch(pageNum, { status: 'running' });
        const res: any = await syncOntologyResources({
          ownerType: activeTab,
          resourceBizTypeList: ['VIEW', 'OBJECT'],
          keyword,
          catalogId,
          pageNum,
          pageSize,
        });
        const data = getSyncData(res);
        const created = Number(data.created || 0);
        const updated = Number(data.updated || 0);
        const synced = Number(data.synced || created + updated || 0);
        const batchSize = Number(data.batchSize || parseMaybeArray(data.rows).length || 0);

        totalCreated += created;
        totalUpdated += updated;
        totalSynced += synced;
        totalPages = Number(data.batchTotal || data.totalPages || data.pageInfo?.totalPages || totalPages || pageNum);
        hasMore = data.hasMore === true || (totalPages > 0 && pageNum < totalPages);

        updateSyncBatch(pageNum, { status: 'done', created, updated, synced, batchSize });
        setSyncSummary({ created: totalCreated, updated: totalUpdated, synced: totalSynced, totalPages });

        if (hasMore) {
          updateSyncBatch(pageNum + 1, { status: 'pending' });
        }
        pageNum += 1;
      }

      await loadResources();
      message.success(t('common.refreshSuccess'));
    } catch (error) {
      updateSyncBatch(pageNum, { status: 'failed' });
      message.error('本体资源同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleProviderSubmit = async () => {
    const values = await providerForm.validateFields();
    Modal.confirm({
      title: t('ontologyCenter.provider.confirmTitle'),
      content: '将切换本体资源信息的服务提供商，请谨慎操作！',
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: () => {
        setProviderOpen(false);
        message.success(t('common.operationSuccess'));
        providerForm.resetFields();
        return values;
      },
    });
  };

  const simulateAuth = (resource: any, type: 'manage' | 'use') => {
    message.info(
      type === 'manage'
        ? `${t('common.manageAuthorization')}：${resource.resourceName}`
        : `${t('common.useAuthorization')}：${resource.resourceName}`
    );
  };

  const installResource = async (resource: any) => {
    if (!activeSiderAgent?.resourceId) {
      message.error(t('resource.noDefaultDigitalEmployee'));
      return;
    }
    if (!resource?.resourceId || `${resource.resourceId}`.startsWith('mock-')) {
      message.error('当前资源还没有真实资源ID，请先刷新同步后再安装');
      return;
    }
    const key = getResourceKey(resource);
    if (installedKeys.has(key)) return;
    setInstallingKeys((prev) => new Set(prev).add(key));
    try {
      const res: any = await installDigitalEmployeeRelResources({
        digitalEmployeeId: `${activeSiderAgent.resourceId}`,
        relIds: [`${resource.resourceId}`],
      });
      if (res && res.code !== undefined && res.code !== 0 && res.code !== 200) {
        message.error(res.msg || res.message || t('common.operationFailed'));
        return;
      }

      const entry = resourceToRelEntry(resource);
      const detail = getData(res) || {};
      const relEntries = [
        entry,
        ...parseMaybeArray(detail.relResourceList),
        ...parseMaybeArray(detail.relIds).map((resourceId) => ({ resourceId })),
      ];
      setInstalledKeys((prev) => {
        const next = new Set(prev);
        relEntries.flatMap(getResourceKeys).forEach((item) => item && next.add(item));
        return next;
      });
      message.success(t('resource.installSuccess'));
      window.dispatchEvent(
        new CustomEvent('ontologyBindSaved', {
          detail: {
            tab: resource.resourceBizType === 'VIEW' ? 'view' : 'object',
            entry,
            entries: [entry],
            openSider: true,
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent('digitalEmployeeResourceInstalled', { detail: { resourceId: resource.resourceId } })
      );
      await loadInstalledKeys();
    } catch (error: any) {
      message.error(typeof error === 'string' ? error : error?.message || t('common.operationFailed'));
    } finally {
      setInstallingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const openTablePanel = useCallback(
    ({ title, rows, columns, rowKey, width = 520 }: any) => {
      setDetailPanel?.(
        <StaticTablePanel
          title={title}
          rows={rows}
          columns={columns}
          rowKey={rowKey}
          onClose={() => clearDetailPanel?.()}
        />,
        { width }
      );
    },
    [clearDetailPanel, setDetailPanel]
  );

  const showViewObjects = useCallback(
    (view: any) => {
      openTablePanel({
        title: `${view.resourceName} / ${t('common.resourceType.object')}`,
        rowKey: (row: any) => row.objectCode,
        rows: view.objectCodes.map((code: string) => {
          const target =
            resourceList.find(
              (item) => item.resourceBizType === 'OBJECT' && item.sceneId === view.sceneId && item.objectCode === code
            ) || {};
          return {
            objectCode: code,
            objectName: target.objectName || target.resourceName || code,
            sceneName: view.sceneName,
            resourceDesc: target.resourceDesc,
          };
        }),
        columns: [
          { title: t('common.resourceType.object'), dataIndex: 'objectName', ellipsis: true },
          { title: t('ontologyCenter.detail.col.code'), dataIndex: 'objectCode', ellipsis: true },
          { title: t('common.desc'), dataIndex: 'resourceDesc', ellipsis: true },
        ],
      });
    },
    [openTablePanel, resourceList, t]
  );

  const getObjectRelations = useCallback(
    (object: any) =>
      resourceList
        .filter((item) => item.resourceBizType === 'VIEW' && item.sceneId === object.sceneId)
        .flatMap((item) => item.relations || [])
        .filter(
          (relation: any) =>
            relation.sourceObjectCode === object.objectCode || relation.targetObjectCode === object.objectCode
        ),
    [resourceList]
  );

  const showObjectActions = useCallback(
    (object: any) => {
      openTablePanel({
        title: `${object.resourceName} / ${t('ontologyCenter.detail.actions')}`,
        rowKey: (row: any) => row.actionCode,
        rows: object.actions || [],
        columns: [
          { title: t('ontologyCenter.detail.action.name'), dataIndex: 'actionName', ellipsis: true },
          { title: t('ontologyCenter.detail.col.code'), dataIndex: 'actionCode', ellipsis: true },
          { title: t('common.desc'), dataIndex: 'actionDesc', ellipsis: true },
        ],
      });
    },
    [openTablePanel, t]
  );

  const showObjectRelations = useCallback(
    (object: any) => {
      openTablePanel({
        title: `${object.resourceName} / ${t('employeeDetail.ontology.relation')}`,
        rowKey: (row: any) => row.relationCode,
        rows: getObjectRelations(object),
        columns: [
          { title: t('ontologyCenter.detail.rel.name'), dataIndex: 'relationName', ellipsis: true },
          { title: t('ontologyCenter.detail.rel.source'), dataIndex: 'sourceObjectName', ellipsis: true },
          { title: t('ontologyCenter.detail.rel.target'), dataIndex: 'targetObjectName', ellipsis: true },
          { title: t('ontologyCenter.detail.rel.cardinality'), dataIndex: 'relationCardinality', width: 90 },
        ],
      });
    },
    [getObjectRelations, openTablePanel, t]
  );

  const renderSyncBatchStatus = (batch: SyncBatch) => {
    if (batch.status === 'running') return '进行中';
    if (batch.status === 'done') return `已完成（新增 ${batch.created || 0}，更新 ${batch.updated || 0}）`;
    if (batch.status === 'failed') return '失败';
    return '未开始';
  };

  const renderCardMenu = (resource: any) => {
    const items: any[] = [
      { key: 'applyUse', label: t('resource.applyUse'), icon: <DatabaseOutlined /> },
      { key: 'manageAuth', label: t('common.manageAuthorization'), icon: <LinkOutlined /> },
      { key: 'useAuth', label: t('common.useAuthorization'), icon: <EyeOutlined /> },
      { key: 'auditUse', label: t('resource.auditUse'), icon: <ApiOutlined /> },
    ];

    return {
      items,
      onClick: ({ key, domEvent }: any) => {
        domEvent?.stopPropagation?.();
        if (key === 'applyUse') message.success(t('resource.applyUseSuccess'));
        if (key === 'manageAuth') simulateAuth(resource, 'manage');
        if (key === 'useAuth') simulateAuth(resource, 'use');
        if (key === 'auditUse') message.info(`${t('resource.auditUse')}：${resource.resourceName}`);
      },
    };
  };

  const renderCardBottomActions = (resource: any) => {
    const installed = installedKeys.has(getResourceKey(resource));
    const isView = resource.resourceBizType === 'VIEW';
    const actions: any[] = [];
    if (!installed) {
      actions.push({
        key: 'install',
        label: isView ? t('resource.installView') : t('resource.installObject'),
        loading: installingKeys.has(getResourceKey(resource)),
        disabled: installingKeys.has(getResourceKey(resource)),
        onClick: () => installResource(resource),
      });
    }
    if (isView) {
      actions.push({
        key: 'objects',
        label: t('ontologyCenter.action.viewObjects'),
        onClick: () => showViewObjects(resource),
      });
    } else {
      actions.push(
        { key: 'actions', label: t('ontologyCenter.action.viewActions'), onClick: () => showObjectActions(resource) },
        {
          key: 'relations',
          label: t('ontologyCenter.action.viewRelations'),
          onClick: () => showObjectRelations(resource),
        }
      );
    }

    return actions;
  };

  const ontologyFilterParam = getDefaultParams({
    resourceStatus: toResourceFilterStatus(statusFilter),
    permission: toResourceFilterPermission(permissionFilter),
  });

  const handleFilterOk = (param: IOnOkParams) => {
    setStatusFilter(toOntologyStatusFilter(param.resourceStatus));
    setPermissionFilter(toOntologyPermissionFilter(param.permission || PERMISSION_ALL_VALUE));
  };

  const renderCards = () => {
    if (activeTab === 'enterpriseTerm') {
      return <div className={styles.building}>{t('ontologyCenter.enterpriseTermBuilding')}</div>;
    }
    if (!loading && !visibleResources.length) {
      return (
        <div className={styles.emptyWrap}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.noData')} />
        </div>
      );
    }
    return (
      <div className={styles.resourceCardGrid}>
        {visibleResources.map((resource) => {
          const isView = resource.resourceBizType === 'VIEW';
          return (
            <div key={resource.resourceId} className={styles.resourceCard}>
              <div className={styles.cardHeader}>
                <div className={classnames(styles.cardIcon, isView ? styles.viewIcon : styles.objectIcon)}>
                  <AntdIcon type={isView ? 'icon-a-yemian-line' : 'icon-tongxun'} />
                </div>
                <div className={styles.cardMain}>
                  <div className={styles.cardNameRow}>
                    <Tooltip title={resource.resourceName}>
                      <button type="button" className={styles.cardName} onClick={() => openDetail(resource)}>
                        {resource.resourceName}
                      </button>
                    </Tooltip>
                    <span className={styles.cardTypeTag}>
                      <span className={styles.cardTypeTagText}>
                        {isView ? t('common.resourceType.view') : t('common.resourceType.object')}
                      </span>
                    </span>
                  </div>
                  <div className={styles.cardCode}>{resource.resourceCode}</div>
                </div>
              </div>
              <div className={styles.cardDesc}>{resource.resourceDesc}</div>
              <div className={styles.cardFooter}>
                <div className={styles.cardBottomActions}>
                  {renderCardBottomActions(resource).map((action) => (
                    <Button
                      key={action.key}
                      type="link"
                      size="small"
                      loading={action.loading}
                      disabled={action.disabled}
                      onClick={action.onClick}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
                <Dropdown trigger={['click']} menu={renderCardMenu(resource)}>
                  <Button
                    type="text"
                    className={styles.cardMenu}
                    icon={<EllipsisOutlined />}
                    onClick={(event) => event.stopPropagation()}
                  />
                </Dropdown>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <CommonTabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key as OwnerTab);
          setCatalogId(ALL_CATEGORY_ID);
          setKeyword('');
        }}
        tabBarExtraContent={
          <div className={styles.toolbar}>
            <ResourceFilter
              onOk={handleFilterOk}
              defaultParam={ontologyFilterParam}
              activeTab={activeTab}
              alwaysShowStatusFilter
            />
            <Input
              className={styles.searchInput}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={loadResources}
              suffix={<SearchOutlined onClick={loadResources} />}
              allowClear
              placeholder={t('common.inputKeyword')}
            />
            <Button type="primary" icon={<ReloadOutlined />} loading={loading || syncing} onClick={handleRefresh}>
              {t('common.refresh')}
            </Button>
            <Button type="primary" icon={<SwapOutlined />} onClick={() => setProviderOpen(true)}>
              {t('ontologyCenter.provider.switch')}
            </Button>
          </div>
        }
        items={[
          { key: 'personal', label: t('ontologyCenter.tab.personal') },
          { key: 'enterprise', label: t('ontologyCenter.tab.enterprise') },
          { key: 'enterpriseTerm', label: t('ontologyCenter.tab.enterpriseTerm') },
        ]}
      />

      <div className={styles.wrapper}>
        <div className={classnames('ub ub-ac gap8', styles.filterBar)}>
          <Tabs
            className={classnames('ub-f1', styles.tabs)}
            activeKey={catalogId}
            items={[
              { label: t('digitalEmployees.skillSquare.allCategory'), key: ALL_CATEGORY_ID },
              ...catalogTabs.map((cat: any) => ({ label: cat.catalogName, key: getCatalogTabKey(cat) })),
            ]}
            onChange={(key) => setCatalogId(`${key}`)}
          />
        </div>
        <Spin spinning={loading}>{renderCards()}</Spin>
      </div>

      <Modal
        open={providerOpen}
        title={t('ontologyCenter.provider.switch')}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onOk={handleProviderSubmit}
        onCancel={() => setProviderOpen(false)}
        destroyOnClose
      >
        <Form form={providerForm} layout="vertical" preserve={false}>
          <Form.Item
            name="providerCode"
            label={t('ontologyCenter.provider.code')}
            rules={[{ required: true, message: t('ontologyCenter.provider.codePlaceholder') }]}
          >
            <Input placeholder={t('ontologyCenter.provider.codePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="providerUrl"
            label={t('ontologyCenter.provider.url')}
            rules={[{ required: true, message: t('ontologyCenter.provider.urlPlaceholder') }]}
          >
            <Input placeholder={t('ontologyCenter.provider.urlPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={syncOpen}
        title="本体资源同步"
        footer={[
          <Button key="close" type="primary" disabled={syncing} onClick={() => setSyncOpen(false)}>
            {t('common.confirm')}
          </Button>,
        ]}
        closable={!syncing}
        maskClosable={!syncing}
        onCancel={() => !syncing && setSyncOpen(false)}
      >
        <div className={styles.syncPanel}>
          <div className={styles.syncTitle}>{syncing ? '数据拉取同步中...' : '数据同步完成'}</div>
          <Progress
            percent={syncProgress}
            status={syncBatches.some((item) => item.status === 'failed') ? 'exception' : syncing ? 'active' : 'success'}
          />
          <div className={styles.syncSummary}>
            已完成 {syncDoneCount}/{syncBatches.length || syncSummary.totalPages || 1} 批，新增 {syncSummary.created}{' '}
            条，更新 {syncSummary.updated} 条，同步 {syncSummary.synced} 条。
          </div>
          <div className={styles.syncBatchList}>
            {syncBatches.map((batch) => (
              <div key={batch.pageNum} className={styles.syncBatchItem}>
                <span>第 {batch.pageNum} 批</span>
                <span>{renderSyncBatchStatus(batch)}</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default OntologyCenter;
