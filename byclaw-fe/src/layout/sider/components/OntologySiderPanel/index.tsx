// @ts-nocheck
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Dropdown, Empty, Input, Select, Spin, Table, Tooltip } from 'antd';
import { CloseOutlined, EllipsisOutlined, SearchOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import { trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { DragType } from '@/components/QueryInput/withDrag';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import useResourceCenterRouter from '@/layout/sider/components/useResourceCenterRouter';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import { findDetailsById } from '@/pages/manager/service/DigitalEmployeeMgr';
import {
  getOntologyObjectDetail,
  listOntologyObjectsByView,
  listOntologyRelationsByObject,
  unbindOntologyResource,
} from '@/service/ontology';
import OntologyNodeDrawer from '@/pages/ontologyCenter/OntologyNodeDrawer';
import useGlobal from '@/hooks/useGlobal';
import commonStyles from '@/layout/sider/components/Knowledge/components/common.module.less';
import chromeStyles from '@/layout/sider/components/ResourceSiderPanel/index.module.less';
import styles from './index.module.less';

const getData = (res: any) => res?.data ?? res ?? {};
const findRows = (source: any, depth = 0): any[] => {
  if (!source || depth > 4) return [];
  if (Array.isArray(source)) return source;
  for (const key of ['rows', 'list', 'records', 'items', 'content']) {
    if (Array.isArray(source?.[key])) return source[key];
  }
  for (const key of ['data', 'result', 'resultObject', 'page', 'pageData']) {
    const rows = findRows(source?.[key], depth + 1);
    if (rows.length) return rows;
  }
  return [];
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

type OntologyTab = 'view' | 'object';
type OntologyFilterType = 'all' | OntologyTab;

const TAB_BIZ_TYPE: Record<OntologyTab, string> = { view: 'VIEW', object: 'OBJECT' };

const NODE_ICON: Record<string, string> = {
  base: 'icon-a-Boxhezioutline',
  scene: 'icon-a-Folder-openwenjianjia-kai',
  view: 'icon-a-yemian-line',
  object: 'icon-tongxun',
};

const getEntryBizType = (entry: any) => {
  if (entry?.resourceBizType || entry?.resource_biz_type) {
    return `${entry.resourceBizType || entry.resource_biz_type}`.toUpperCase();
  }
  if (entry?.objectCode || entry?.object_code) return 'OBJECT';
  if (entry?.viewCode || entry?.view_code) return 'VIEW';
  return '';
};

const normalizeEntry = (entry: any = {}) => {
  const bizType = getEntryBizType(entry);
  const resourceId = entry.resourceId || entry.relResourceId;
  const resourceCode =
    entry.resourceCode ||
    entry.resource_code ||
    entry.viewCode ||
    entry.view_code ||
    entry.objectCode ||
    entry.object_code ||
    entry.code ||
    '';
  const resourceName =
    entry.resourceName ||
    entry.resource_name ||
    entry.viewName ||
    entry.view_name ||
    entry.objectName ||
    entry.object_name ||
    entry.name ||
    resourceCode;
  const baseId = entry.ontologyBaseCode || entry.baseId || entry.baseCode || '';
  return {
    ...entry,
    resourceId,
    resourceBizType: bizType,
    resourceCode,
    resourceName,
    name: entry.name || resourceName,
    code: entry.code || resourceCode,
    ontologyBaseCode: baseId,
    baseId,
    ontologyBaseName: entry.ontologyBaseName || entry.baseName,
    sceneId: entry.sceneId || entry.sceneCode,
    viewCode: bizType === 'VIEW' ? resourceCode : entry.viewCode || entry.view_code,
    viewName: bizType === 'VIEW' ? resourceName : entry.viewName || entry.view_name,
    objectCode: bizType === 'OBJECT' ? resourceCode : entry.objectCode || entry.object_code,
    objectName: bizType === 'OBJECT' ? resourceName : entry.objectName || entry.object_name,
    systemCode: entry.systemCode || entry.system_code,
  };
};

const entryIdentity = (entry: any) => {
  const normalized = normalizeEntry(entry);
  if (normalized.resourceId) return `ID:${normalized.resourceId}`;
  return [
    normalized.resourceBizType,
    normalized.ontologyBaseCode,
    normalized.sceneId,
    normalized.viewCode,
    normalized.objectCode,
    normalized.resourceCode,
  ]
    .filter((item) => item !== undefined && item !== null && item !== '')
    .join(':');
};

const mergeEntries = (baseEntries: any[] = [], extraEntries: any[] = []) => {
  const map = new Map<string, any>();
  [...baseEntries, ...extraEntries].map(normalizeEntry).forEach((entry) => {
    const key = entryIdentity(entry);
    if (key) map.set(key, { ...map.get(key), ...entry });
  });
  return Array.from(map.values());
};

const getResourceKey = (entry: any) => {
  const normalized = normalizeEntry(entry);
  if (normalized.resourceId) return `ID:${normalized.resourceId}`;
  const bizType = getEntryBizType(normalized);
  if (bizType === 'OBJECT') {
    return `OBJECT:${normalized.ontologyBaseCode || normalized.baseId || ''}:${normalized.sceneId || ''}:${
      normalized.viewCode || ''
    }:${normalized.objectCode || normalized.resourceCode || ''}`;
  }
  if (bizType === 'VIEW') {
    return `VIEW:${normalized.ontologyBaseCode || normalized.baseId || ''}:${normalized.sceneId || ''}:${
      normalized.viewCode || normalized.resourceCode || ''
    }`;
  }
  const fallback = entryIdentity(normalized) || normalized.resourceCode || '';
  return bizType || fallback ? `${bizType || 'RESOURCE'}:${fallback}` : '';
};

const getResourceKeys = (entry: any) => {
  const normalized = normalizeEntry(entry);
  const keys = new Set<string>();
  const key = getResourceKey(normalized);
  if (key) keys.add(key);
  if (normalized.resourceId) keys.add(`ID:${normalized.resourceId}`);
  return Array.from(keys);
};

const buildBoundEntries = (detail: any, optimisticEntries: any[] = []) => {
  const ontologyPathById = new Map<string, any>();
  parseMaybeArray(detail?.relOntology)
    .map(normalizeEntry)
    .forEach((entry) => {
      if (entry.resourceId) ontologyPathById.set(`${entry.resourceId}`, entry);
    });
  const relResources = parseMaybeArray(detail?.relResourceList)
    .map(normalizeEntry)
    .filter((entry) => ['VIEW', 'OBJECT'].includes(getEntryBizType(entry)))
    .map((entry) => {
      const path = ontologyPathById.get(`${entry.resourceId}`);
      if (!path) return entry;
      return normalizeEntry({
        ...entry,
        ontologyBaseCode: path.ontologyBaseCode || entry.ontologyBaseCode,
        ontologyBaseName: path.ontologyBaseName || entry.ontologyBaseName,
        ownerType: path.ownerType || entry.ownerType,
        sceneId: path.sceneId || entry.sceneId,
        sceneName: path.sceneName || entry.sceneName,
        viewCode: path.viewCode || entry.viewCode,
        viewName: path.viewName || entry.viewName,
        objectCode: path.objectCode || entry.objectCode,
        objectName: path.objectName || entry.objectName,
      });
    });
  const optimistic = optimisticEntries.map(normalizeEntry);
  return mergeEntries(relResources, optimistic).filter((entry) => ['VIEW', 'OBJECT'].includes(getEntryBizType(entry)));
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

/**
 * 本体 sider 面板：直接展示当前数字员工已安装的视图 / 对象节点。
 * 单击节点名看详情、双击引用到对话，三点菜单支持详情/卸载。
 */
interface OntologySiderPanelProps {
  embedded?: boolean;
  // 嵌入右侧资源面板时仅展示本体中心入口，不重复展示当前数字员工栏。
  showRouter?: boolean;
}

const OntologySiderPanel: React.FC<OntologySiderPanelProps> = ({ embedded = false, showRouter = false }) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { modal, message } = App.useApp();
  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);
  const activeSiderAgent = useActiveSiderAgent();
  // 右侧资源面板再次点击中心入口时返回原会话，并继续保留当前资源面板。
  const { isCenterPage: isOntologyCenterPage, toggleCenter } = useResourceCenterRouter(
    '/ontologyCenter',
    'ontology',
    showRouter
  );
  const clickTimerRef = useRef<number | null>(null);

  const [filterType, setFilterType] = useState<OntologyFilterType>('all');
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const deId = activeSiderAgent?.resourceId;

  // 拉取当前数字员工详情，relResourceList 给真实资源，relOntology 补充本体路径元数据。
  const loadBound = useCallback(
    async (optimisticEntries: any[] = []) => {
      if (!deId) {
        setEntries([]);
        return;
      }
      setLoading(true);
      try {
        const res: any = await findDetailsById({ resourceId: String(deId) });
        const detail = getData(res) || {};
        setEntries(buildBoundEntries(detail, optimisticEntries));
      } catch {
        setEntries((prev) => (optimisticEntries.length ? mergeEntries(prev, optimisticEntries) : []));
      } finally {
        setLoading(false);
      }
    },
    [deId]
  );

  useEffect(() => {
    setSearchValue('');
    loadBound();
  }, [loadBound]);

  // 其它处（绑定抽屉/配置页）保存后，刷新本面板
  useEffect(() => {
    const refreshBound = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      const optimisticEntries = parseMaybeArray(detail.entries || detail.entry).map(normalizeEntry);
      if (optimisticEntries.length) {
        setEntries((prev) => mergeEntries(prev, optimisticEntries));
      }
      loadBound(optimisticEntries);
      window.setTimeout(() => loadBound(optimisticEntries), 800);
    };

    const pendingDetail = (window as any).__latestOntologyBindSaved;
    if (pendingDetail?.openSider && Date.now() - Number(pendingDetail.receivedAt || 0) < 10000) {
      refreshBound(new CustomEvent('ontologySiderRefresh', { detail: pendingDetail }));
    }

    const reloadBound = () => loadBound();

    window.addEventListener('ontologyBindSaved', refreshBound);
    window.addEventListener('ontologySiderRefresh', refreshBound);
    window.addEventListener('digitalEmployeeResourceInstalled', reloadBound);
    return () => {
      window.removeEventListener('ontologyBindSaved', refreshBound);
      window.removeEventListener('ontologySiderRefresh', refreshBound);
      window.removeEventListener('digitalEmployeeResourceInstalled', reloadBound);
    };
  }, [loadBound]);

  useEffect(() => {
    const onResourceUninstalled = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      const keys = new Set(
        [detail.key, ...parseMaybeArray(detail.keys), ...getResourceKeys(detail.entry)].filter(Boolean)
      );
      if (!keys.size) return;
      setEntries((prev) => prev.filter((entry) => !getResourceKeys(entry).some((key) => keys.has(key))));
    };
    window.addEventListener('ontologyResourceUninstalled', onResourceUninstalled);
    return () => window.removeEventListener('ontologyResourceUninstalled', onResourceUninstalled);
  }, []);

  const clearClickTimer = useCallback(() => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);
  useEffect(() => () => clearClickTimer(), [clearClickTimer]);

  const typeLabel = useCallback((tab: OntologyTab) => intl.formatMessage({ id: `common.resourceType.${tab}` }), [intl]);

  // ============ 扁平列表：已安装视图 / 对象 ============
  const flatNodes = useMemo(() => {
    const kw = trim(searchValue).toLowerCase();

    return entries
      .map(normalizeEntry)
      .filter((e) => ['VIEW', 'OBJECT'].includes(getEntryBizType(e)))
      .filter((e) => filterType === 'all' || getEntryBizType(e) === TAB_BIZ_TYPE[filterType])
      .filter((e) => {
        const isView = getEntryBizType(e) === 'VIEW';
        const name = isView ? e.viewName || e.viewCode : e.objectName || e.objectCode;
        const code = isView ? e.viewCode : e.objectCode;
        return !kw || [name, code].some((t) => `${t || ''}`.toLowerCase().includes(kw));
      })
      .map((e) => {
        const isView = getEntryBizType(e) === 'VIEW';
        const name = isView ? e.viewName || e.viewCode : e.objectName || e.objectCode;
        const code = isView ? e.viewCode : e.objectCode;
        return {
          key: getResourceKey(e),
          title: name,
          nodeType: isView ? 'view' : 'object',
          leaf: {
            ...e,
            name,
            code,
            baseId: e.ontologyBaseCode || e.baseId,
            ownerType: e.ownerType || 'personal',
            level: isView ? 'VIEW' : e.viewCode ? 'OBJECT_IN_VIEW' : 'OBJECT_IN_SCENE',
          },
        };
      });
  }, [entries, filterType, searchValue]);

  const leafToDrawerNode = (leaf: any) => ({
    level: leaf.level,
    baseName: leaf.ontologyBaseName,
    sceneId: leaf.sceneId,
    sceneName: leaf.sceneName,
    viewCode: leaf.viewCode,
    viewName: leaf.viewName,
    objectCode: leaf.objectCode,
    objectName: leaf.objectName,
  });

  const quoteLeafToChat = useCallback(
    (leaf: any) => {
      if (!leaf) return;
      const quotePayload = {
        item: {
          ...leaf,
          isFromResourceModule: true,
          showQuotePrefix: true,
          ontologyBaseCode: leaf.baseId,
          resourceId: `${leaf.baseId || ''}:${leaf.resourceId}`,
          resourceName: leaf.name,
          resourceCode: leaf.code,
          resourceBizType: getEntryBizType(leaf),
        },
        type: DragType.OBJECT,
      };
      const emitQuote = (waitForListeners = false) => {
        EventEmitter?.emit(
          'queryInput-insert-item',
          { ...quotePayload },
          waitForListeners ? { waitForListeners: true } : undefined
        );
        message.success(intl.formatMessage({ id: 'search.referenceSuccess' }));
      };
      if (pathname !== '/chat') {
        setAgentId?.('');
        setSessionId?.('');
        navigate('/chat', { state: { keepSiderActiveKey: 'ontology' } });
        emitQuote(true);
        return;
      }
      emitQuote();
    },
    [EventEmitter, intl, message, navigate, pathname, setAgentId, setSessionId]
  );

  const openLeafDetail = useCallback(
    (leaf: any) => {
      if (!leaf) return;
      setDetailPanel?.(
        <OntologyNodeDrawer
          open
          panel
          node={leafToDrawerNode(leaf)}
          baseId={leaf.baseId}
          ownerType={leaf.ownerType}
          systemCode={leaf.systemCode}
          onReference={() => quoteLeafToChat(leaf)}
          onClose={() => clearDetailPanel?.()}
        />,
        {
          width: 350,
          tabKey: `ontology:${leaf.resourceId || leaf.viewCode || leaf.objectCode || leaf.code}`,
          title: leaf.name || leaf.resourceName || leaf.objectName,
        }
      );
    },
    [clearDetailPanel, quoteLeafToChat, setDetailPanel]
  );

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
        { width, tabKey: `ontology-table:${title}`, title }
      );
    },
    [clearDetailPanel, setDetailPanel]
  );

  const showViewObjects = useCallback(
    async (leaf: any) => {
      const viewCode = leaf?.viewCode || leaf?.resourceCode || leaf?.code;
      if (!viewCode) {
        message.error('当前视图缺少视图编码，无法查询对象列表');
        return;
      }
      const hideLoading = message.loading('对象列表加载中...', 0);
      try {
        const res: any = await listOntologyObjectsByView({ viewCode, systemCode: leaf?.systemCode });
        const rows = findRows(getData(res)).map((item: any) => ({
          ...item,
          objectCode: item.objectCode || item.object_code || item.resourceCode || item.code,
          objectName: item.objectName || item.object_name || item.resourceName || item.name,
          objectDesc: item.objectDesc || item.object_desc || item.resourceDesc || item.description || item.desc,
        }));
        openTablePanel({
          title: `${leaf.name || leaf.resourceName || viewCode} / ${intl.formatMessage({
            id: 'common.resourceType.object',
          })}`,
          rowKey: (row: any) => row.objectCode,
          rows,
          columns: [
            {
              title: intl.formatMessage({ id: 'common.resourceType.object' }),
              dataIndex: 'objectName',
              ellipsis: true,
            },
            {
              title: intl.formatMessage({ id: 'ontologyCenter.detail.col.code' }),
              dataIndex: 'objectCode',
              ellipsis: true,
            },
            { title: intl.formatMessage({ id: 'common.desc' }), dataIndex: 'objectDesc', ellipsis: true },
          ],
        });
      } catch (error: any) {
        message.error(error?.msg || error?.message || '对象列表查询失败');
      } finally {
        hideLoading();
      }
    },
    [intl, message, openTablePanel]
  );

  const showObjectActions = useCallback(
    async (leaf: any) => {
      const objectCode = leaf?.objectCode || leaf?.resourceCode || leaf?.code;
      if (!objectCode) {
        message.error('当前对象缺少对象编码，无法查询动作列表');
        return;
      }
      const hideLoading = message.loading('动作列表加载中...', 0);
      try {
        const res: any = await getOntologyObjectDetail({ objectCode, systemCode: leaf?.systemCode });
        const detail = getData(res);
        const rows = parseMaybeArray(detail?.actions).map((item: any) => ({
          ...item,
          actionCode: item.actionCode || item.action_code || item.code,
          actionName: item.actionName || item.action_name || item.name,
          actionDesc: item.actionDesc || item.action_desc || item.description || item.desc,
        }));
        openTablePanel({
          title: `${leaf.name || leaf.resourceName || objectCode} / ${intl.formatMessage({
            id: 'ontologyCenter.detail.actions',
          })}`,
          rowKey: (row: any, index: number) => row.actionCode || `${index}`,
          rows,
          columns: [
            {
              title: intl.formatMessage({ id: 'ontologyCenter.detail.action.name' }),
              dataIndex: 'actionName',
              ellipsis: true,
            },
            {
              title: intl.formatMessage({ id: 'ontologyCenter.detail.col.code' }),
              dataIndex: 'actionCode',
              ellipsis: true,
            },
            { title: intl.formatMessage({ id: 'common.desc' }), dataIndex: 'actionDesc', ellipsis: true },
          ],
        });
      } catch (error: any) {
        message.error(error?.msg || error?.message || '动作列表查询失败');
      } finally {
        hideLoading();
      }
    },
    [intl, message, openTablePanel]
  );

  const showObjectRelations = useCallback(
    async (leaf: any) => {
      const objectCode = leaf?.objectCode || leaf?.resourceCode || leaf?.code;
      if (!objectCode) {
        message.error('当前对象缺少对象编码，无法查询关系列表');
        return;
      }
      const hideLoading = message.loading('关系列表加载中...', 0);
      try {
        const res: any = await listOntologyRelationsByObject({ objectCode, systemCode: leaf?.systemCode });
        const rows = findRows(getData(res)).map((item: any) => ({
          ...item,
          relationCode: item.relationCode || item.relation_code || item.code,
          relationName: item.relationName || item.relation_name || item.name,
          sourceObjectName: item.sourceObjectName || item.source_object_name,
          targetObjectName: item.targetObjectName || item.target_object_name,
          relationCardinality: item.relationCardinality || item.relation_cardinality,
        }));
        openTablePanel({
          title: `${leaf.name || leaf.resourceName || objectCode} / ${intl.formatMessage({
            id: 'employeeDetail.ontology.relation',
          })}`,
          rowKey: (row: any, index: number) =>
            row.relationCode || `${row.sourceObjectName || ''}-${row.targetObjectName || ''}-${index}`,
          rows,
          columns: [
            {
              title: intl.formatMessage({ id: 'ontologyCenter.detail.rel.name' }),
              dataIndex: 'relationName',
              ellipsis: true,
            },
            {
              title: intl.formatMessage({ id: 'ontologyCenter.detail.rel.source' }),
              dataIndex: 'sourceObjectName',
              ellipsis: true,
            },
            {
              title: intl.formatMessage({ id: 'ontologyCenter.detail.rel.target' }),
              dataIndex: 'targetObjectName',
              ellipsis: true,
            },
            {
              title: intl.formatMessage({ id: 'ontologyCenter.detail.rel.cardinality' }),
              dataIndex: 'relationCardinality',
              width: 90,
            },
          ],
        });
      } catch (error: any) {
        message.error(error?.msg || error?.message || '关系列表查询失败');
      } finally {
        hideLoading();
      }
    },
    [intl, message, openTablePanel]
  );

  const handleUnbind = useCallback(
    (leaf: any) => {
      if (!leaf) return;
      modal.confirm({
        title: intl.formatMessage({ id: 'ontologySider.unbindConfirm' }, { name: leaf.name }),
        onOk: async () => {
          try {
            const relResourceId = leaf.resourceId || leaf.relResourceId;
            if (!deId || !relResourceId) {
              message.error('当前资源缺少真实绑定关系，无法卸载');
              return;
            }
            const res: any = await unbindOntologyResource({ digitalEmployeeId: deId, relResourceId });
            if (res && res.code !== undefined && res.code !== 0 && res.code !== 200) {
              message.error(res.msg || res.message || intl.formatMessage({ id: 'common.operationFailed' }));
              return;
            }
            message.success(intl.formatMessage({ id: 'ontologySider.unbindSuccess' }));
            clearDetailPanel?.();
            const key = getResourceKey(leaf);
            const keys = getResourceKeys(leaf);
            setEntries((prev) => prev.filter((entry) => !getResourceKeys(entry).some((item) => keys.includes(item))));
            window.dispatchEvent(
              new CustomEvent('ontologyResourceUninstalled', { detail: { key, keys, entry: leaf } })
            );
            await loadBound();
          } catch (error: any) {
            message.error(error?.message || error || intl.formatMessage({ id: 'common.operationFailed' }));
          }
        },
      });
    },
    [clearDetailPanel, deId, intl, loadBound, message, modal]
  );

  const handleNodeClick = useCallback(
    (leaf: any) => {
      clearClickTimer();
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        openLeafDetail(leaf);
      }, 220);
    },
    [clearClickTimer, openLeafDetail]
  );

  const handleNodeDoubleClick = useCallback(
    (leaf: any) => {
      clearClickTimer();
      quoteLeafToChat(leaf);
    },
    [clearClickTimer, quoteLeafToChat]
  );

  const renderNode = useCallback(
    (node: any) => {
      const bizItems = [];
      if (node.nodeType === 'view') {
        bizItems.push({ key: 'objects', label: intl.formatMessage({ id: 'ontologyCenter.action.viewObjects' }) });
      } else {
        bizItems.push(
          { key: 'actions', label: intl.formatMessage({ id: 'ontologyCenter.action.viewActions' }) },
          { key: 'relations', label: intl.formatMessage({ id: 'ontologyCenter.action.viewRelations' }) }
        );
      }
      const menuItems = [
        { key: 'detail', label: intl.formatMessage({ id: 'common.detail' }) },
        ...bizItems,
        { key: 'unbind', label: intl.formatMessage({ id: 'ontologySider.unbind' }) },
      ];
      return (
        <div
          key={node.key}
          className={styles.nodeRow}
          tabIndex={0}
          onClick={() => handleNodeClick(node.leaf)}
          onDoubleClick={() => handleNodeDoubleClick(node.leaf)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              openLeafDetail(node.leaf);
            }
          }}
        >
          <span
            className={classnames(
              styles.nodeIcon,
              node.nodeType === 'view' ? styles.viewResourceIcon : styles.objectResourceIcon
            )}
          >
            <AntdIcon type={NODE_ICON[node.nodeType] || NODE_ICON.object} />
          </span>
          <span className={styles.leafTitle}>
            <Tooltip title={node.leaf?.code ? `${node.title}（${node.leaf.code}）` : node.title}>
              <span className={styles.leafName}>{node.title}</span>
            </Tooltip>
            <span
              className={classnames(
                styles.typeTag,
                node.nodeType === 'view' ? styles.viewTypeTag : styles.objectTypeTag
              )}
            >
              <span className={styles.typeTagText}>{typeLabel(node.nodeType)}</span>
            </span>
          </span>
          <Dropdown
            trigger={['hover']}
            menu={{
              items: menuItems,
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key === 'detail') openLeafDetail(node.leaf);
                if (key === 'objects') showViewObjects(node.leaf);
                if (key === 'actions') showObjectActions(node.leaf);
                if (key === 'relations') showObjectRelations(node.leaf);
                if (key === 'unbind') handleUnbind(node.leaf);
              },
            }}
          >
            <EllipsisOutlined
              className={classnames(commonStyles.treeActionIcon, styles.nodeAction)}
              aria-label={intl.formatMessage({ id: 'ontologySider.unbind' })}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
            />
          </Dropdown>
        </div>
      );
    },
    [
      handleNodeClick,
      handleNodeDoubleClick,
      handleUnbind,
      intl,
      openLeafDetail,
      showObjectActions,
      showObjectRelations,
      showViewObjects,
      typeLabel,
    ]
  );

  return (
    <div className={`${chromeStyles.container} ${chromeStyles.ontologySiderContainer}`}>
      {(!embedded || showRouter) && (
        <>
          {!embedded && <ActiveSiderAgentBar agent={activeSiderAgent} />}
          <div
            className={[chromeStyles.router, showRouter ? chromeStyles.routerSplit : ''].filter(Boolean).join(' ')}
            onClick={toggleCenter}
          >
            {showRouter && (
              <AntdIcon
                type={isOntologyCenterPage ? 'icon-a-Rightyou' : 'icon-a-Leftzuo'}
                className={chromeStyles.routerBackIcon}
              />
            )}
            <div className={chromeStyles.routerMain}>
              <span className={chromeStyles.middle}>{intl.formatMessage({ id: 'sider.ontologyCenter' })}</span>
              <AntdIcon type="icon-a-Boxhezioutline" />
            </div>
            {!showRouter && (
              <AntdIcon
                type={isOntologyCenterPage ? 'icon-a-Leftzuo' : 'icon-a-Rightyou'}
                className={chromeStyles.routerIcon}
              />
            )}
          </div>
        </>
      )}

      <Input
        className={styles.search}
        value={searchValue}
        allowClear
        addonBefore={
          <Select
            className={styles.searchTypeSelect}
            value={filterType}
            options={[
              { value: 'all', label: intl.formatMessage({ id: 'common.all' }) },
              { value: 'view', label: typeLabel('view') },
              { value: 'object', label: typeLabel('object') },
            ]}
            onChange={(value) => setFilterType(value)}
          />
        }
        suffix={<SearchOutlined />}
        placeholder={intl.formatMessage({ id: 'ontologySider.searchPlaceholder' })}
        onChange={(e) => setSearchValue(e.target.value)}
      />

      <Spin spinning={loading} wrapperClassName={classnames(commonStyles.listSpinner, styles.treeSpin)}>
        <div className={styles.treeRegion}>
          {!loading && flatNodes.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'common.noData' })} />
          ) : (
            <div className={styles.nodeList}>{flatNodes.map(renderNode)}</div>
          )}
        </div>
      </Spin>
    </div>
  );
};

export default OntologySiderPanel;
