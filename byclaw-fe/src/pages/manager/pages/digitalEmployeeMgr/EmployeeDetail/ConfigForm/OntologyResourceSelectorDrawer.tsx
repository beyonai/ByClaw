import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { pageOntologyResources } from '@/service/ontology';
import { queryCatalogTree } from '@/service/digitalEmployees';
import { AppstoreOutlined, ApartmentOutlined, DatabaseOutlined, EyeOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Checkbox, Drawer, Empty, Input, Select, Space, Spin, Tabs, Tag, message } from 'antd';
import classnames from 'classnames';
import styles from './OntologyResourceSelectorDrawer.module.less';

const ALL_CATALOG_ID = '-1';
const ALL_RESOURCE_TYPE = 'ALL';
const ONTOLOGY_RESOURCE_TYPES = ['VIEW', 'OBJECT'];

const OWNER_TABS = [
  { key: 'personal', label: '个人本体' },
  { key: 'enterprise', label: '企业本体' },
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

const getResourceTypeLabel = (type: string) => (type === 'VIEW' ? '视图' : type === 'OBJECT' ? '对象' : '本体资源');

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
  const [catalogs, setCatalogs] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMap, setSelectedMap] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!open) return;
    const initialMap = selectedResources.reduce((acc: Record<string, any>, item: any) => {
      const normalized = normalizeOntologyResource(item, ownerType);
      acc[getResourceKey(normalized)] = normalized;
      return acc;
    }, {});
    setSelectedMap(initialMap);
    setActiveOwnerType(ownerType === 'enterprise' ? 'enterprise' : 'personal');
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

  const fetchResources = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const list = extractList(
        await pageOntologyResources({
          ownerType: activeOwnerType,
          resourceBizTypeList: resourceType === ALL_RESOURCE_TYPE ? ONTOLOGY_RESOURCE_TYPES : [resourceType],
          keyword,
          catalogId,
          statusList: [2],
          permission: 'all',
          pageNum: 1,
          pageSize: 30,
        })
      )
        .map((item) => normalizeOntologyResource(item, activeOwnerType))
        .filter((item) => ONTOLOGY_RESOURCE_TYPES.includes(item.resourceBizType));
      setResources(list);
    } catch (error) {
      setResources([]);
      message.error('本体资源查询失败');
    } finally {
      setLoading(false);
    }
  }, [activeOwnerType, catalogId, keyword, open, resourceType]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  const selectedList = useMemo(() => Object.values(selectedMap), [selectedMap]);

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

  return (
    <Drawer
      open={open}
      title="添加本体资源"
      width={760}
      destroyOnClose
      onClose={onCancel}
      footer={
        <div className={styles.footer}>
          <span className={styles.selectedText}>
            已选择
            <strong>{selectedList.length}</strong>
            个本体资源
          </span>
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
            style={{ width: 126 }}
            onChange={setResourceType}
            options={[
              { value: ALL_RESOURCE_TYPE, label: '全部类型' },
              { value: 'VIEW', label: '视图' },
              { value: 'OBJECT', label: '对象' },
            ]}
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
          <Button type="primary" onClick={fetchResources}>
            查询
          </Button>
        </div>
        <div className={styles.categoryBar}>
          <button
            type="button"
            className={classnames(styles.categoryBtn, {
              [styles.categoryBtnActive]: catalogId === ALL_CATALOG_ID,
            })}
            onClick={() => setCatalogId(ALL_CATALOG_ID)}
          >
            全部分类
          </button>
          {catalogs.map((catalog) => (
            <button
              type="button"
              key={catalog.catalogId}
              className={classnames(styles.categoryBtn, {
                [styles.categoryBtnActive]: catalogId === catalog.catalogId,
              })}
              onClick={() => setCatalogId(catalog.catalogId)}
            >
              {catalog.catalogName}
            </button>
          ))}
        </div>
        <div className={styles.listWrap}>
          <Spin spinning={loading}>
            {resources.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可选本体资源" />
            ) : (
              <div className={styles.resourceList}>
                {resources.map((item) => {
                  const key = getResourceKey(item);
                  const checked = Boolean(selectedMap[key]);
                  const isView = item.resourceBizType === 'VIEW';
                  return (
                    <div
                      className={classnames(styles.resourceItem, { [styles.resourceItemSelected]: checked })}
                      key={key}
                    >
                      <Checkbox checked={checked} onChange={(event) => toggleResource(item, event.target.checked)} />
                      <div className={styles.resourceIcon}>{isView ? <EyeOutlined /> : <DatabaseOutlined />}</div>
                      <div className={styles.resourceMain}>
                        <div className={styles.resourceTitleRow}>
                          <span className={styles.resourceName} title={item.resourceName}>
                            {item.resourceName}
                          </span>
                          <Tag className={styles.typeTag}>{getResourceTypeLabel(item.resourceBizType)}</Tag>
                        </div>
                        <div className={styles.resourceCode}>{item.resourceCode}</div>
                        {item.description && <div className={styles.resourceDesc}>{item.description}</div>}
                        <div className={styles.resourceMeta}>
                          <Tag icon={<ApartmentOutlined />}>
                            {item.ownerType === 'enterprise' ? '企业本体' : '个人本体'}
                          </Tag>
                          {item.catalogName && <Tag icon={<AppstoreOutlined />}>{item.catalogName}</Tag>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Spin>
        </div>
      </div>
    </Drawer>
  );
};

export default OntologyResourceSelectorDrawer;
