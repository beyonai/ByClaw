import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { DEFAULT_ONTOLOGY_SYSTEM_CODE, pageOntologyResources } from '@/service/ontology';
import { queryCatalogTree } from '@/service/digitalEmployees';
import { CloseOutlined, DatabaseOutlined, EyeOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Checkbox, Drawer, Empty, Input, Select, Space, Spin, Tabs, Tag, Tooltip, message } from 'antd';
import classnames from 'classnames';
import styles from './OntologyResourceSelectorDrawer.module.less';

const ALL_CATALOG_ID = '-1';
const ALL_RESOURCE_TYPE = 'ALL';
const ONTOLOGY_RESOURCE_TYPES = ['VIEW', 'OBJECT'];
const RESOURCE_PAGE_SIZE = 30;

const OWNER_TABS = [
  { key: 'personal', label: '个人本体' },
  { key: 'enterprise', label: '企业本体' },
];
const ONTOLOGY_SYSTEM_OPTIONS = [
  { label: '百应内置本体库', value: 'BYCLAW_DATACLOUD' },
  { label: '智能体本体库', value: 'WHALE_AGENT' },
];

const getResponseData = (res: any) => res?.data ?? res;

const extractList = (res: any) => {
  const data = getResponseData(res);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.records)) return data.data.records;
  if (Array.isArray(data?.data?.list)) return data.data.list;
  return [];
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
  const data = getResponseData(res);
  const meta = findPageMeta(data);
  if (typeof meta.hasMore === 'boolean') return meta.hasMore;
  const total = Number(meta.total ?? data?.total ?? 0);
  const totalPages = Number(meta.totalPages ?? meta.pages ?? meta.pageCount ?? 0);
  if (totalPages > 0) return pageNum < totalPages;
  if (total > 0) return pageNum * pageSize < total;
  return rowCount >= pageSize;
};

const getCatalogParentId = (item: any) =>
  item?.pcatalogId ?? item?.pCatalogId ?? item?.parentCatalogId ?? item?.parentDirId;

const getCatalogValue = (item: any) =>
  item?.sceneCode ?? item?.catalogCode ?? item?.code ?? item?.resourceCode ?? item?.sceneId ?? item?.catalogId;

const getCatalogName = (item: any) => item?.catalogName ?? item?.dirName ?? item?.name ?? item?.label ?? item?.title;

const getDisplayCatalogs = (list: any[] = []) => {
  if (!Array.isArray(list) || list.length === 0) return [];
  if (list.some((item) => Array.isArray(item?.children) && item.children.length > 0)) return list;

  const idSet = new Set(list.map((item) => `${item?.catalogId}`));
  return list.filter((item) => {
    const parentId = getCatalogParentId(item);
    return parentId === undefined || parentId === null || !idSet.has(`${parentId}`);
  });
};

const normalizeCatalogTree = (nodes: any[] = []) =>
  getDisplayCatalogs(nodes)
    .map((item) => {
      const catalogId = getCatalogValue(item);
      const catalogName = getCatalogName(item);
      if (catalogId === undefined || catalogId === null || catalogId === '' || !catalogName) return null;
      return { catalogId: `${catalogId}`, catalogName };
    })
    .filter(Boolean);

const getResourceType = (item: any) =>
  `${item?.grantResourceType || item?.resourceBizType || item?.type || ''}`.toUpperCase();

export const normalizeOntologyResource = (item: any = {}, fallbackOwnerType?: string) => {
  const resourceBizType = getResourceType(item);
  const resourceCode =
    item?.resourceCode ||
    item?.viewCode ||
    item?.objectCode ||
    item?.code ||
    item?.ontologyCode ||
    item?.relResourceCode ||
    '';
  const resourceName =
    item?.resourceName || item?.viewName || item?.objectName || item?.name || item?.ontologyName || resourceCode;
  return {
    ...item,
    resourceId: item?.resourceId ?? item?.relResourceId ?? item?.id,
    resourceBizType,
    grantResourceType: resourceBizType,
    resourceCode,
    resourceName,
    description: item?.description ?? item?.resourceDesc ?? item?.viewDesc ?? item?.objectDesc ?? item?.remark ?? '',
    ownerType: item?.ownerType || fallbackOwnerType,
  };
};

const getResourceKey = (item: any) => {
  const resourceId = item?.resourceId ?? item?.relResourceId ?? item?.id;
  if (resourceId !== undefined && resourceId !== null && resourceId !== '') {
    return `${resourceId}`;
  }
  return `${getResourceType(item)}:${item?.resourceCode || item?.viewCode || item?.objectCode || ''}`;
};

const mergeResources = (prev: any[], next: any[]) => {
  const merged = new Map<string, any>();
  [...prev, ...next].forEach((item) => {
    const key = getResourceKey(item);
    if (key) {
      merged.set(key, item);
    }
  });
  return Array.from(merged.values());
};

const getResourceTypeLabel = (type: string) => (type === 'VIEW' ? '视图' : type === 'OBJECT' ? '对象' : '本体资源');
const isViewResource = (type: string) => type === 'VIEW';

const OntologyResourceSelectorDrawer = ({
  open,
  ownerType = 'personal',
  selectedResources = [],
  onCancel,
  onOk,
}: any) => {
  const [activeOwnerType, setActiveOwnerType] = useState(ownerType === 'enterprise' ? 'enterprise' : 'personal');
  const [resourceType, setResourceType] = useState(ALL_RESOURCE_TYPE);
  const [keyword, setKeyword] = useState('');
  const [catalogId, setCatalogId] = useState(ALL_CATALOG_ID);
  const [ontologySystemCode, setOntologySystemCode] = useState(DEFAULT_ONTOLOGY_SYSTEM_CODE);
  const [catalogs, setCatalogs] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [resourcePageNum, setResourcePageNum] = useState(1);
  const [resourceHasMore, setResourceHasMore] = useState(false);
  const [initialSelectedMap, setInitialSelectedMap] = useState<Record<string, any>>({});
  const [selectedMap, setSelectedMap] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!open) return;
    const initialMap = selectedResources.reduce((acc: Record<string, any>, item: any) => {
      const normalized = normalizeOntologyResource(item, ownerType);
      acc[getResourceKey(normalized)] = normalized;
      return acc;
    }, {});
    setInitialSelectedMap(initialMap);
    setSelectedMap(initialMap);
    setActiveOwnerType(ownerType === 'enterprise' ? 'enterprise' : 'personal');
    setOntologySystemCode(DEFAULT_ONTOLOGY_SYSTEM_CODE);
  }, [open, ownerType, selectedResources]);

  useEffect(() => {
    if (!open) return;
    queryCatalogTree({ catalogType: '6' })
      .then((res: any) => {
        setCatalogs(normalizeCatalogTree(extractList(res)));
      })
      .catch(() => {
        setCatalogs([]);
      });
  }, [open]);

  const fetchResources = useCallback(
    async (nextPageNum = 1, append = false) => {
      if (!open) return;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      try {
        const res = await pageOntologyResources({
          ownerType: activeOwnerType,
          resourceBizTypeList: resourceType === ALL_RESOURCE_TYPE ? ONTOLOGY_RESOURCE_TYPES : [resourceType],
          systemCode: ontologySystemCode,
          keyword,
          catalogId,
          statusList: [2],
          permission: 'all',
          pageNum: nextPageNum,
          pageSize: RESOURCE_PAGE_SIZE,
        });
        const list = extractList(res)
          .map((item) => normalizeOntologyResource(item, activeOwnerType))
          .filter((item) => ONTOLOGY_RESOURCE_TYPES.includes(item.resourceBizType));
        setResources((prev) => (append ? mergeResources(prev, list) : list));
        setResourcePageNum(nextPageNum);
        setResourceHasMore(getPageHasMore(res, nextPageNum, RESOURCE_PAGE_SIZE, list.length));
      } catch (error) {
        if (!append) {
          setResources([]);
          setResourcePageNum(1);
          setResourceHasMore(false);
        }
        message.error('本体资源查询失败');
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [activeOwnerType, catalogId, keyword, ontologySystemCode, open, resourceType]
  );

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  const loadMoreResources = useCallback(() => {
    if (loading || loadingMore || !resourceHasMore) return;
    fetchResources(resourcePageNum + 1, true);
  }, [fetchResources, loading, loadingMore, resourceHasMore, resourcePageNum]);

  const handleResourceListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      if (target.scrollHeight - target.scrollTop - target.clientHeight <= 120) {
        loadMoreResources();
      }
    },
    [loadMoreResources]
  );

  const selectedList = useMemo(() => Object.values(selectedMap), [selectedMap]);
  const initialSelectedList = useMemo(() => Object.values(initialSelectedMap), [initialSelectedMap]);
  const selectedKeys = useMemo(() => new Set(Object.keys(selectedMap)), [selectedMap]);
  const addedCount = useMemo(
    () => Object.keys(selectedMap).filter((key) => !initialSelectedMap[key]).length,
    [initialSelectedMap, selectedMap]
  );
  const removedCount = useMemo(
    () => Object.keys(initialSelectedMap).filter((key) => !selectedMap[key]).length,
    [initialSelectedMap, selectedMap]
  );
  const selectedTotals = useMemo(
    () =>
      selectedList.reduce(
        (acc, item: any) => ({
          views: acc.views + (item.resourceBizType === 'VIEW' ? 1 : 0),
          objects: acc.objects + (item.resourceBizType === 'OBJECT' ? 1 : 0),
        }),
        { views: 0, objects: 0 }
      ),
    [selectedList]
  );
  const initialCount = initialSelectedList.length;

  const toggleResource = (item: any, checked: boolean) => {
    const key = getResourceKey(item);
    setSelectedMap((prev) => {
      const next = { ...prev };
      if (checked) {
        next[key] = item;
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const renderResourceTypeTag = (type: string) => (
    <Tag className={classnames(styles.typeTag, isViewResource(type) ? styles.viewTypeTag : styles.objectTypeTag)}>
      {getResourceTypeLabel(type)}
    </Tag>
  );

  const catalogOptions = useMemo(
    () => [
      { value: ALL_CATALOG_ID, label: '全部分类' },
      ...catalogs.map((catalog) => ({ value: catalog.catalogId, label: catalog.catalogName })),
    ],
    [catalogs]
  );

  return (
    <Drawer
      open={open}
      title="为数字员工添加本体资源"
      width={1040}
      destroyOnClose
      onClose={onCancel}
      footer={
        <div className={styles.footer}>
          <div className={styles.changeSummary}>
            <span>
              已选 <strong>{selectedList.length}</strong> 个
            </span>
            <span>新增 {addedCount} 个</span>
            <span>移除 {removedCount} 个</span>
          </div>
          <Space>
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" onClick={() => onOk?.(selectedList)}>
              确定
            </Button>
          </Space>
        </div>
      }
    >
      <div className={styles.drawerBody}>
        <Tabs activeKey={activeOwnerType} items={OWNER_TABS} onChange={setActiveOwnerType} />
        <div className={styles.toolbar}>
          <Select
            value={resourceType}
            style={{ width: 118 }}
            onChange={setResourceType}
            options={[
              { value: ALL_RESOURCE_TYPE, label: '全部类型' },
              { value: 'VIEW', label: '视图' },
              { value: 'OBJECT', label: '对象' },
            ]}
          />
          <Select value={catalogId} className={styles.catalogSelect} onChange={setCatalogId} options={catalogOptions} />
          <Select
            value={ontologySystemCode}
            className={styles.providerSelect}
            onChange={setOntologySystemCode}
            options={ONTOLOGY_SYSTEM_OPTIONS}
          />
          <Input
            allowClear
            className={styles.toolbarSearch}
            prefix={<SearchOutlined />}
            placeholder="请输入视图或对象名称、编码"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={fetchResources}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={fetchResources} />
        </div>
        <div className={styles.contentGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.panelTitle}>可添加资源</div>
                <div className={styles.panelHint}>筛选并勾选要新增到数字员工的视图或对象</div>
              </div>
              <Tag className={styles.countTag}>{resources.length} 个结果</Tag>
            </div>
            <div className={styles.listWrap} onScroll={handleResourceListScroll}>
              <Spin spinning={loading}>
                {resources.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可选本体资源" />
                ) : (
                  <div className={styles.resourceList}>
                    {resources.map((item) => {
                      const key = getResourceKey(item);
                      const checked = selectedKeys.has(key);
                      const isView = item.resourceBizType === 'VIEW';
                      return (
                        <div
                          className={classnames(styles.resourceItem, { [styles.resourceItemSelected]: checked })}
                          key={key}
                          onDoubleClick={() => toggleResource(item, !checked)}
                        >
                          <Checkbox
                            checked={checked}
                            onChange={(event) => toggleResource(item, event.target.checked)}
                          />
                          <div
                            className={classnames(
                              styles.resourceIcon,
                              isView ? styles.viewResourceIcon : styles.objectResourceIcon
                            )}
                          >
                            {isView ? <EyeOutlined /> : <DatabaseOutlined />}
                          </div>
                          <div className={styles.resourceMain}>
                            <div className={styles.resourceTitleRow}>
                              <span className={styles.resourceName} title={item.resourceName}>
                                {item.resourceName}
                              </span>
                              {renderResourceTypeTag(item.resourceBizType)}
                              {checked && <Tag className={styles.boundTag}>已选</Tag>}
                            </div>
                            <div className={styles.resourceCode}>{item.resourceCode}</div>
                            {item.description && <div className={styles.resourceDesc}>{item.description}</div>}
                            {item.catalogName && (
                              <div className={styles.resourceMeta}>
                                <Tag>{item.catalogName}</Tag>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div className={styles.loadMoreStatus}>
                      {loadingMore ? <Spin size="small" /> : resourceHasMore ? '下拉加载更多' : '已加载全部'}
                    </div>
                  </div>
                )}
              </Spin>
            </div>
          </section>
          <aside className={styles.boundPanel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.panelTitle}>已绑定资源</div>
                <div className={styles.panelHint}>
                  视图 {selectedTotals.views} / 对象 {selectedTotals.objects}
                </div>
              </div>
              <Tag className={styles.countTag}>{selectedList.length} 个</Tag>
            </div>
            <div className={styles.boundList}>
              {selectedList.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未选择本体资源" />
              ) : (
                selectedList.map((item: any) => {
                  const key = getResourceKey(item);
                  const isNew = !initialSelectedMap[key];
                  const isView = item.resourceBizType === 'VIEW';
                  return (
                    <div className={styles.boundItem} key={key}>
                      <div
                        className={classnames(
                          styles.boundIcon,
                          isView ? styles.viewResourceIcon : styles.objectResourceIcon
                        )}
                      >
                        {isView ? <EyeOutlined /> : <DatabaseOutlined />}
                      </div>
                      <div className={styles.boundMain}>
                        <div className={styles.boundTitleRow}>
                          <span className={styles.boundName} title={item.resourceName}>
                            {item.resourceName}
                          </span>
                          {renderResourceTypeTag(item.resourceBizType)}
                          {isNew && <Tag className={styles.newTag}>新增</Tag>}
                        </div>
                        <div className={styles.boundCode}>{item.resourceCode}</div>
                      </div>
                      <Tooltip title={isNew ? '取消选择' : '本次移除'}>
                        <Button
                          className={styles.removeBtn}
                          type="text"
                          size="small"
                          icon={<CloseOutlined />}
                          onClick={() => toggleResource(item, false)}
                        />
                      </Tooltip>
                    </div>
                  );
                })
              )}
            </div>
            {initialCount > 0 && (
              <div className={styles.boundFootnote}>
                <PlusOutlined />
                原已绑定 {initialCount} 个，本次保存后按右侧列表生效
              </div>
            )}
          </aside>
        </div>
      </div>
    </Drawer>
  );
};

export default OntologyResourceSelectorDrawer;
