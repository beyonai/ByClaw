// @ts-nocheck
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Button, Dropdown, Empty, Input, Modal, Progress, Select, Spin, Table, Tabs, Tooltip, message } from 'antd';
import {
  ApiOutlined,
  CloseOutlined,
  DatabaseOutlined,
  EllipsisOutlined,
  EyeOutlined,
  LinkOutlined,
  ReloadOutlined,
  SearchOutlined,
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
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import UseApplyAuditDrawer from '@/pages/manager/components/UseApplyAuditDrawer';
import { applyResourceUse } from '@/pages/manager/service/resources';
import { queryCatalogTree } from '@/service/digitalEmployees';
import {
  checkOntologyEnterpriseResourceSyncPermission,
  DEFAULT_ONTOLOGY_SYSTEM_CODE,
  getOntologyObjectDetail,
  listOntologyObjectsByView,
  listOntologyRelationsByObject,
  pageOntologyResources,
  syncOntologyResources,
} from '@/service/ontology';
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
const RESOURCE_PAGE_SIZE = 30;
const ONTOLOGY_SYSTEM_OPTIONS = [
  { label: '百应内置本体库', value: 'BYCLAW_DATACLOUD' },
  { label: '智能体本体库', value: 'WHALE_AGENT' },
];

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

const getCatalogParentId = (item: any) =>
  item?.pcatalogId ?? item?.pCatalogId ?? item?.parentCatalogId ?? item?.parentDirId;

const getCatalogSceneCode = (item: any) =>
  item?.sceneCode ?? item?.catalogCode ?? item?.code ?? item?.resourceCode ?? item?.sceneId ?? item?.catalogId;

const getCatalogTabKey = (item: any) => {
  const value = getCatalogSceneCode(item);
  return value === undefined || value === null || value === '' ? ALL_CATEGORY_ID : `${value}`;
};

const getDisplayCatalogs = (list: any[] = []) => {
  if (!Array.isArray(list) || !list.length) return [];
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

const findPageMeta = (source: any, depth = 0): any => {
  if (!source || depth > 4 || Array.isArray(source)) return {};
  if (source.pageInfo && typeof source.pageInfo === 'object') return source.pageInfo;
  if (
    source.total !== undefined ||
    source.totalPages !== undefined ||
    source.pages !== undefined ||
    source.hasMore !== undefined
  ) {
    return source;
  }

  const nestedKeys = ['data', 'result', 'resultObject', 'page', 'pageData'];
  for (const key of nestedKeys) {
    const meta = findPageMeta(source?.[key], depth + 1);
    if (Object.keys(meta || {}).length) return meta;
  }
  return {};
};

const getPageHasMore = (res: any, pageNum: number, pageSize: number, rowCount: number) => {
  const data = getData(res);
  const meta = findPageMeta(data);
  if (typeof meta.hasMore === 'boolean') return meta.hasMore;
  const total = Number(meta.total ?? data?.total ?? 0);
  const totalPages = Number(meta.totalPages ?? meta.pages ?? meta.pageCount ?? 0);
  if (totalPages > 0) return pageNum < totalPages;
  if (total > 0) return pageNum * pageSize < total;
  return rowCount >= pageSize;
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

const parseMaybeObject = (value: any) => {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const getEntryBizType = (entry: any) => {
  if (entry?.resourceBizType) return entry.resourceBizType;
  if (entry?.objectCode || entry?.object_code) return 'OBJECT';
  if (entry?.viewCode || entry?.view_code) return 'VIEW';
  return '';
};

const getResourceKey = (resource: any) => {
  if (resource?.resourceId) {
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

const mergeResourceRows = (prev: any[], next: any[]) => {
  const merged = new Map<string, any>();
  [...prev, ...next].forEach((item) => {
    const key = getResourceKey(item) || `${item.resourceBizType || ''}:${item.resourceCode || item.resourceId || ''}`;
    if (key) {
      merged.set(key, item);
    }
  });
  return Array.from(merged.values());
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
  const meta = parseMaybeObject(row?.targetContent);
  const source = { ...meta, ...row };
  const bizType = `${source?.resourceBizType || ''}`.toUpperCase();
  const resourceCode =
    source?.resourceCode ||
    source?.resource_code ||
    source?.viewCode ||
    source?.view_code ||
    source?.objectCode ||
    source?.object_code ||
    source?.code ||
    '';
  const resourceName =
    source?.resourceName ||
    source?.resource_name ||
    source?.viewName ||
    source?.view_name ||
    source?.objectName ||
    source?.object_name ||
    source?.name ||
    resourceCode;
  const baseId = source?.ontologyBaseCode || source?.baseId || source?.pid || source?.baseCode || '';
  return {
    ...source,
    ownerType: source?.ownerType || ownerType,
    resourceBizType: bizType,
    resourceId: source?.resourceId || `${ownerType}-${bizType}-${resourceCode}`,
    resourceCode,
    resourceName,
    resourceDesc: source?.resourceDesc || source?.resource_desc || source?.description || source?.desc || '',
    resourceStatus: normalizeResourceStatus(source?.resourceStatus),
    permission: normalizePermission(source),
    catalogId: source?.catalogId || '',
    catalogName: source?.catalogName || '',
    creator: source?.createUserName || source?.creator || source?.createBy || '',
    baseId,
    baseName: source?.ontologyBaseName || source?.baseName || '',
    sceneId: source?.sceneId || source?.sceneCode || '',
    sceneName: source?.sceneName || '',
    viewCode: bizType === 'VIEW' ? resourceCode : source?.viewCode || source?.view_code,
    viewName: bizType === 'VIEW' ? resourceName : source?.viewName || source?.view_name,
    objectCode: bizType === 'OBJECT' ? resourceCode : source?.objectCode || source?.object_code,
    objectName: bizType === 'OBJECT' ? resourceName : source?.objectName || source?.object_name,
    objectCodes: parseMaybeArray(source?.objectCodes || source?.objects).map(
      (item: any) => item?.objectCode || item?.code || item
    ),
    actions: parseMaybeArray(source?.actions),
    relations: parseMaybeArray(source?.relations),
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

  const [activeTab, setActiveTab] = useState<OwnerTab>('personal');
  const [ontologySystemCode, setOntologySystemCode] = useState(DEFAULT_ONTOLOGY_SYSTEM_CODE);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('valid');
  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>('all');
  const [catalogId, setCatalogId] = useState(ALL_CATEGORY_ID);
  const [catalogList, setCatalogList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [resourcePageNum, setResourcePageNum] = useState(1);
  const [resourceHasMore, setResourceHasMore] = useState(false);
  const [resourceList, setResourceList] = useState<any[]>([]);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncBatches, setSyncBatches] = useState<SyncBatch[]>([]);
  const [syncSummary, setSyncSummary] = useState({ created: 0, updated: 0, synced: 0, totalPages: 0 });
  const [installedKeys, setInstalledKeys] = useState<Set<string>>(new Set());
  const [installingKeys, setInstallingKeys] = useState<Set<string>>(new Set());
  const [canRefreshEnterprise, setCanRefreshEnterprise] = useState(false);
  const [authDrawerOpen, setAuthDrawerOpen] = useState(false);
  const [authType, setAuthType] = useState<'useAuth' | 'mgrAuth'>('useAuth');
  const [selectedResource, setSelectedResource] = useState<any>(null);
  const [useApplyAuditOpen, setUseApplyAuditOpen] = useState(false);

  const catalogTabs = useMemo(() => {
    return getDisplayCatalogs(catalogList);
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
        setCatalogList(normalized);
        setCatalogId((prev) => prev || ALL_CATEGORY_ID);
      })
      .catch(() => setCatalogList([]));
  }, []);

  useEffect(() => {
    checkOntologyEnterpriseResourceSyncPermission()
      .then((res: any) => setCanRefreshEnterprise(getData(res) === true))
      .catch(() => setCanRefreshEnterprise(false));
  }, []);

  useEffect(() => {
    loadInstalledKeys();
  }, [loadInstalledKeys]);

  const loadResources = useCallback(
    async (nextPageNum = 1, append = false) => {
      if (activeTab === 'enterpriseTerm') {
        setResourceList([]);
        setResourcePageNum(1);
        setResourceHasMore(false);
        return;
      }
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      try {
        const res: any = await pageOntologyResources({
          // “我可用的”按当前用户创建及被授权的数据查询；官方推荐仍限定企业资源。
          ownerType: activeTab === 'personal' ? undefined : activeTab,
          resourceBizTypeList: ['VIEW', 'OBJECT'],
          systemCode: ontologySystemCode,
          keyword,
          // “全部分类”是前端占位值，不能把 -1 传给后端当作真实目录筛选，否则会返回空列表。
          catalogId: catalogId === ALL_CATEGORY_ID ? undefined : catalogId,
          statusList: statusFilter === 'all' ? [0, 1, 2, 3, 4, 5] : statusFilter === 'offline' ? [3] : [2],
          permission: toResourceFilterPermission(permissionFilter),
          pageNum: nextPageNum,
          pageSize: RESOURCE_PAGE_SIZE,
        });
        const rows = getResourceRows(res);
        const nextRows = parseMaybeArray(rows)
          .map((row) => normalizeOntologyResource(row, activeTab))
          .filter((item) => item.resourceBizType === 'VIEW' || item.resourceBizType === 'OBJECT');
        setResourceList((prev) => (append ? mergeResourceRows(prev, nextRows) : nextRows));
        setResourcePageNum(nextPageNum);
        setResourceHasMore(getPageHasMore(res, nextPageNum, RESOURCE_PAGE_SIZE, nextRows.length));
      } catch (error: any) {
        if (!append) {
          setResourceList([]);
          setResourcePageNum(1);
          setResourceHasMore(false);
        }
        message.error(error?.msg || error?.message || '本体资源查询失败');
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [activeTab, catalogId, keyword, ontologySystemCode, permissionFilter, statusFilter]
  );

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  const loadMoreResources = useCallback(() => {
    if (loading || loadingMore || !resourceHasMore || activeTab === 'enterpriseTerm') return;
    loadResources(resourcePageNum + 1, true);
  }, [activeTab, loadResources, loading, loadingMore, resourceHasMore, resourcePageNum]);

  const handleContainerScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      if (target.scrollHeight - target.scrollTop - target.clientHeight <= 180) {
        loadMoreResources();
      }
    },
    [loadMoreResources]
  );

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
  const showRefreshButton = activeTab === 'personal' || (activeTab === 'enterprise' && canRefreshEnterprise);

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
            systemCode: resource.systemCode || ontologySystemCode,
          }}
          baseId={resource.baseId}
          ownerType={resource.ownerType}
          systemCode={resource.systemCode || ontologySystemCode}
          showReference={false}
          onClose={() => clearDetailPanel?.()}
        />,
        { width: isView ? 380 : 350 }
      );
    },
    [clearDetailPanel, ontologySystemCode, setDetailPanel]
  );

  const handleRefresh = async () => {
    if (activeTab === 'enterpriseTerm') {
      message.info('企业术语正在建设中');
      return;
    }
    if (activeTab === 'enterprise' && !canRefreshEnterprise) {
      message.warning('只有 adminvip 可以刷新企业本体资源');
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
          systemCode: ontologySystemCode,
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

  const handleAuth = (resource: any, type: 'useAuth' | 'mgrAuth') => {
    setSelectedResource(resource);
    setAuthType(type);
    setAuthDrawerOpen(true);
  };

  const handleApplyUse = (resource: any) => {
    Modal.confirm({
      title: t('digitalEmployees.applyConfirm'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        await applyResourceUse({ resourceId: resource.resourceId });
        message.success(t('resource.applyUseSuccess'));
        await loadResources();
      },
    });
  };

  const handleAuditUse = (resource: any) => {
    setSelectedResource(resource);
    setUseApplyAuditOpen(true);
  };

  const installResource = async (resource: any) => {
    if (!activeSiderAgent?.resourceId) {
      message.error(t('resource.noDefaultDigitalEmployee'));
      return;
    }
    if (!resource?.resourceId) {
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
    async (view: any) => {
      const viewCode = view?.viewCode || view?.resourceCode;
      if (!viewCode) {
        message.error('当前视图缺少视图编码，无法查询对象列表');
        return;
      }
      const hideLoading = message.loading('对象列表加载中...', 0);
      try {
        const res: any = await listOntologyObjectsByView({
          viewCode,
          systemCode: view?.systemCode || ontologySystemCode,
        });
        const rows = findResourceRows(res).map((item: any) => ({
          ...item,
          objectCode: item.objectCode || item.object_code || item.resourceCode || item.code,
          objectName: item.objectName || item.object_name || item.resourceName || item.name,
          objectDesc: item.objectDesc || item.object_desc || item.resourceDesc || item.description || item.desc,
        }));
        openTablePanel({
          title: `${view.resourceName} / ${t('common.resourceType.object')}`,
          rowKey: (row: any) => row.objectCode,
          rows,
          columns: [
            { title: t('common.resourceType.object'), dataIndex: 'objectName', ellipsis: true },
            { title: t('ontologyCenter.detail.col.code'), dataIndex: 'objectCode', ellipsis: true },
            { title: t('common.desc'), dataIndex: 'objectDesc', ellipsis: true },
          ],
        });
      } catch (error: any) {
        message.error(error?.msg || error?.message || '对象列表查询失败');
      } finally {
        hideLoading();
      }
    },
    [ontologySystemCode, openTablePanel, t]
  );

  const showObjectActions = useCallback(
    async (object: any) => {
      const objectCode = object?.objectCode || object?.resourceCode;
      if (!objectCode) {
        message.error('当前对象缺少对象编码，无法查询动作列表');
        return;
      }
      const hideLoading = message.loading('动作列表加载中...', 0);
      try {
        const res: any = await getOntologyObjectDetail({
          objectCode,
          systemCode: object?.systemCode || ontologySystemCode,
        });
        const detail = getData(res);
        const rows = parseMaybeArray(detail?.actions).map((item: any) => ({
          ...item,
          actionCode: item.actionCode || item.action_code || item.code,
          actionName: item.actionName || item.action_name || item.name,
          actionDesc: item.actionDesc || item.action_desc || item.description || item.desc,
        }));
        openTablePanel({
          title: `${object.resourceName} / ${t('ontologyCenter.detail.actions')}`,
          rowKey: (row: any) => row.actionCode,
          rows,
          columns: [
            { title: t('ontologyCenter.detail.action.name'), dataIndex: 'actionName', ellipsis: true },
            { title: t('ontologyCenter.detail.col.code'), dataIndex: 'actionCode', ellipsis: true },
            { title: t('common.desc'), dataIndex: 'actionDesc', ellipsis: true },
          ],
        });
      } catch (error: any) {
        message.error(error?.msg || error?.message || '动作列表查询失败');
      } finally {
        hideLoading();
      }
    },
    [ontologySystemCode, openTablePanel, t]
  );

  const showObjectRelations = useCallback(
    async (object: any) => {
      const objectCode = object?.objectCode || object?.resourceCode;
      if (!objectCode) {
        message.error('当前对象缺少对象编码，无法查询关系列表');
        return;
      }
      const hideLoading = message.loading('关系列表加载中...', 0);
      try {
        const res: any = await listOntologyRelationsByObject({
          objectCode,
          systemCode: object?.systemCode || ontologySystemCode,
        });
        const rows = findResourceRows(res).map((item: any) => ({
          ...item,
          relationCode: item.relationCode || item.relation_code || item.code,
          relationName: item.relationName || item.relation_name || item.name,
          sourceObjectName: item.sourceObjectName || item.source_object_name,
          targetObjectName: item.targetObjectName || item.target_object_name,
          relationCardinality: item.relationCardinality || item.relation_cardinality,
          relationDesc: item.relationDesc || item.relation_desc || item.description || item.desc,
        }));
        openTablePanel({
          title: `${object.resourceName} / ${t('employeeDetail.ontology.relation')}`,
          rowKey: (row: any) => row.relationCode,
          rows,
          columns: [
            { title: t('ontologyCenter.detail.rel.name'), dataIndex: 'relationName', ellipsis: true },
            { title: t('ontologyCenter.detail.rel.source'), dataIndex: 'sourceObjectName', ellipsis: true },
            { title: t('ontologyCenter.detail.rel.target'), dataIndex: 'targetObjectName', ellipsis: true },
            { title: t('ontologyCenter.detail.rel.cardinality'), dataIndex: 'relationCardinality', width: 90 },
          ],
        });
      } catch (error: any) {
        message.error(error?.msg || error?.message || '关系列表查询失败');
      } finally {
        hideLoading();
      }
    },
    [ontologySystemCode, openTablePanel, t]
  );

  const renderSyncBatchStatus = (batch: SyncBatch) => {
    if (batch.status === 'running') return '进行中';
    if (batch.status === 'done') return `已完成（新增 ${batch.created || 0}，更新 ${batch.updated || 0}）`;
    if (batch.status === 'failed') return '失败';
    return '未开始';
  };

  const renderCardMenu = (resource: any) => {
    const items: any[] = [];
    if (resource?.canApplyUse) {
      items.push({ key: 'applyUse', label: t('resource.applyUse'), icon: <DatabaseOutlined /> });
    }
    if (resource?.canManageAuth) {
      items.push({ key: 'manageAuth', label: t('common.manageAuthorization'), icon: <LinkOutlined /> });
    }
    if (resource?.canUseAuth) {
      items.push({ key: 'useAuth', label: t('common.useAuthorization'), icon: <EyeOutlined /> });
    }
    if (resource?.canAuditUse) {
      items.push({ key: 'auditUse', label: t('resource.auditUse'), icon: <ApiOutlined /> });
    }

    return {
      items,
      onClick: ({ key, domEvent }: any) => {
        domEvent?.stopPropagation?.();
        if (key === 'applyUse') handleApplyUse(resource);
        if (key === 'manageAuth') handleAuth(resource, 'mgrAuth');
        if (key === 'useAuth') handleAuth(resource, 'useAuth');
        if (key === 'auditUse') handleAuditUse(resource);
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
      <>
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
                      <span
                        className={classnames(styles.cardTypeTag, isView ? styles.viewTypeTag : styles.objectTypeTag)}
                      >
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
                  {renderCardMenu(resource).items.length ? (
                    <Dropdown trigger={['click']} menu={renderCardMenu(resource)}>
                      <Button
                        type="text"
                        className={styles.cardMenu}
                        icon={<EllipsisOutlined />}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {visibleResources.length > 0 && (
          <div className={styles.loadMoreStatus}>
            {loadingMore ? <Spin size="small" /> : resourceHasMore ? '下拉加载更多' : '已加载全部'}
          </div>
        )}
      </>
    );
  };

  return (
    <div className={styles.container} onScroll={handleContainerScroll}>
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
            {showRefreshButton && (
              <Button type="primary" icon={<ReloadOutlined />} loading={loading || syncing} onClick={handleRefresh}>
                {t('common.refresh')}
              </Button>
            )}
            <Select
              className={styles.providerSelect}
              value={ontologySystemCode}
              options={ONTOLOGY_SYSTEM_OPTIONS}
              onChange={(value) => {
                setOntologySystemCode(value);
                setResourceList([]);
                setResourcePageNum(1);
                setResourceHasMore(false);
              }}
            />
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

      {authDrawerOpen && (
        <AuthListDrawer
          authType={authType}
          record={selectedResource}
          onCancel={() => {
            setAuthDrawerOpen(false);
            setSelectedResource(null);
          }}
          onSuccess={loadResources}
          authApiPath={`/byaiService/auth/privilegeGrant/${
            authType === 'useAuth' ? 'setResourceUsers' : 'setResourceManagers'
          }`}
          headerInfo={{
            title: selectedResource?.resourceName,
            content: selectedResource?.resourceDesc,
            icon: (
              <div
                className={classnames(
                  styles.cardIcon,
                  selectedResource?.resourceBizType === 'VIEW' ? styles.viewIcon : styles.objectIcon
                )}
              >
                <AntdIcon type={selectedResource?.resourceBizType === 'VIEW' ? 'icon-a-yemian-line' : 'icon-tongxun'} />
              </div>
            ),
          }}
        />
      )}
      <UseApplyAuditDrawer
        open={useApplyAuditOpen}
        record={selectedResource}
        onCancel={() => {
          setUseApplyAuditOpen(false);
          setSelectedResource(null);
        }}
        onSuccess={loadResources}
      />
    </div>
  );
};

export default OntologyCenter;
