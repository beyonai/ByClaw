// @ts-nocheck
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { App, Dropdown, Empty, Input, Select, Spin, Tooltip } from 'antd';
import { EllipsisOutlined, SearchOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import { trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { DragType } from '@/components/QueryInput/withDrag';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import { findDetailsById } from '@/pages/manager/service/DigitalEmployeeMgr';
import { unbindOntologyResource } from '@/service/ontology';
import OntologyNodeDrawer from '@/pages/ontologyCenter/OntologyNodeDrawer';
import useGlobal from '@/hooks/useGlobal';
import commonStyles from '@/layout/sider/components/Knowledge/components/common.module.less';
import chromeStyles from '@/layout/sider/components/ResourceSiderPanel/index.module.less';
import styles from './index.module.less';

const getData = (res: any) => res?.data ?? res ?? {};
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

/**
 * 本体 sider 面板：直接展示当前数字员工已安装的视图 / 对象节点。
 * 单击节点名看详情、双击引用到对话，三点菜单支持详情/卸载。
 */
const OntologySiderPanel: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { modal, message } = App.useApp();
  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);
  const activeSiderAgent = useActiveSiderAgent();
  const isOntologyCenterPage = pathname.startsWith('/ontologyCenter');
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
          onReference={() => quoteLeafToChat(leaf)}
          onClose={() => clearDetailPanel?.()}
        />,
        { width: 350 }
      );
    },
    [clearDetailPanel, quoteLeafToChat, setDetailPanel]
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
          <span className={styles.nodeIcon}>
            <AntdIcon type={NODE_ICON[node.nodeType] || NODE_ICON.object} />
          </span>
          <span className={styles.leafTitle}>
            <Tooltip title={node.leaf?.code ? `${node.title}（${node.leaf.code}）` : node.title}>
              <span className={styles.leafName}>{node.title}</span>
            </Tooltip>
            <span className={styles.typeTag}>
              <span className={styles.typeTagText}>{typeLabel(node.nodeType)}</span>
            </span>
          </span>
          <Dropdown
            trigger={['hover']}
            menu={{
              items: [
                { key: 'detail', label: intl.formatMessage({ id: 'common.detail' }) },
                { key: 'unbind', label: intl.formatMessage({ id: 'ontologySider.unbind' }) },
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key === 'detail') openLeafDetail(node.leaf);
                else handleUnbind(node.leaf);
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
    [handleNodeClick, handleNodeDoubleClick, handleUnbind, intl, openLeafDetail, typeLabel]
  );

  return (
    <div className={`${chromeStyles.container} ${chromeStyles.ontologySiderContainer}`}>
      <ActiveSiderAgentBar agent={activeSiderAgent} />
      <div
        className={chromeStyles.router}
        onClick={() =>
          navigate(
            isOntologyCenterPage ? { pathname: '/chat' } : '/ontologyCenter',
            isOntologyCenterPage ? { state: { keepSiderActiveKey: 'ontology' } } : undefined
          )
        }
      >
        <AntdIcon type="icon-a-Boxhezioutline" />
        <span className={chromeStyles.middle}>{intl.formatMessage({ id: 'sider.ontologyCenter' })}</span>
        <AntdIcon
          type={isOntologyCenterPage ? 'icon-a-Leftzuo' : 'icon-a-Rightyou'}
          className={chromeStyles.routerIcon}
        />
      </div>

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
