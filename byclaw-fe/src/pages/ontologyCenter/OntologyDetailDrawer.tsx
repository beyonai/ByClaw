// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer, Empty, Segmented, Select, Spin, Table, Tabs, Tag, Tooltip } from 'antd';
import { DownloadOutlined, ReloadOutlined, RightOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { getOntologySceneDetails, listOntologyScenes } from '@/service/ontology';
import styles from './OntologyDetailDrawer.module.less';

const getResponseData = (res: any) => res?.data ?? res ?? [];

const DATA_TYPE_COLOR: Record<string, string> = {
  STRING: 'orange',
  BIGINT: 'blue',
  INTEGER: 'blue',
  DOUBLE: 'geekblue',
  BOOLEAN: 'purple',
  DATE: 'green',
};

const truncateText = (value: any, max = 14) => {
  const text = `${value || ''}`;
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
};

/** 关系流图：每行表达「源对象 → 关系/基数 → 目标对象」，比环形图更适合读清多条业务关系。 */
const RelationGraph = ({
  relations = [],
  objects = [],
  svgRef,
  scale = 1,
}: {
  relations: any[];
  objects: any[];
  svgRef?: any;
  scale?: number;
}) => {
  const nodes = useMemo(() => {
    const map = new Map<string, string>();
    objects.forEach((o) => map.set(o.objectCode, o.objectName || o.objectCode));
    relations.forEach((r) => {
      if (r.sourceObjectCode) map.set(r.sourceObjectCode, r.sourceObjectName || r.sourceObjectCode);
      if (r.targetObjectCode) map.set(r.targetObjectCode, r.targetObjectName || r.targetObjectCode);
    });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [relations, objects]);

  const nodeNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    nodes.forEach((node) => {
      map[node.code] = node.name;
    });
    return map;
  }, [nodes]);

  if (!relations.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} />;
  }

  const width = 760;
  const rowHeight = 72;
  const height = Math.max(220, relations.length * rowHeight + 36);
  const sourceX = 28;
  const relationX = 292;
  const targetX = 574;
  const nodeWidth = 150;
  const relationWidth = 190;
  const nodeHeight = 42;
  const relationHeight = 50;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className={styles.flowGraph}
      role="img"
      style={{ width: `${width * scale}px`, transition: 'width 0.15s ease' }}
    >
      <defs>
        <marker id="ontologyRelationArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" className={styles.flowArrowHead} />
        </marker>
      </defs>
      {relations.map((r, idx) => {
        const y = 24 + idx * rowHeight;
        const midY = y + relationHeight / 2;
        const sourceName = r.sourceObjectName || nodeNameMap[r.sourceObjectCode] || r.sourceObjectCode || '-';
        const targetName = r.targetObjectName || nodeNameMap[r.targetObjectCode] || r.targetObjectCode || '-';
        const relationName = r.relationName || r.relationCode || '-';
        const cardinality = r.relationCardinality || '-';
        return (
          <g key={`${r.relationCode || relationName}-${idx}`}>
            <title>{`${sourceName} -> ${relationName} (${cardinality}) -> ${targetName}`}</title>
            <rect x={sourceX} y={y + 4} width={nodeWidth} height={nodeHeight} rx={8} className={styles.flowNode} />
            <text x={sourceX + 14} y={y + 23} className={styles.flowNodeName}>
              {truncateText(sourceName, 13)}
            </text>
            {r.sourceObjectCode && (
              <text x={sourceX + 14} y={y + 39} className={styles.flowNodeCode}>
                {truncateText(r.sourceObjectCode, 16)}
              </text>
            )}
            <line x1={sourceX + nodeWidth + 12} y1={midY} x2={relationX - 14} y2={midY} className={styles.flowLine} />
            <rect
              x={relationX}
              y={y}
              width={relationWidth}
              height={relationHeight}
              rx={10}
              className={styles.flowRelation}
            />
            <text x={relationX + relationWidth / 2} y={y + 20} textAnchor="middle" className={styles.flowRelationName}>
              {truncateText(relationName, 18)}
            </text>
            <rect x={relationX + 45} y={y + 28} width={100} height={17} rx={8.5} className={styles.flowCardinality} />
            <text
              x={relationX + relationWidth / 2}
              y={y + 41}
              textAnchor="middle"
              className={styles.flowCardinalityText}
            >
              {truncateText(cardinality, 13)}
            </text>
            <line
              x1={relationX + relationWidth + 14}
              y1={midY}
              x2={targetX - 14}
              y2={midY}
              className={styles.flowLine}
              markerEnd="url(#ontologyRelationArrow)"
            />
            <rect x={targetX} y={y + 4} width={nodeWidth} height={nodeHeight} rx={8} className={styles.flowNode} />
            <text x={targetX + 14} y={y + 23} className={styles.flowNodeName}>
              {truncateText(targetName, 13)}
            </text>
            {r.targetObjectCode && (
              <text x={targetX + 14} y={y + 39} className={styles.flowNodeCode}>
                {truncateText(r.targetObjectCode, 16)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

/** 关系列表：以表格方式展示关系数据。固定布局 + 列宽，避免列被遮挡。 */
const RelationTable = ({ relations = [], t }: { relations: any[]; t: (id: string) => string }) => (
  <Table
    size="small"
    tableLayout="fixed"
    className={styles.relationTable}
    rowKey={(r: any, i) => `${r.relationCode || ''}-${i}`}
    dataSource={relations}
    pagination={false}
    scroll={{ x: 680 }}
    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
    columns={[
      {
        title: t('ontologyCenter.detail.rel.name'),
        width: 180,
        ellipsis: true,
        render: (_: any, r: any) => r.relationName || r.relationCode,
      },
      {
        title: t('ontologyCenter.detail.rel.cardinality'),
        dataIndex: 'relationCardinality',
        width: 126,
        render: (v: string) =>
          v ? (
            <Tooltip title={v}>
              <Tag className={styles.cardinalityTag}>{v}</Tag>
            </Tooltip>
          ) : (
            '-'
          ),
      },
      {
        title: t('ontologyCenter.detail.rel.source'),
        width: 180,
        ellipsis: true,
        render: (_: any, r: any) => r.sourceObjectName || r.sourceObjectCode || '-',
      },
      {
        title: t('ontologyCenter.detail.rel.target'),
        width: 180,
        ellipsis: true,
        render: (_: any, r: any) => r.targetObjectName || r.targetObjectCode || '-',
      },
    ]}
  />
);

/** 关系视图：右上角列表/图表切换（Segmented）；图表支持放大、缩小、下载。 */
const RelationView = ({
  relations = [],
  objects = [],
  t,
}: {
  relations: any[];
  objects: any[];
  t: (id: string) => string;
}) => {
  const svgRef = useRef<any>(null);
  const [scale, setScale] = useState(1);
  const [mode, setMode] = useState<'list' | 'graph'>('list');

  const handleDownload = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${source}`], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ontology-relations.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className={styles.relHeader}>
        <div className={styles.relTools}>
          {mode === 'graph' && (
            <>
              <Button
                size="small"
                icon={<ZoomOutOutlined />}
                onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(1)))}
                aria-label="zoom out"
              />
              <span className={styles.zoomLabel}>{Math.round(scale * 100)}%</span>
              <Button
                size="small"
                icon={<ZoomInOutlined />}
                onClick={() => setScale((s) => Math.min(2.6, +(s + 0.2).toFixed(1)))}
                aria-label="zoom in"
              />
              <Button size="small" icon={<ReloadOutlined />} onClick={() => setScale(1)} aria-label="reset" />
              <Button size="small" icon={<DownloadOutlined />} onClick={handleDownload}>
                {t('ontologyCenter.detail.download')}
              </Button>
            </>
          )}
        </div>
        <Segmented
          size="small"
          value={mode}
          onChange={(v) => setMode(v as 'list' | 'graph')}
          options={[
            { label: t('ontologyCenter.detail.relList'), value: 'list' },
            { label: t('ontologyCenter.detail.relGraph'), value: 'graph' },
          ]}
        />
      </div>
      {mode === 'list' ? (
        <RelationTable relations={relations} t={t} />
      ) : (
        <div className={styles.graphScroll}>
          <RelationGraph relations={relations} objects={objects} svgRef={svgRef} scale={scale} />
        </div>
      )}
    </div>
  );
};

/** 本体库详情抽屉：场景选择 → 概览(对象/视图/关系) → 逐级下钻(对象属性/动作、视图对象)。 */
const OntologyDetailDrawer = ({ open, base, onClose }: { open: boolean; base: any; onClose: () => void }) => {
  const intl = useIntl();
  const t = (id: string, values?: any) => intl.formatMessage({ id }, values);
  const [scenes, setScenes] = useState<any[]>([]);
  const [sceneId, setSceneId] = useState<string | undefined>();
  const [detail, setDetail] = useState<any>({});
  const [loading, setLoading] = useState(false);
  // 下钻路径：空=概览；每项 { type:'object'|'view', code, name }
  const [path, setPath] = useState<any[]>([]);

  const ownerType = base?.ownerType || 'personal';
  const baseId = base?.pid || base?.ontologyBaseCode || base?.resourceCode || base?.baseId;

  useEffect(() => {
    if (!open || !baseId) return;
    listOntologyScenes({ ownerType, baseId })
      .then((res) => {
        const data = getResponseData(res);
        const list = Array.isArray(data) ? data : [];
        setScenes(list);
        setSceneId(list[0]?.sceneId);
      })
      .catch(() => setScenes([]));
  }, [open, baseId, ownerType]);

  useEffect(() => {
    if (!open || !baseId || !sceneId) {
      setDetail({});
      return;
    }
    setLoading(true);
    setPath([]);
    getOntologySceneDetails({ ownerType, baseId, sceneId })
      .then((res) => {
        const data = getResponseData(res);
        setDetail(data && typeof data === 'object' ? data : {});
      })
      .catch(() => setDetail({}))
      .finally(() => setLoading(false));
  }, [open, baseId, ownerType, sceneId]);

  const objects = detail.objects || [];
  const views = detail.views || [];
  const relations = detail.relations || [];
  const actions = detail.actions || [];

  const objectsByCode = useMemo(() => {
    const map: Record<string, any> = {};
    objects.forEach((o: any) => {
      if (o?.objectCode) map[o.objectCode] = o;
    });
    return map;
  }, [objects]);

  const currentScene = useMemo(
    () => scenes.find((s) => s.sceneId === sceneId) || detail?.scene || {},
    [scenes, sceneId, detail]
  );
  const sceneName = currentScene.sceneName || detail?.scene?.sceneName || t('common.viewDetail');

  const drillObject = (code: string, name: string) => setPath((p) => [...p, { type: 'object', code, name }]);
  const drillView = (code: string, name: string) => setPath((p) => [...p, { type: 'view', code, name }]);

  // ============ 渲染：属性表 / 动作列表 ============
  const renderPropertyTable = (properties: any[] = []) => (
    <Table
      size="small"
      rowKey={(r: any, i) => `${r.propertyCode || ''}-${i}`}
      dataSource={properties}
      pagination={false}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      columns={[
        { title: t('ontologyCenter.detail.col.name'), dataIndex: 'propertyName', ellipsis: true },
        {
          title: t('ontologyCenter.detail.col.code'),
          dataIndex: 'propertyCode',
          ellipsis: true,
          render: (v: string) => <span className={styles.mono}>{v}</span>,
        },
        {
          title: t('ontologyCenter.detail.col.type'),
          dataIndex: 'dataType',
          width: 96,
          render: (v: string) => (v ? <Tag color={DATA_TYPE_COLOR[v] || 'default'}>{v}</Tag> : '-'),
        },
        {
          title: t('ontologyCenter.detail.col.constraint'),
          width: 120,
          render: (_: any, r: any) => (
            <span className={styles.constraintCell}>
              {r.businessKey === 1 && <Tag color="gold">{t('ontologyCenter.detail.businessKey')}</Tag>}
              {r.isRequired === 1 && <Tag color="red">{t('ontologyCenter.detail.required')}</Tag>}
              {r.terminology && <Tag>{t('ontologyCenter.detail.term')}</Tag>}
            </span>
          ),
        },
      ]}
    />
  );

  const renderActionList = (objectCode: string) => {
    const list = actions.filter((a: any) => a.belongObjectCode === objectCode);
    if (!list.length) return null;
    return (
      <>
        <div className={styles.sectionTitle}>{t('ontologyCenter.detail.actions')}</div>
        <div className={styles.entityList}>
          {list.map((a: any) => (
            <div key={a.actionCode} className={styles.actionRow}>
              <Tag color={a.actionType === 'query' ? 'blue' : 'volcano'}>{a.actionType || 'action'}</Tag>
              <span className={styles.actionName}>{a.actionName || a.actionCode}</span>
              {(a.requestUrl || a.requestMethod) && (
                <span className={styles.mono} style={{ marginLeft: 'auto', color: '#999' }}>
                  {a.requestMethod} {a.requestUrl}
                </span>
              )}
            </div>
          ))}
        </div>
      </>
    );
  };

  // ============ 渲染：对象详情面板 ============
  const renderObjectPanel = (obj: any) => {
    if (!obj) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    return (
      <div>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>{obj.objectName || obj.objectCode}</span>
          <span className={styles.mono}>{obj.objectCode}</span>
        </div>
        <div className={styles.panelTags}>
          {obj.conceptType === '2' ? (
            <Tag color="purple">{t('ontologyCenter.detail.conceptActivity')}</Tag>
          ) : (
            <Tag color="geekblue">{t('ontologyCenter.detail.conceptEntity')}</Tag>
          )}
          {obj.objectSource && <Tag color="cyan">{obj.objectSource}</Tag>}
          <Tag>
            {(obj.properties || []).length} {t('ontologyCenter.detail.attrUnit')}
          </Tag>
        </div>
        {obj.objectDesc && <div className={styles.desc}>{obj.objectDesc}</div>}
        <div className={styles.sectionTitle}>{t('ontologyCenter.detail.attributes')}</div>
        {renderPropertyTable(obj.properties)}
        {renderActionList(obj.objectCode)}
      </div>
    );
  };

  // ============ 渲染：视图详情面板 ============
  const renderViewPanel = (view: any) => {
    if (!view) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    const viewObjects = (view.objectCodes || []).map((c: string) => objectsByCode[c]).filter(Boolean);
    return (
      <div>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>{view.viewName || view.viewCode}</span>
          <span className={styles.mono}>{view.viewCode}</span>
        </div>
        {view.description && <div className={styles.desc}>{view.description}</div>}

        <div className={styles.sectionTitle}>{t('ontologyCenter.detail.viewProperties')}</div>
        <Table
          size="small"
          rowKey={(r: any, i) => `${r.propertyCode || ''}-${i}`}
          dataSource={view.properties || []}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          columns={[
            { title: t('ontologyCenter.detail.col.name'), dataIndex: 'propertyName', ellipsis: true },
            {
              title: t('ontologyCenter.detail.col.code'),
              dataIndex: 'propertyCode',
              ellipsis: true,
              render: (v: string) => <span className={styles.mono}>{v}</span>,
            },
            {
              title: t('ontologyCenter.detail.col.source'),
              render: (_: any, r: any) => (
                <span className={styles.mono} style={{ color: '#888' }}>
                  {r.sourceObject}
                  {r.sourceObjectProperty ? `.${r.sourceObjectProperty}` : ''}
                </span>
              ),
            },
          ]}
        />

        <div className={styles.sectionTitle}>
          {t('ontologyCenter.detail.objectList')} ({viewObjects.length})
        </div>
        <div className={styles.entityList}>
          {viewObjects.length ? (
            viewObjects.map((o: any) => (
              <div
                key={o.objectCode}
                className={styles.cardClickable}
                onClick={() => drillObject(o.objectCode, o.objectName || o.objectCode)}
              >
                <div className={styles.cardMain}>
                  <div className={styles.entityName}>{o.objectName || o.objectCode}</div>
                  <div className={styles.entityCode}>{o.objectCode}</div>
                </div>
                <RightOutlined className={styles.chevron} />
              </div>
            ))
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>
      </div>
    );
  };

  // ============ 渲染：概览（对象/视图/关系 Tabs） ============
  const renderOverview = () => (
    <Tabs
      items={[
        {
          key: 'object',
          label: `${t('common.resourceType.object')} ${objects.length}`,
          children: objects.length ? (
            <div className={styles.entityList}>
              {objects.map((o: any) => (
                <div
                  key={o.objectCode}
                  className={styles.cardClickable}
                  onClick={() => drillObject(o.objectCode, o.objectName || o.objectCode)}
                >
                  <div className={styles.cardMain}>
                    <div className={styles.entityName}>{o.objectName || o.objectCode}</div>
                    <div className={styles.entityCode}>{o.objectCode}</div>
                    <div className={styles.entityMeta}>
                      {o.objectSource && <Tag>{o.objectSource}</Tag>}
                      <Tag>
                        {(o.properties || []).length} {t('ontologyCenter.detail.attrUnit')}
                      </Tag>
                    </div>
                  </div>
                  <RightOutlined className={styles.chevron} />
                </div>
              ))}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ),
        },
        {
          key: 'view',
          label: `${t('common.resourceType.view')} ${views.length}`,
          children: views.length ? (
            <div className={styles.entityList}>
              {views.map((v: any) => (
                <div
                  key={v.viewCode}
                  className={styles.cardClickable}
                  onClick={() => drillView(v.viewCode, v.viewName || v.viewCode)}
                >
                  <div className={styles.cardMain}>
                    <div className={styles.entityName}>{v.viewName || v.viewCode}</div>
                    <div className={styles.entityCode}>{v.viewCode}</div>
                    {Array.isArray(v.objectCodes) && (
                      <Tag>
                        {v.objectCodes.length} {t('common.resourceType.object')}
                      </Tag>
                    )}
                  </div>
                  <RightOutlined className={styles.chevron} />
                </div>
              ))}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ),
        },
        {
          key: 'relation',
          label: `${t('employeeDetail.ontology.relation')} ${relations.length}`,
          children: <RelationView relations={relations} objects={objects} t={t} />,
        },
      ]}
    />
  );

  const current = path[path.length - 1];

  return (
    <Drawer
      width={640}
      open={open}
      onClose={onClose}
      title={base?.resourceName || base?.displayName || t('ontologyCenter.detail.title')}
    >
      {/* 块一：本体库信息 */}
      <div className={styles.block}>
        <div className={styles.blockTitle}>{t('ontologyCenter.detail.baseInfo')}</div>
        <div className={styles.baseName}>{base?.resourceName || base?.displayName}</div>
        <div className={styles.metaRow}>
          {base?.ownerType && <Tag>{base.ownerType}</Tag>}
          {base?.sourceType && base.sourceType !== base.ownerType && <Tag>{base.sourceType}</Tag>}
          {baseId && <span className={styles.baseId}>{baseId}</span>}
        </div>
        {(base?.resourceDesc || base?.description) && (
          <div className={styles.desc}>{base.resourceDesc || base.description}</div>
        )}
      </div>

      {/* 块二：场景信息 */}
      <div className={styles.block}>
        <div className={styles.blockTitle}>{t('ontologyCenter.detail.sceneInfo')}</div>
        <div className={styles.sceneRow}>
          <span className={styles.sceneLabel}>{t('employeeDetail.ontology.scene')}</span>
          <Select
            value={sceneId}
            style={{ minWidth: 200 }}
            onChange={setSceneId}
            options={scenes.map((s) => ({ value: s.sceneId, label: s.sceneName || s.sceneId }))}
            placeholder={t('employeeDetail.ontology.scene')}
          />
        </div>
        {currentScene?.sceneDesc && <div className={styles.sceneDesc}>{currentScene.sceneDesc}</div>}
      </div>

      {/* 块三：场景关联信息 */}
      <div className={styles.block}>
        <div className={styles.blockTitle}>{t('ontologyCenter.detail.relatedInfo')}</div>
        {path.length > 0 && (
          <div className={styles.breadcrumb}>
            <span className={styles.crumbLink} onClick={() => setPath([])}>
              {sceneName}
            </span>
            {path.map((p, i) => {
              const isLast = i === path.length - 1;
              return (
                <React.Fragment key={`${p.type}-${p.code}`}>
                  <RightOutlined className={styles.crumbSep} />
                  <span
                    className={isLast ? styles.crumbCurrent : styles.crumbLink}
                    onClick={() => !isLast && setPath(path.slice(0, i + 1))}
                  >
                    {p.name || p.code}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        )}

        <Spin spinning={loading}>
          {!current && renderOverview()}
          {current?.type === 'object' && renderObjectPanel(objectsByCode[current.code])}
          {current?.type === 'view' && renderViewPanel((views || []).find((v: any) => v.viewCode === current.code))}
        </Spin>
      </div>
    </Drawer>
  );
};

export default OntologyDetailDrawer;
