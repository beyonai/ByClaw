// @ts-nocheck
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, message, Modal, Segmented, Spin, Table, Tabs, Tag, Tooltip, Tree } from 'antd';
import {
  CloseOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  HolderOutlined,
  InfoCircleOutlined,
  LeftOutlined,
  SearchOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import classnames from 'classnames';
// @ts-ignore
import { useIntl, useLocation, useNavigate, useSearchParams } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import { DragType } from '@/components/QueryInput/withDrag';
import useGlobal from '@/hooks/useGlobal';
import commonTreeStyles from '@/layout/sider/components/Knowledge/components/common.module.less';
import fileTreeStyles from '@/layout/sider/components/FileSiderPanel/index.module.less';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import { getOntologySceneDetails, listOntologyScenes } from '@/service/ontology';
import OntologyNodeDrawer from '@/pages/ontologyCenter/OntologyNodeDrawer';
import styles from './index.module.less';

const getData = (res: any) => res?.data ?? res ?? [];
const toArray = (value: any) => (Array.isArray(value) ? value : []);

type FocusType = 'base' | 'scene' | 'view';

const DATA_TYPE_COLOR: Record<string, string> = {
  STRING: 'orange',
  BIGINT: 'blue',
  INTEGER: 'blue',
  DOUBLE: 'geekblue',
  BOOLEAN: 'purple',
  DATE: 'green',
};

const OBJECT_SOURCE_LABEL_KEYS: Record<string, string> = {
  DB: 'ontologyBaseDetail.objectSource.DB',
  API: 'ontologyBaseDetail.objectSource.API',
  DYNAMIC_TABLE: 'ontologyBaseDetail.objectSource.DYNAMIC_TABLE',
  KNOWLEDGE_BASE: 'ontologyBaseDetail.objectSource.KNOWLEDGE_BASE',
  FILE: 'ontologyBaseDetail.objectSource.FILE',
  EXCEL: 'ontologyBaseDetail.objectSource.EXCEL',
  CSV: 'ontologyBaseDetail.objectSource.CSV',
  MANUAL: 'ontologyBaseDetail.objectSource.MANUAL',
  TABLE: 'ontologyBaseDetail.objectSource.TABLE',
  MODEL: 'ontologyBaseDetail.objectSource.MODEL',
};

const DATASOURCE_TYPE_LABEL_KEYS: Record<string, string> = {
  DB: 'ontologyBaseDetail.datasourceTypeValue.DB',
  API: 'ontologyBaseDetail.datasourceTypeValue.API',
  FILE: 'ontologyBaseDetail.datasourceTypeValue.FILE',
  KNOWLEDGE_BASE: 'ontologyBaseDetail.datasourceTypeValue.KNOWLEDGE_BASE',
};

const DATA_TYPE_LABEL_KEYS: Record<string, string> = {
  STRING: 'ontologyBaseDetail.dataTypeValue.STRING',
  TEXT: 'ontologyBaseDetail.dataTypeValue.TEXT',
  INTEGER: 'ontologyBaseDetail.dataTypeValue.INTEGER',
  INT: 'ontologyBaseDetail.dataTypeValue.INT',
  BIGINT: 'ontologyBaseDetail.dataTypeValue.BIGINT',
  DOUBLE: 'ontologyBaseDetail.dataTypeValue.DOUBLE',
  FLOAT: 'ontologyBaseDetail.dataTypeValue.FLOAT',
  DECIMAL: 'ontologyBaseDetail.dataTypeValue.DECIMAL',
  BOOLEAN: 'ontologyBaseDetail.dataTypeValue.BOOLEAN',
  DATE: 'ontologyBaseDetail.dataTypeValue.DATE',
  DATETIME: 'ontologyBaseDetail.dataTypeValue.DATETIME',
  TIMESTAMP: 'ontologyBaseDetail.dataTypeValue.TIMESTAMP',
};

const uniqueBy = (list: any[], keyGetter: (item: any) => string) => {
  const map = new Map<string, any>();
  list.forEach((item) => {
    const key = keyGetter(item);
    if (key && !map.has(key)) map.set(key, item);
  });
  return Array.from(map.values());
};

const getBilingualLabel = (
  t: (id: string, values?: any) => string,
  labelKeys: Record<string, string>,
  value: any,
  fallback?: string
) => {
  const rawValue = value === undefined || value === null || value === '' ? fallback : value;
  if (rawValue === undefined || rawValue === null || rawValue === '') return fallback || '-';
  const raw = `${rawValue}`;
  const labelKey = labelKeys[raw] || labelKeys[raw.toUpperCase()];
  if (labelKey) return `${t(labelKey)} ${raw}`;
  return raw;
};

const getValueLabelFromRows = (rows: any[], fields: string[]) => {
  for (const row of rows) {
    for (const field of fields) {
      const value = row?.[field];
      if (value !== undefined && value !== null && value !== '') return `${value}`;
    }
  }
  return '';
};

const getDistributionValueLabel = ({
  raw,
  rows,
  labelFields,
  fallbackLabel,
  appendRaw = true,
}: {
  raw: string;
  rows: any[];
  labelFields: string[];
  fallbackLabel?: string;
  appendRaw?: boolean;
}) => {
  const dynamicLabel = getValueLabelFromRows(rows, labelFields);
  const label = dynamicLabel || fallbackLabel;
  if (!label || label === raw) return raw;
  return appendRaw ? `${label} ${raw}` : label;
};

const groupRowsBy = (
  list: any[],
  keyGetter: (item: any) => string,
  labelGetter?: (key: string, rows: any[]) => string
) => {
  const map = new Map<string, any[]>();
  list.forEach((item) => {
    const key = keyGetter(item) || '-';
    const rows = map.get(key) || [];
    rows.push(item);
    map.set(key, rows);
  });
  return Array.from(map.entries())
    .map(([name, rows]) => ({ name: labelGetter?.(name, rows) || name, rawName: name, value: rows.length, rows }))
    .sort((a, b) => b.value - a.value);
};

const groupRelationsByEndpoint = (relations: any[], fallback: string) => {
  const map = new Map<string, { value: number; rows: any[]; relationKeys: Set<string> }>();
  relations.forEach((relation: any, index: number) => {
    const relationKey = relation.relationCode || `${index}`;
    [
      relation.sourceObjectName || relation.sourceObjectCode,
      relation.targetObjectName || relation.targetObjectCode,
    ].forEach((rawName) => {
      const name = rawName || fallback;
      const group = map.get(name) || { value: 0, rows: [], relationKeys: new Set<string>() };
      if (!group.relationKeys.has(relationKey)) {
        group.value += 1;
        group.rows.push(relation);
        group.relationKeys.add(relationKey);
      }
      map.set(name, group);
    });
  });
  return Array.from(map.entries())
    .map(([name, group]) => ({ name, value: group.value, rows: group.rows }))
    .sort((a, b) => b.value - a.value);
};

const normalizeDetail = (detail: any) => {
  const d = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
  return {
    ...d,
    objects: toArray(d.objects || d.objectList || d.objectInfos),
    views: toArray(d.views || d.viewList || d.viewInfos),
    relations: toArray(d.relations || d.relationList || d.relationInfos),
    actions: toArray(d.actions || d.actionList || d.actionInfos),
    datasources: toArray(d.datasources || d.dbsources || d.dataSources || d.datasourceList || d.datasourceInfos),
  };
};

const DistributionList = ({
  data,
  emptyText,
  onItemClick,
}: {
  data: any[];
  emptyText?: React.ReactNode;
  onItemClick?: (item: any) => void;
}) => {
  const max = Math.max(...data.map((item) => item.value), 1);
  const formatValue = (value: any) =>
    typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(2) : value;
  if (!data.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText || false} />;
  return (
    <div className={styles.distributionList}>
      {data.slice(0, 8).map((item) => (
        <div
          key={item.name}
          className={`${styles.distributionRow} ${onItemClick ? styles.distributionRowClickable : ''}`}
          role={onItemClick ? 'button' : undefined}
          tabIndex={onItemClick ? 0 : undefined}
          onClick={() => onItemClick?.(item)}
          onKeyDown={(event) => {
            if (!onItemClick) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onItemClick(item);
            }
          }}
        >
          <div className={styles.distributionMeta}>
            <Tooltip title={item.name}>
              <span className={styles.distributionName}>{item.name}</span>
            </Tooltip>
            <span className={styles.distributionValue}>{formatValue(item.value)}</span>
          </div>
          <div className={styles.distributionTrack}>
            <div
              className={styles.distributionBar}
              style={{ width: item.value > 0 ? `${Math.max(8, (item.value / max) * 100)}%` : 0 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const DistributionTitle = ({ title, tooltip }: { title: React.ReactNode; tooltip: React.ReactNode }) => (
  <div className={styles.sectionTitle}>
    <span>{title}</span>
    <Tooltip title={tooltip} placement="top">
      <InfoCircleOutlined className={styles.sectionInfoIcon} />
    </Tooltip>
  </div>
);

const ResourceSection = ({
  title,
  extra,
  children,
}: {
  title: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className={styles.resourceSection}>
    <div className={styles.resourceSectionHeader}>
      <span className={styles.resourceSectionTitle}>{title}</span>
      {extra}
    </div>
    {children}
  </section>
);

const DistributionContent = ({
  items,
  expanded,
  onToggle,
  onDrill,
  t,
}: {
  items: Array<{
    key: string;
    title: React.ReactNode;
    tooltip: React.ReactNode;
    data: any[];
    columns?: any[];
    rowKey?: any;
  }>;
  expanded: boolean;
  onToggle: () => void;
  onDrill?: (distribution: any, bucket: any) => void;
  t: (id: string, values?: any) => string;
}) => {
  const visibleItems = expanded ? items : items.slice(0, 2);
  return (
    <div>
      {items.length > 2 && (
        <div className={styles.distributionToolbar}>
          <Button type="link" size="small" className={styles.sectionMoreButton} onClick={onToggle}>
            {expanded ? t('ontologyBaseDetail.collapse') : t('common.more')}
          </Button>
        </div>
      )}
      <div className={styles.insightGrid}>
        {visibleItems.map((item) => (
          <div key={item.key} className={styles.insightPanel}>
            <DistributionTitle title={item.title} tooltip={item.tooltip} />
            <DistributionList data={item.data} onItemClick={(bucket) => onDrill?.(item, bucket)} />
          </div>
        ))}
      </div>
    </div>
  );
};

const truncateText = (value: any, max = 16) => {
  const text = `${value || ''}`;
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
};

const RelationGraph = ({
  relations = [],
  objects = [],
  scale = 1,
  svgRef,
}: {
  relations: any[];
  objects?: any[];
  scale?: number;
  svgRef?: React.Ref<SVGSVGElement>;
}) => {
  const objectNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    objects.forEach((object: any) => {
      if (object?.objectCode) map[object.objectCode] = object.objectName || object.objectCode;
    });
    return map;
  }, [objects]);

  if (!relations.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  const width = 980;
  const rowHeight = 92;
  const height = Math.max(300, relations.length * rowHeight + 44);
  const sourceX = 34;
  const relationX = 384;
  const targetX = 754;
  const nodeWidth = 188;
  const nodeHeight = 54;
  const relationWidth = 216;
  const relationHeight = 60;

  return (
    <div className={styles.relationGraphWrap}>
      <svg
        ref={svgRef}
        className={styles.relationGraph}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        style={{ width: width * scale, height: height * scale }}
      >
        <defs>
          <linearGradient id="relationLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#19C37D" />
            <stop offset="52%" stopColor="#1D6DF2" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
          <linearGradient id="relationCardGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1D6DF2" />
            <stop offset="100%" stopColor="#19C37D" />
          </linearGradient>
          <filter id="relationGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="0 0 0 0 0.12 0 0 0 0 0.42 0 0 0 0 0.95 0 0 0 0.35 0"
              result="glow"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="relationGraphArrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 Z" className={styles.relationGraphArrowHead} />
          </marker>
          <pattern id="relationGrid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" className={styles.relationGraphGrid} />
          </pattern>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="18" className={styles.relationGraphBg} />
        <rect x="0" y="0" width={width} height={height} rx="18" fill="url(#relationGrid)" opacity="0.85" />
        {relations.map((relation: any, index: number) => {
          const y = 28 + index * rowHeight;
          const centerY = y + relationHeight / 2;
          const sourceName =
            relation.sourceObjectName || objectNameMap[relation.sourceObjectCode] || relation.sourceObjectCode || '-';
          const targetName =
            relation.targetObjectName || objectNameMap[relation.targetObjectCode] || relation.targetObjectCode || '-';
          const relationName = relation.relationName || relation.relationCode || '-';
          const cardinality = relation.relationCardinality || '-';
          const leftPath = `M ${sourceX + nodeWidth + 18} ${centerY} C ${sourceX + nodeWidth + 96} ${centerY - 28}, ${
            relationX - 76
          } ${centerY - 28}, ${relationX - 16} ${centerY}`;
          const rightPath = `M ${relationX + relationWidth + 16} ${centerY} C ${relationX + relationWidth + 84} ${
            centerY + 28
          }, ${targetX - 92} ${centerY + 28}, ${targetX - 16} ${centerY}`;

          return (
            <g key={`${relation.relationCode || relationName}-${index}`}>
              <title>{`${sourceName} -> ${relationName} (${cardinality}) -> ${targetName}`}</title>
              <path d={leftPath} className={styles.relationGraphLine} />
              <path d={rightPath} className={styles.relationGraphLine} markerEnd="url(#relationGraphArrow)" />
              <circle cx={sourceX + nodeWidth + 18} cy={centerY} r="4" className={styles.relationGraphDot} />
              <circle cx={targetX - 16} cy={centerY} r="4" className={styles.relationGraphDot} />

              <rect
                x={sourceX}
                y={y + 3}
                width={nodeWidth}
                height={nodeHeight}
                rx="12"
                className={styles.graphNodeCard}
              />
              <text x={sourceX + 16} y={y + 25} className={styles.graphNodeName}>
                {truncateText(sourceName, 15)}
              </text>
              <text x={sourceX + 16} y={y + 44} className={styles.graphNodeCode}>
                {truncateText(relation.sourceObjectCode, 20)}
              </text>

              <rect
                x={relationX}
                y={y}
                width={relationWidth}
                height={relationHeight}
                rx="16"
                className={styles.graphRelationCard}
                filter="url(#relationGlow)"
              />
              <text
                x={relationX + relationWidth / 2}
                y={y + 25}
                textAnchor="middle"
                className={styles.graphRelationName}
              >
                {truncateText(relationName, 18)}
              </text>
              <rect x={relationX + 58} y={y + 36} width={100} height={18} rx="9" className={styles.graphCardinality} />
              <text
                x={relationX + relationWidth / 2}
                y={y + 50}
                textAnchor="middle"
                className={styles.graphCardinalityText}
              >
                {truncateText(cardinality, 13)}
              </text>

              <rect
                x={targetX}
                y={y + 3}
                width={nodeWidth}
                height={nodeHeight}
                rx="12"
                className={styles.graphNodeCard}
              />
              <text x={targetX + 16} y={y + 25} className={styles.graphNodeName}>
                {truncateText(targetName, 15)}
              </text>
              <text x={targetX + 16} y={y + 44} className={styles.graphNodeCode}>
                {truncateText(relation.targetObjectCode, 20)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const getTableRowKey = (rowKey: any, row: any, index: number) => {
  if (typeof rowKey === 'function') return rowKey(row, index);
  if (typeof rowKey === 'string') return row?.[rowKey] ?? index;
  return row?.key ?? row?.id ?? index;
};

const ReferenceDetailTable = ({
  rowKey,
  dataSource = [],
  columns = [],
  onReferenceSelectionChange,
  referenceType,
  referenceContext,
  selectionResetKey,
  ...rest
}: any) => {
  delete rest.onReference;
  const [selectedRowKeys, setSelectedRowKeys] = useState<any[]>([]);
  const getRowsByKeys = useCallback(
    (keys: any[]) => {
      const selectedKeySet = new Set(keys);
      return dataSource.filter((row: any, index: number) => selectedKeySet.has(getTableRowKey(rowKey, row, index)));
    },
    [dataSource, rowKey]
  );

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [selectionResetKey]);

  useEffect(() => {
    setSelectedRowKeys((keys) => {
      const availableKeys = new Set(dataSource.map((row: any, index: number) => getTableRowKey(rowKey, row, index)));
      return keys.filter((key) => availableKeys.has(key));
    });
  }, [dataSource, rowKey]);

  return (
    <div className={styles.referenceTableWrap}>
      <Table
        {...rest}
        rowKey={rowKey}
        dataSource={dataSource}
        columns={columns}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys: React.Key[]) => {
            setSelectedRowKeys(keys);
            onReferenceSelectionChange?.({
              rows: getRowsByKeys(keys),
              type: referenceType,
              context: referenceContext || {},
            });
          },
        }}
      />
    </div>
  );
};

const RelationPanel = ({
  relations = [],
  objects = [],
  columns,
  t,
  onReference,
  onReferenceSelectionChange,
  referenceContext,
  selectionResetKey,
}: {
  relations: any[];
  objects?: any[];
  columns: any[];
  t: (id: string, values?: any) => string;
  onReference: (rows: any[]) => void;
  onReferenceSelectionChange?: (selection: any) => void;
  referenceContext?: any;
  selectionResetKey?: any;
}) => {
  const [mode, setMode] = useState<'list' | 'graph'>('list');
  const [graphScale, setGraphScale] = useState(1);
  const graphSvgRef = useRef<SVGSVGElement>(null);

  const changeGraphScale = (delta: number) => {
    setGraphScale((value) => Math.min(1.8, Math.max(0.6, Number((value + delta).toFixed(1)))));
  };

  const inlineSvgStyles = (source: Element, target: Element) => {
    const computedStyle = window.getComputedStyle(source);
    const cssText = Array.from(computedStyle)
      .map((property) => `${property}:${computedStyle.getPropertyValue(property)};`)
      .join('');
    target.setAttribute('style', cssText);
    Array.from(source.children).forEach((child, index) => {
      const targetChild = target.children[index];
      if (targetChild) inlineSvgStyles(child, targetChild);
    });
  };

  const downloadGraph = () => {
    const svg = graphSvgRef.current;
    if (!svg) return;
    const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
    inlineSvgStyles(svg, clonedSvg);
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const source = new XMLSerializer().serializeToString(clonedSvg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ontology-relation-graph.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.relationPanel}>
      <div className={styles.relationPanelToolbar}>
        {mode === 'graph' ? (
          <div className={styles.relationGraphTools}>
            <Tooltip title={t('ontologyBaseDetail.graphZoomOut')}>
              <Button
                type="text"
                size="small"
                icon={<ZoomOutOutlined />}
                disabled={graphScale <= 0.6}
                onClick={() => changeGraphScale(-0.1)}
              />
            </Tooltip>
            <Tooltip title={t('ontologyBaseDetail.graphZoomIn')}>
              <Button
                type="text"
                size="small"
                icon={<ZoomInOutlined />}
                disabled={graphScale >= 1.8}
                onClick={() => changeGraphScale(0.1)}
              />
            </Tooltip>
            <Tooltip title={t('common.download')}>
              <Button
                type="text"
                size="small"
                icon={<DownloadOutlined />}
                disabled={!relations.length}
                onClick={downloadGraph}
              />
            </Tooltip>
          </div>
        ) : (
          <span />
        )}
        <Segmented
          size="small"
          value={mode}
          onChange={(value) => setMode(value as 'list' | 'graph')}
          options={[
            { label: t('ontologyCenter.detail.relList'), value: 'list' },
            { label: t('ontologyCenter.detail.relGraph'), value: 'graph' },
          ]}
        />
      </div>
      {mode === 'list' ? (
        <ReferenceDetailTable
          size="small"
          tableLayout="fixed"
          rowKey={(row: any, index) => `${row.sceneId || ''}:${row.relationCode || index}`}
          dataSource={relations}
          pagination={false}
          columns={columns}
          onReference={onReference}
          onReferenceSelectionChange={onReferenceSelectionChange}
          referenceType="relation"
          referenceContext={referenceContext}
          selectionResetKey={selectionResetKey}
        />
      ) : (
        <RelationGraph relations={relations} objects={objects} scale={graphScale} svgRef={graphSvgRef} />
      )}
    </div>
  );
};

const BrowseRelationPanel = ({
  relations = [],
  objects = [],
  columns,
  t,
}: {
  relations: any[];
  objects?: any[];
  columns: any[];
  t: (id: string, values?: any) => string;
}) => {
  const [mode, setMode] = useState<'list' | 'graph'>('list');
  const [graphScale, setGraphScale] = useState(1);
  const graphSvgRef = useRef<SVGSVGElement>(null);

  const changeGraphScale = (delta: number) => {
    setGraphScale((value) => Math.min(1.8, Math.max(0.6, Number((value + delta).toFixed(1)))));
  };

  const downloadGraph = () => {
    const svg = graphSvgRef.current;
    if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ontology-relation-graph.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.relationPanel}>
      <div className={styles.relationPanelToolbar}>
        {mode === 'graph' ? (
          <div className={styles.relationGraphTools}>
            <Tooltip title={t('ontologyBaseDetail.graphZoomOut')}>
              <Button
                type="text"
                size="small"
                icon={<ZoomOutOutlined />}
                disabled={graphScale <= 0.6}
                onClick={() => changeGraphScale(-0.1)}
              />
            </Tooltip>
            <Tooltip title={t('ontologyBaseDetail.graphZoomIn')}>
              <Button
                type="text"
                size="small"
                icon={<ZoomInOutlined />}
                disabled={graphScale >= 1.8}
                onClick={() => changeGraphScale(0.1)}
              />
            </Tooltip>
            <Tooltip title={t('common.download')}>
              <Button
                type="text"
                size="small"
                icon={<DownloadOutlined />}
                disabled={!relations.length}
                onClick={downloadGraph}
              />
            </Tooltip>
          </div>
        ) : (
          <span />
        )}
        <Segmented
          size="small"
          value={mode}
          onChange={(value) => setMode(value as 'list' | 'graph')}
          options={[
            { label: t('ontologyCenter.detail.relList'), value: 'list' },
            { label: t('ontologyCenter.detail.relGraph'), value: 'graph' },
          ]}
        />
      </div>
      {mode === 'list' ? (
        <Table
          size="small"
          tableLayout="fixed"
          rowKey={(row: any, index) => `${row.sceneId || ''}:${row.relationCode || index}`}
          dataSource={relations}
          pagination={false}
          columns={columns}
          scroll={{ x: 680 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      ) : (
        <RelationGraph relations={relations} objects={objects} scale={graphScale} svgRef={graphSvgRef} />
      )}
    </div>
  );
};

const decorateDirectoryTree = (nodes: any[], expandedKeys: React.Key[]) => {
  const expandedKeySet = new Set(expandedKeys.map(String));
  const walk = (list: any[]): any[] =>
    list.map((node) => {
      const expanded = expandedKeySet.has(String(node.key));
      return {
        ...node,
        className: classnames(node.className, expanded ? fileTreeStyles.treeNodeExpanded : undefined),
        children: node.children ? walk(node.children) : node.children,
      };
    });
  return walk(nodes);
};

const clampResourceDirectoryWidth = (width: number, containerWidth = 0) => {
  const maxWidth = containerWidth ? Math.max(220, Math.min(480, containerWidth - 420)) : 480;
  return Math.min(maxWidth, Math.max(200, width));
};

const OntologyBaseDetail: React.FC = () => {
  const intl = useIntl();
  const t = (id: string, values?: any) => intl.formatMessage({ id }, values);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const [sp] = useSearchParams();
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);

  const baseId = sp.get('baseId') || '';
  const ownerType = sp.get('ownerType') || 'personal';
  const resourceName = sp.get('resourceName') || baseId;
  const resourceCode = sp.get('resourceCode') || baseId;
  const queryFocusType = (sp.get('focusType') as FocusType) || 'base';
  const querySceneId = sp.get('sceneId') || undefined;
  const queryViewCode = sp.get('viewCode') || undefined;
  const backPath = `/ontologyCenter?tab=${ownerType}`;

  const [focusType, setFocusType] = useState<FocusType>(queryFocusType);
  const [selectedSceneId, setSelectedSceneId] = useState<string | undefined>(querySceneId);
  const [selectedViewCode, setSelectedViewCode] = useState<string | undefined>(queryViewCode);
  const [scenes, setScenes] = useState<any[]>([]);
  const [detailsBySceneId, setDetailsBySceneId] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [activeDetailTab, setActiveDetailTab] = useState('scene');
  const [activeResourceContentTab, setActiveResourceContentTab] = useState('detail');
  const [showAllDistributions, setShowAllDistributions] = useState(false);
  const [distributionDrill, setDistributionDrill] = useState<any>(null);
  const [detailSelection, setDetailSelection] = useState<any>({ rows: [], type: '', context: {} });
  const [detailSelectionResetKey, setDetailSelectionResetKey] = useState(0);
  const [distributionDrillSelection, setDistributionDrillSelection] = useState<any>({
    rows: [],
    type: '',
    context: {},
  });
  const [activeResourceTab, setActiveResourceTab] = useState<'view' | 'object' | 'term'>('view');
  const [selectedDirectoryKey, setSelectedDirectoryKey] = useState<string>();
  const [directoryExpandedKeys, setDirectoryExpandedKeys] = useState<React.Key[]>([]);
  const [relationModal, setRelationModal] = useState<any>(null);
  const [actionModal, setActionModal] = useState<any>(null);
  const [resourceDirectoryWidth, setResourceDirectoryWidth] = useState(260);
  const [resizingResourcePane, setResizingResourcePane] = useState(false);
  const [resourceDetailHidden, setResourceDetailHidden] = useState(false);
  const resourceDirectoryRef = useRef<HTMLElement | null>(null);
  const resourceExplorerBodyRef = useRef<HTMLDivElement | null>(null);
  const resourceResizeRef = useRef({ startX: 0, startWidth: 260, containerWidth: 0 });

  useEffect(() => {
    setFocusType(['base', 'scene', 'view'].includes(queryFocusType) ? queryFocusType : 'base');
    setSelectedSceneId(querySceneId);
    setSelectedViewCode(queryViewCode);
  }, [queryFocusType, querySceneId, queryViewCode]);

  useEffect(() => {
    setResourceDetailHidden(false);
  }, [baseId]);

  useEffect(() => {
    if (focusType === 'base') setActiveDetailTab('scene');
    if (focusType === 'scene') setActiveDetailTab('object');
    if (focusType === 'view') setActiveDetailTab('field');
    setActiveResourceContentTab('detail');
    setShowAllDistributions(false);
    setDistributionDrill(null);
  }, [focusType]);

  useEffect(() => {
    setShowAllDistributions(false);
    setDistributionDrill(null);
  }, [selectedSceneId, selectedViewCode]);

  useEffect(() => {
    setDistributionDrillSelection({ rows: [], type: '', context: {} });
  }, [distributionDrill?.key]);

  useEffect(() => {
    setDetailSelection({ rows: [], type: '', context: {} });
    setDetailSelectionResetKey((key) => key + 1);
  }, [activeDetailTab, activeResourceContentTab, focusType, keyword, selectedSceneId, selectedViewCode]);

  useEffect(() => {
    if (!baseId) return;
    let ignore = false;
    setLoading(true);
    listOntologyScenes({ ownerType, baseId })
      .then(async (res) => {
        const sceneList = toArray(getData(res));
        const detailEntries = await Promise.all(
          sceneList
            .map((scene: any) => scene?.sceneId)
            .filter(Boolean)
            .map((sceneId: string) =>
              getOntologySceneDetails({ ownerType, baseId, sceneId })
                .then((detailRes) => [sceneId, normalizeDetail(getData(detailRes))])
                .catch(() => [sceneId, normalizeDetail({})])
            )
        );
        if (ignore) return;
        const map: Record<string, any> = {};
        detailEntries.forEach(([sceneId, detail]: any) => {
          map[sceneId] = detail;
        });
        setScenes(sceneList);
        setDetailsBySceneId(map);
        const nextSceneId =
          querySceneId && sceneList.some((scene: any) => scene.sceneId === querySceneId)
            ? querySceneId
            : sceneList[0]?.sceneId;
        setSelectedSceneId((prev) =>
          prev && sceneList.some((scene: any) => scene.sceneId === prev) ? prev : nextSceneId
        );
      })
      .catch(() => {
        if (ignore) return;
        setScenes([]);
        setDetailsBySceneId({});
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [baseId, ownerType, querySceneId]);

  const sceneRows = useMemo(
    () =>
      scenes.map((scene: any) => {
        const detail = normalizeDetail(detailsBySceneId[scene.sceneId]);
        return {
          ...scene,
          detail,
          objectCount: detail.objects.length,
          viewCount: detail.views.length,
          relationCount: detail.relations.length,
          actionCount: detail.actions.length,
          datasourceCount: detail.datasources.length,
          totalCount:
            detail.objects.length +
            detail.views.length +
            detail.relations.length +
            detail.actions.length +
            detail.datasources.length,
        };
      }),
    [detailsBySceneId, scenes]
  );

  const selectedScene = useMemo(
    () => sceneRows.find((scene: any) => scene.sceneId === selectedSceneId) || sceneRows[0],
    [sceneRows, selectedSceneId]
  );
  const selectedDetail = selectedScene?.detail || normalizeDetail({});
  const selectedViews = selectedDetail.views || [];
  const selectedObjects = selectedDetail.objects || [];
  const selectedRelations = selectedDetail.relations || [];
  const selectedActions = selectedDetail.actions || [];

  useEffect(() => {
    if (focusType !== 'view') return;
    if (!selectedViews.length) return;
    if (selectedViewCode && selectedViews.some((view: any) => view.viewCode === selectedViewCode)) return;
    setSelectedViewCode(selectedViews[0]?.viewCode);
  }, [focusType, selectedViewCode, selectedViews]);

  const selectedView = useMemo(
    () => selectedViews.find((view: any) => view.viewCode === selectedViewCode) || selectedViews[0],
    [selectedViewCode, selectedViews]
  );

  const allObjects = useMemo(
    () =>
      sceneRows.flatMap((scene: any) =>
        scene.detail.objects.map((object: any) => ({
          ...object,
          sceneId: scene.sceneId,
          sceneName: scene.sceneName || scene.sceneId,
        }))
      ),
    [sceneRows]
  );
  const uniqueObjects = useMemo(() => uniqueBy(allObjects, (object) => object.objectCode), [allObjects]);
  const allViews = useMemo(
    () =>
      sceneRows.flatMap((scene: any) =>
        scene.detail.views.map((view: any) => ({
          ...view,
          sceneId: scene.sceneId,
          sceneName: scene.sceneName || scene.sceneId,
        }))
      ),
    [sceneRows]
  );
  const allRelations = useMemo(
    () =>
      sceneRows.flatMap((scene: any) =>
        scene.detail.relations.map((relation: any) => ({
          ...relation,
          sceneId: scene.sceneId,
          sceneName: scene.sceneName || scene.sceneId,
        }))
      ),
    [sceneRows]
  );
  const allActions = useMemo(
    () =>
      sceneRows.flatMap((scene: any) =>
        scene.detail.actions.map((action: any) => ({
          ...action,
          sceneId: scene.sceneId,
          sceneName: scene.sceneName || scene.sceneId,
        }))
      ),
    [sceneRows]
  );
  const allDatasources = useMemo(
    () =>
      sceneRows.flatMap((scene: any) =>
        scene.detail.datasources.map((datasource: any) => ({
          ...datasource,
          sceneId: scene.sceneId,
          sceneName: scene.sceneName || scene.sceneId,
        }))
      ),
    [sceneRows]
  );
  const allTerms = useMemo(
    () =>
      sceneRows.flatMap((scene: any) =>
        scene.detail.objects.flatMap((object: any) =>
          toArray(object.properties)
            .filter((property: any) => property.terminology || property.isTerminology || property.termCode)
            .map((property: any) => ({
              ...property,
              sceneId: scene.sceneId,
              sceneName: scene.sceneName || scene.sceneId,
              objectCode: object.objectCode,
              objectName: object.objectName || object.objectCode,
            }))
        )
      ),
    [sceneRows]
  );
  const unboundViews = allViews;
  const unboundObjects = allObjects;

  const objectByCode = useMemo(() => {
    const map: Record<string, any> = {};
    selectedObjects.forEach((object: any) => {
      if (object.objectCode) map[object.objectCode] = object;
    });
    return map;
  }, [selectedObjects]);
  const objectBySceneCode = useMemo(() => {
    const map: Record<string, any> = {};
    sceneRows.forEach((scene: any) => {
      scene.detail.objects.forEach((object: any) => {
        if (object.objectCode) map[`${scene.sceneId}:${object.objectCode}`] = object;
      });
    });
    return map;
  }, [sceneRows]);

  const directoryTreeData = useMemo(() => {
    if (activeResourceTab === 'view') {
      return sceneRows.map((scene: any) => ({
        key: `scene:${scene.sceneId}`,
        title: scene.sceneName || scene.sceneId,
        nodeType: 'scene',
        scene,
        isLeaf: false,
        children: [],
      }));
    }
    if (activeResourceTab === 'object') {
      return sceneRows.map((scene: any) => ({
        key: `scene:${scene.sceneId}`,
        title: scene.sceneName || scene.sceneId,
        nodeType: 'scene',
        scene,
        children: scene.detail.views.map((view: any) => ({
          key: `view:${scene.sceneId}:${view.viewCode}`,
          title: view.viewName || view.viewCode,
          nodeType: 'view',
          scene,
          view,
        })),
      }));
    }
    return sceneRows.map((scene: any) => ({
      key: `scene:${scene.sceneId}`,
      title: scene.sceneName || scene.sceneId,
      nodeType: 'scene',
      scene,
      children: scene.detail.views.map((view: any) => ({
        key: `view:${scene.sceneId}:${view.viewCode}`,
        title: view.viewName || view.viewCode,
        nodeType: 'view',
        scene,
        view,
      })),
    }));
  }, [activeResourceTab, sceneRows]);

  const flatDirectoryNodes = useMemo(() => {
    const output: any[] = [];
    const walk = (nodes: any[]) => {
      nodes.forEach((node) => {
        output.push(node);
        if (node.children) walk(node.children);
      });
    };
    walk(directoryTreeData);
    return output;
  }, [directoryTreeData]);

  const selectedDirectoryNode = useMemo(
    () => flatDirectoryNodes.find((node) => node.key === selectedDirectoryKey) || flatDirectoryNodes[0],
    [flatDirectoryNodes, selectedDirectoryKey]
  );

  useEffect(() => {
    if (!flatDirectoryNodes.length) {
      setSelectedDirectoryKey(undefined);
      setDirectoryExpandedKeys([]);
      return;
    }
    const existing = flatDirectoryNodes.some((node) => node.key === selectedDirectoryKey);
    if (!existing) setSelectedDirectoryKey(flatDirectoryNodes[0].key);
    setDirectoryExpandedKeys(
      directoryTreeData.filter((node: any) => node.children?.length).map((node: any) => node.key)
    );
  }, [activeResourceTab, directoryTreeData, flatDirectoryNodes, selectedDirectoryKey]);

  useEffect(() => {
    if (!selectedDirectoryKey) return;
    const directory = resourceDirectoryRef.current;
    if (!directory) return;
    window.requestAnimationFrame(() => {
      const currentNode = directory.querySelector(`.${fileTreeStyles.treeTitleContentCurrent}`);
      currentNode?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, [activeResourceTab, selectedDirectoryKey, directoryTreeData]);

  useEffect(() => {
    const onResize = () => {
      const containerWidth = resourceExplorerBodyRef.current?.getBoundingClientRect().width || 0;
      setResourceDirectoryWidth((width) => clampResourceDirectoryWidth(width, containerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!resizingResourcePane) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      const { startX, startWidth, containerWidth } = resourceResizeRef.current;
      setResourceDirectoryWidth(clampResourceDirectoryWidth(startWidth + event.clientX - startX, containerWidth));
    };
    const handlePointerUp = () => setResizingResourcePane(false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [resizingResourcePane]);

  const handleResourceResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const containerWidth = resourceExplorerBodyRef.current?.getBoundingClientRect().width || 0;
      resourceResizeRef.current = {
        startX: event.clientX,
        startWidth: resourceDirectoryWidth,
        containerWidth,
      };
      setResizingResourcePane(true);
      event.preventDefault();
    },
    [resourceDirectoryWidth]
  );

  const handleResourceResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -16 : 16;
    const containerWidth = resourceExplorerBodyRef.current?.getBoundingClientRect().width || 0;
    setResourceDirectoryWidth((width) => clampResourceDirectoryWidth(width + delta, containerWidth));
  }, []);

  const hideResourceDetailOnScroll = useCallback(() => {
    setResourceDetailHidden(true);
  }, []);

  const resourceRows = useMemo(() => {
    const node = selectedDirectoryNode;
    if (!node) return [];
    if (activeResourceTab === 'view') {
      return unboundViews.filter((view: any) => view.sceneId === node.scene?.sceneId);
    }
    if (activeResourceTab === 'object') {
      if (node.nodeType === 'view') {
        return toArray(node.view?.objectCodes)
          .map((code: string) => objectBySceneCode[`${node.scene.sceneId}:${code}`] || { objectCode: code })
          .map((object: any) => ({
            ...object,
            sceneId: node.scene.sceneId,
            sceneName: node.scene.sceneName || node.scene.sceneId,
            viewCode: node.view.viewCode,
            viewName: node.view.viewName || node.view.viewCode,
          }))
          .filter(Boolean);
      }
      return unboundObjects
        .filter((object: any) => object.sceneId === node.scene?.sceneId)
        .map((object: any) => ({ ...object, viewCode: undefined, viewName: undefined }));
    }
    if (node.nodeType === 'view') {
      const objectCodes = new Set(toArray(node.view?.objectCodes));
      return allTerms.filter((term: any) => term.sceneId === node.scene?.sceneId && objectCodes.has(term.objectCode));
    }
    return allTerms.filter((term: any) => term.sceneId === node.scene?.sceneId);
  }, [activeResourceTab, allTerms, objectBySceneCode, selectedDirectoryNode, unboundObjects, unboundViews]);

  const kw = keyword.trim().toLowerCase();
  const matchKeyword = (...values: any[]) => !kw || values.some((value) => `${value || ''}`.toLowerCase().includes(kw));

  const getReferenceMeta = useCallback(
    (row: any, type: string, context: any = {}) => {
      const sceneMeta = context.scene || (row?.sceneId ? row : selectedScene);
      const hasContextView = Object.prototype.hasOwnProperty.call(context, 'view');
      const viewMeta = hasContextView ? context.view : row?.viewCode ? row : type === 'field' ? selectedView : null;
      const sceneId = sceneMeta?.sceneId || row.sceneId;
      const sceneName = sceneMeta?.sceneName || row.sceneName;
      const viewCode = viewMeta?.viewCode || row.viewCode;
      const viewName = viewMeta?.viewName || row.viewName;
      const baseMeta = {
        baseId,
        ownerType,
        ontologyBaseCode: baseId,
        ontologyBaseName: resourceName,
      };
      const typeMap: Record<string, any> = {
        scene: {
          level: 'SCENE',
          key: `scene:${row.sceneId}`,
          resourceBizType: 'SCENE',
          resourceName: row.sceneName || row.sceneId,
          resourceCode: row.sceneId,
        },
        object: {
          level: viewMeta ? 'OBJECT_IN_VIEW' : 'OBJECT_IN_SCENE',
          key: viewMeta ? `vobj:${sceneId}:${viewCode}:${row.objectCode}` : `sobj:${sceneId}:${row.objectCode}`,
          resourceBizType: 'OBJECT',
          resourceName: row.objectName || row.objectCode,
          resourceCode: row.objectCode,
        },
        view: {
          level: 'VIEW',
          key: `view:${sceneId}:${row.viewCode}`,
          resourceBizType: 'VIEW',
          resourceName: row.viewName || row.viewCode,
          resourceCode: row.viewCode,
        },
        relation: {
          level: 'RELATION',
          key: `relation:${sceneId}:${row.relationCode || row.relationName}`,
          resourceBizType: 'RELATION',
          resourceName: row.relationName || row.relationCode,
          resourceCode: row.relationCode,
        },
        action: {
          level: 'ACTION',
          key: `action:${sceneId}:${row.actionCode || row.code || row.actionName || row.name}`,
          resourceBizType: 'ACTION',
          resourceName: row.actionName || row.actionCode || row.name || row.code,
          resourceCode: row.actionCode || row.code,
        },
        datasource: {
          level: 'DATASOURCE',
          key: `datasource:${sceneId}:${row.dbId || row.datasourceCode || row.code || row.datasourceName || row.name}`,
          resourceBizType: 'DATASOURCE',
          resourceName: row.dbName || row.datasourceName || row.name || row.dbId || row.datasourceCode || row.code,
          resourceCode: row.dbId || row.datasourceCode || row.code,
        },
        field: {
          level: 'PROPERTY',
          key: `field:${sceneId}:${viewCode}:${row.propertyCode || row.propertyName}`,
          resourceBizType: 'PROPERTY',
          resourceName: row.propertyName || row.propertyCode,
          resourceCode: row.propertyCode,
        },
      };
      const meta = typeMap[type] || typeMap.object;
      return {
        ...baseMeta,
        ...row,
        ...meta,
        isFromResourceModule: true,
        showQuotePrefix: true,
        sceneId,
        sceneName,
        viewCode,
        viewName,
        resourceId: `${baseId || ''}:${meta.key}`,
      };
    },
    [baseId, ownerType, resourceName, selectedScene, selectedView]
  );

  const quoteRowsToChat = useCallback(
    (rows: any[], type: string, context: any = {}) => {
      const quoteRows = toArray(rows).filter(Boolean);
      if (!quoteRows.length) return;
      const quotePayloads = quoteRows.map((row: any) => ({
        item: getReferenceMeta(row, type, context),
        type: DragType.OBJECT,
      }));
      const emitQuote = (waitForListeners = false) => {
        quotePayloads.forEach((quotePayload: any) => {
          EventEmitter?.emit(
            'queryInput-insert-item',
            {
              ...quotePayload,
            },
            waitForListeners ? { waitForListeners: true } : undefined
          );
        });
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
    [EventEmitter, getReferenceMeta, intl, navigate, pathname, setAgentId, setSessionId]
  );

  const handleReferenceSelectionChange = useCallback((selection: any) => {
    setDetailSelection({
      rows: selection?.rows || [],
      type: selection?.type || '',
      context: selection?.context || {},
    });
  }, []);

  const handleDistributionDrillSelectionChange = useCallback((selection: any) => {
    setDistributionDrillSelection({
      rows: selection?.rows || [],
      type: selection?.type || '',
      context: selection?.context || {},
    });
  }, []);

  const closeRightDetailPanel = useCallback(() => {
    clearDetailPanel?.();
  }, [clearDetailPanel]);

  const openObjectDetail = useCallback(
    (object: any, scene?: any, view?: any) => {
      if (!object?.objectCode) return;
      closeRightDetailPanel();
      const sceneMeta = scene || selectedScene;
      const viewMeta = view || null;
      const node = getReferenceMeta(object, 'object', { scene: sceneMeta, view: viewMeta });
      setDetailPanel?.(
        <OntologyNodeDrawer
          open
          panel
          node={node}
          baseId={baseId}
          ownerType={ownerType}
          showReference={false}
          onReference={() => quoteRowsToChat([object], 'object', { scene: sceneMeta, view: viewMeta })}
          onClose={() => clearDetailPanel?.()}
        />,
        { width: 350 }
      );
    },
    [
      baseId,
      clearDetailPanel,
      closeRightDetailPanel,
      getReferenceMeta,
      ownerType,
      quoteRowsToChat,
      selectedScene,
      setDetailPanel,
    ]
  );

  const openViewPanelDetail = useCallback(
    (view: any) => {
      if (!view?.viewCode) return;
      closeRightDetailPanel();
      const sceneMeta = sceneRows.find((scene: any) => scene.sceneId === view.sceneId) || selectedScene;
      const node = getReferenceMeta(view, 'view', { scene: sceneMeta, view });
      setDetailPanel?.(
        <OntologyNodeDrawer
          open
          panel
          node={node}
          baseId={baseId}
          ownerType={ownerType}
          showReference={false}
          onReference={() => quoteRowsToChat([view], 'view', { scene: sceneMeta, view })}
          onClose={() => clearDetailPanel?.()}
        />,
        { width: 380 }
      );
    },
    [
      baseId,
      clearDetailPanel,
      closeRightDetailPanel,
      getReferenceMeta,
      ownerType,
      quoteRowsToChat,
      sceneRows,
      selectedScene,
      setDetailPanel,
    ]
  );

  const jumpToViewObjects = useCallback(
    (view: any) => {
      closeRightDetailPanel();
      if (!view?.sceneId || !view?.viewCode) return;
      setActiveResourceTab('object');
      setSelectedDirectoryKey(`view:${view.sceneId}:${view.viewCode}`);
    },
    [closeRightDetailPanel]
  );

  const getViewRelations = useCallback(
    (view: any) => {
      const objectCodes = toArray(view?.objectCodes);
      return allRelations.filter(
        (relation: any) =>
          relation.sceneId === view.sceneId &&
          (objectCodes.includes(relation.sourceObjectCode) || objectCodes.includes(relation.targetObjectCode))
      );
    },
    [allRelations]
  );

  const getObjectActions = useCallback(
    (object: any) =>
      allActions.filter(
        (action: any) =>
          action.sceneId === object.sceneId && (action.belongObjectCode || action.objectCode) === object.objectCode
      ),
    [allActions]
  );

  const referenceButton = (row: any, type: string, context: any = {}) => (
    <Button type="link" size="small" onClick={() => quoteRowsToChat([row], type, context)}>
      {t('ontologyNode.action.reference')}
    </Button>
  );

  const operationColumn = (type: string, options: any = {}) => ({
    title: t('common.operation'),
    width: options.width || 180,
    render: (_: any, row: any) => {
      const context = options.getContext?.(row) || options.context || {};
      return (
        <div className={styles.operationActions}>
          {options.renderExtra?.(row)}
          {referenceButton(row, type, context)}
        </div>
      );
    },
  });

  const showSceneDetail = (sceneId: string) => {
    setSelectedSceneId(sceneId);
    setFocusType('scene');
    setKeyword('');
  };

  const showViewDetail = (view: any, scene?: any) => {
    if (scene?.sceneId) setSelectedSceneId(scene.sceneId);
    setSelectedViewCode(view?.viewCode);
    setFocusType('view');
    setKeyword('');
  };

  const sceneColumns = [
    {
      title: t('common.resourceType.scene'),
      ellipsis: true,
      render: (_: any, row: any) => (
        <div>
          <div className={styles.tableName}>{row.sceneName || row.sceneId}</div>
          <div className={styles.mono}>{row.sceneId}</div>
        </div>
      ),
    },
    { title: t('common.resourceType.object'), dataIndex: 'objectCount', width: 110 },
    { title: t('common.resourceType.view'), dataIndex: 'viewCount', width: 110 },
    { title: t('employeeDetail.ontology.relation'), dataIndex: 'relationCount', width: 110 },
    { title: t('ontologyCenter.detail.actions'), dataIndex: 'actionCount', width: 110 },
    operationColumn('scene', {
      renderExtra: (row: any) => (
        <Button type="link" size="small" onClick={() => showSceneDetail(row.sceneId)}>
          {t('ontologyCenter.detail.detail')}
        </Button>
      ),
    }),
  ];

  const propertyColumns = [
    { title: t('ontologyCenter.detail.col.name'), dataIndex: 'propertyName', ellipsis: true },
    {
      title: t('ontologyCenter.detail.col.code'),
      dataIndex: 'propertyCode',
      ellipsis: true,
      render: (value: string) => <span className={styles.mono}>{value}</span>,
    },
    {
      title: t('ontologyCenter.detail.col.type'),
      dataIndex: 'dataType',
      width: 110,
      render: (value: string) => (value ? <Tag color={DATA_TYPE_COLOR[value] || 'default'}>{value}</Tag> : '-'),
    },
    {
      title: t('ontologyCenter.detail.col.source'),
      width: 180,
      ellipsis: true,
      render: (_: any, row: any) => (
        <span className={styles.mono}>
          {row.sourceObject}
          {row.sourceObjectProperty ? `.${row.sourceObjectProperty}` : ''}
        </span>
      ),
    },
    operationColumn('field', {
      getContext: () => ({ scene: selectedScene, view: selectedView }),
      width: 150,
    }),
  ];

  const objectColumns = [
    {
      title: t('common.resourceType.object'),
      ellipsis: true,
      render: (_: any, row: any) => (
        <div>
          <div className={styles.tableName}>{row.objectName || row.objectCode}</div>
          <div className={styles.mono}>{row.objectCode}</div>
        </div>
      ),
    },
    {
      title: t('ontologyBaseDetail.scene'),
      dataIndex: 'sceneName',
      width: 160,
      ellipsis: true,
      render: (value: string, row: any) => value || selectedScene?.sceneName || row.sceneId || '-',
    },
    {
      title: t('ontologyCenter.detail.attributes'),
      width: 110,
      render: (_: any, row: any) => (row.properties || []).length,
    },
    operationColumn('object', {
      getContext: (row: any) => ({ scene: row.sceneId ? row : selectedScene }),
      renderExtra: (row: any) => (
        <Button type="link" size="small" onClick={() => openObjectDetail(row, row.sceneId ? row : selectedScene)}>
          {t('ontologyCenter.detail.detail')}
        </Button>
      ),
    }),
  ];

  const viewColumns = [
    {
      title: t('common.resourceType.view'),
      ellipsis: true,
      render: (_: any, row: any) => (
        <div>
          <div className={styles.tableName}>{row.viewName || row.viewCode}</div>
          <div className={styles.mono}>{row.viewCode}</div>
        </div>
      ),
    },
    {
      title: t('ontologyBaseDetail.scene'),
      dataIndex: 'sceneName',
      width: 160,
      ellipsis: true,
      render: (value: string, row: any) => value || selectedScene?.sceneName || row.sceneId || '-',
    },
    {
      title: t('ontologyCenter.detail.attributes'),
      width: 110,
      render: (_: any, row: any) => (row.properties || []).length,
    },
    operationColumn('view', {
      getContext: (row: any) => ({ scene: row.sceneId ? row : selectedScene, view: row }),
      renderExtra: (row: any) => (
        <Button type="link" size="small" onClick={() => showViewDetail(row, row.sceneId ? row : selectedScene)}>
          {t('ontologyCenter.detail.detail')}
        </Button>
      ),
    }),
  ];

  const relationColumns = [
    {
      title: t('ontologyCenter.detail.rel.name'),
      ellipsis: true,
      render: (_: any, row: any) => row.relationName || row.relationCode || '-',
    },
    {
      title: t('ontologyCenter.detail.rel.cardinality'),
      dataIndex: 'relationCardinality',
      width: 128,
      render: (value: string) => (value ? <Tag className={styles.cardinalityTag}>{value}</Tag> : '-'),
    },
    {
      title: t('ontologyCenter.detail.rel.source'),
      width: 180,
      ellipsis: true,
      render: (_: any, row: any) => row.sourceObjectName || row.sourceObjectCode || '-',
    },
    {
      title: t('ontologyCenter.detail.rel.target'),
      width: 180,
      ellipsis: true,
      render: (_: any, row: any) => row.targetObjectName || row.targetObjectCode || '-',
    },
    operationColumn('relation', {
      getContext: (row: any) => ({ scene: row.sceneId ? row : selectedScene }),
      width: 150,
    }),
  ];

  const actionColumns = [
    {
      title: t('ontologyCenter.detail.actions'),
      ellipsis: true,
      render: (_: any, row: any) => (
        <div>
          <div className={styles.tableName}>{row.actionName || row.actionCode || row.name || row.code || '-'}</div>
          <div className={styles.mono}>{row.actionCode || row.code || '-'}</div>
        </div>
      ),
    },
    {
      title: t('ontologyBaseDetail.scene'),
      dataIndex: 'sceneName',
      width: 160,
      ellipsis: true,
      render: (value: string, row: any) => value || selectedScene?.sceneName || row.sceneId || '-',
    },
    {
      title: t('ontologyBaseDetail.belongObject'),
      width: 180,
      ellipsis: true,
      render: (_: any, row: any) => row.belongObjectName || row.belongObjectCode || row.objectCode || '-',
    },
    {
      title: t('ontologyBaseDetail.actionType'),
      width: 120,
      render: (_: any, row: any) => (row.actionType || row.type ? <Tag>{row.actionType || row.type}</Tag> : '-'),
    },
    {
      title: t('common.requestMethod'),
      width: 120,
      render: (_: any, row: any) => row.requestMethod || row.method || '-',
    },
    operationColumn('action', {
      getContext: (row: any) => ({ scene: row.sceneId ? row : selectedScene }),
      width: 150,
    }),
  ];

  const datasourceColumns = [
    {
      title: t('ontologyBaseDetail.datasource'),
      ellipsis: true,
      render: (_: any, row: any) => (
        <div>
          <div className={styles.tableName}>{row.dbName || row.datasourceName || row.name || row.dbId || '-'}</div>
          <div className={styles.mono}>{row.dbId || row.datasourceCode || row.code || '-'}</div>
        </div>
      ),
    },
    {
      title: t('ontologyBaseDetail.scene'),
      dataIndex: 'sceneName',
      width: 160,
      ellipsis: true,
      render: (value: string, row: any) => value || selectedScene?.sceneName || row.sceneId || '-',
    },
    {
      title: t('ontologyBaseDetail.datasourceType'),
      width: 140,
      render: (_: any, row: any) => row.dbType || row.datasourceType || row.type || '-',
    },
    {
      title: t('ontologyBaseDetail.datasourceHost'),
      ellipsis: true,
      render: (_: any, row: any) => row.host || row.url || row.jdbcUrl || row.endpoint || '-',
    },
    operationColumn('datasource', {
      getContext: (row: any) => ({ scene: row.sceneId ? row : selectedScene }),
      width: 150,
    }),
  ];

  const browseRelationColumns = relationColumns.filter((column: any) => column.title !== t('common.operation'));
  const browseActionColumns = actionColumns.filter((column: any) => column.title !== t('common.operation'));

  const viewResourceColumns = [
    {
      title: t('common.resourceType.view'),
      ellipsis: true,
      render: (_: any, row: any) => (
        <div>
          <div className={styles.tableName}>{row.viewName || row.viewCode}</div>
          <div className={styles.mono}>{row.viewCode}</div>
        </div>
      ),
    },
    {
      title: t('ontologyBaseDetail.scene'),
      dataIndex: 'sceneName',
      width: 160,
      ellipsis: true,
    },
    {
      title: t('common.resourceType.object'),
      width: 110,
      render: (_: any, row: any) => toArray(row.objectCodes).length,
    },
    {
      title: t('ontologyCenter.detail.attributes'),
      width: 110,
      render: (_: any, row: any) => toArray(row.properties).length,
    },
    {
      title: t('ontologyCenter.detail.relList'),
      width: 100,
      render: (_: any, row: any) => getViewRelations(row).length,
    },
    {
      title: t('common.operation'),
      width: 160,
      render: (_: any, row: any) => {
        return (
          <div className={styles.operationActions}>
            <Button type="link" size="small" onClick={() => openViewPanelDetail(row)}>
              {t('ontologyCenter.detail.detail')}
            </Button>
            <Button type="link" size="small" onClick={() => jumpToViewObjects(row)}>
              {t('common.resourceType.object')}
            </Button>
            <Button
              type="link"
              size="small"
              onClick={() => {
                closeRightDetailPanel();
                setRelationModal({
                  title: row.viewName || row.viewCode,
                  relations: getViewRelations(row),
                  objects: toArray(row.objectCodes).map(
                    (code: string) => objectBySceneCode[`${row.sceneId}:${code}`] || { objectCode: code }
                  ),
                });
              }}
            >
              {t('employeeDetail.ontology.relation')}
            </Button>
          </div>
        );
      },
    },
  ];

  const objectResourceColumns = [
    {
      title: t('common.resourceType.object'),
      ellipsis: true,
      render: (_: any, row: any) => (
        <div>
          <div className={styles.tableName}>{row.objectName || row.objectCode}</div>
          <div className={styles.mono}>{row.objectCode}</div>
        </div>
      ),
    },
    {
      title: t('ontologyBaseDetail.scene'),
      dataIndex: 'sceneName',
      width: 150,
      ellipsis: true,
    },
    {
      title: t('common.resourceType.view'),
      width: 150,
      ellipsis: true,
      render: (_: any, row: any) => row.viewName || row.viewCode || '-',
    },
    {
      title: t('ontologyBaseDetail.objectSourceLabel'),
      width: 140,
      ellipsis: true,
      render: (_: any, row: any) => row.objectSource || '-',
    },
    {
      title: t('ontologyCenter.detail.attributes'),
      width: 100,
      render: (_: any, row: any) => toArray(row.properties).length,
    },
    {
      title: t('ontologyCenter.detail.actions'),
      width: 90,
      render: (_: any, row: any) => getObjectActions(row).length,
    },
    {
      title: t('common.operation'),
      width: 120,
      render: (_: any, row: any) => {
        const sceneMeta = sceneRows.find((scene: any) => scene.sceneId === row.sceneId) || selectedScene;
        const viewMeta = row.viewCode ? { viewCode: row.viewCode, viewName: row.viewName } : null;
        return (
          <div className={styles.operationActions}>
            <Button type="link" size="small" onClick={() => openObjectDetail(row, sceneMeta, viewMeta)}>
              {t('ontologyCenter.detail.detail')}
            </Button>
            <Button
              type="link"
              size="small"
              onClick={() => {
                closeRightDetailPanel();
                setActionModal({
                  title: row.objectName || row.objectCode,
                  actions: getObjectActions(row),
                });
              }}
            >
              {t('ontologyBaseDetail.action.actions')}
            </Button>
          </div>
        );
      },
    },
  ];

  const termResourceColumns = [
    {
      title: t('common.resourceType.term'),
      ellipsis: true,
      render: (_: any, row: any) => (
        <div>
          <div className={styles.tableName}>{row.termName || row.propertyName || row.propertyCode}</div>
          <div className={styles.mono}>{row.termCode || row.propertyCode}</div>
        </div>
      ),
    },
    {
      title: t('ontologyBaseDetail.scene'),
      dataIndex: 'sceneName',
      width: 150,
      ellipsis: true,
    },
    {
      title: t('common.resourceType.object'),
      width: 160,
      ellipsis: true,
      render: (_: any, row: any) => row.objectName || row.objectCode || '-',
    },
    {
      title: t('ontologyCenter.detail.col.type'),
      dataIndex: 'dataType',
      width: 110,
      render: (value: string) => (value ? <Tag color={DATA_TYPE_COLOR[value] || 'default'}>{value}</Tag> : '-'),
    },
  ];

  const renderDirectoryTitle = (node: any) => {
    const nodeKey = node.key ?? node.eventKey;
    const selected = selectedDirectoryKey === nodeKey;
    const expanded = directoryExpandedKeys.includes(nodeKey);
    return (
      <span
        className={classnames(
          fileTreeStyles.treeTitleContent,
          expanded ? fileTreeStyles.treeTitleContentExpanded : undefined,
          selected ? fileTreeStyles.treeTitleContentCurrent : undefined
        )}
      >
        <Tooltip title={node.title} placement="right">
          <span className={fileTreeStyles.treeTitleName}>
            <span className={fileTreeStyles.treeTitleText}>{node.title}</span>
          </span>
        </Tooltip>
      </span>
    );
  };

  const renderDirectoryIcon = (node: any) => {
    const nodeKey = node.key ?? node.eventKey;
    const expanded = directoryExpandedKeys.includes(nodeKey);
    const iconType = expanded ? 'a-Folder-openwenjianjia-kai' : 'wenjianjialanse';
    return (
      <Tooltip title={node.title} placement="right">
        <span>
          <AntdIcon type={`icon-${iconType}`} />
        </span>
      </Tooltip>
    );
  };

  const resourceTabConfig = {
    view: {
      label: t('common.resourceType.view'),
      columns: viewResourceColumns,
      rowKey: (row: any) => `${row.sceneId}:${row.viewCode}`,
    },
    object: {
      label: t('common.resourceType.object'),
      columns: objectResourceColumns,
      rowKey: (row: any) => `${row.sceneId}:${row.viewCode || ''}:${row.objectCode}`,
    },
    term: {
      label: t('common.resourceType.term'),
      columns: termResourceColumns,
      rowKey: (row: any, index: number) => `${row.sceneId}:${row.objectCode}:${row.propertyCode || index}`,
    },
  };

  const renderResourceExplorer = () => {
    const currentConfig = resourceTabConfig[activeResourceTab];
    const decoratedTreeData = decorateDirectoryTree(directoryTreeData, directoryExpandedKeys);
    return (
      <ResourceSection
        title={t('ontologyBaseDetail.section.resourceContent')}
        extra={
          resourceDetailHidden ? (
            <Button size="small" className={styles.resourceDetailToggle} onClick={() => setResourceDetailHidden(false)}>
              {t('ontologyBaseDetail.showBaseDetail')}
            </Button>
          ) : null
        }
      >
        <div className={styles.resourceExplorer}>
          <Tabs
            className={styles.resourceTabs}
            activeKey={activeResourceTab}
            onChange={(key) => {
              setActiveResourceTab(key as 'view' | 'object' | 'term');
              setKeyword('');
            }}
            items={[
              { key: 'view', label: t('common.resourceType.view') },
              { key: 'object', label: t('common.resourceType.object') },
              { key: 'term', label: t('common.resourceType.term') },
            ].map((item) => ({ ...item, children: null }))}
          />
          <div
            ref={resourceExplorerBodyRef}
            className={styles.resourceExplorerBody}
            style={{ '--resource-directory-width': `${resourceDirectoryWidth}px` }}
          >
            <aside
              ref={resourceDirectoryRef}
              className={styles.resourceDirectory}
              onScroll={hideResourceDetailOnScroll}
            >
              {decoratedTreeData.length ? (
                <Tree.DirectoryTree
                  blockNode
                  showIcon
                  selectable={false}
                  treeData={decoratedTreeData}
                  expandedKeys={directoryExpandedKeys}
                  selectedKeys={selectedDirectoryKey ? [selectedDirectoryKey] : []}
                  onExpand={(keys) => setDirectoryExpandedKeys(keys)}
                  onClick={(_, node: any) => setSelectedDirectoryKey(node.key)}
                  icon={renderDirectoryIcon}
                  titleRender={renderDirectoryTitle}
                  className={classnames(commonTreeStyles.tree, fileTreeStyles.fileTree)}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </aside>
            <Tooltip title={t('ontologyBaseDetail.resizePane')}>
              <button
                type="button"
                className={classnames(styles.resourceResizeHandle, {
                  [styles.resourceResizeHandleActive]: resizingResourcePane,
                })}
                aria-label={t('ontologyBaseDetail.resizePane')}
                onPointerDown={handleResourceResizePointerDown}
                onKeyDown={handleResourceResizeKeyDown}
              >
                <HolderOutlined />
              </button>
            </Tooltip>
            <main className={styles.resourceListPane} onScroll={hideResourceDetailOnScroll}>
              <div className={styles.resourceListHeader}>
                <div>
                  <span className={styles.resourceListTitle}>{currentConfig.label}</span>
                  {selectedDirectoryNode && (
                    <span className={styles.resourceListSubtitle}> / {selectedDirectoryNode.title}</span>
                  )}
                </div>
                <Input
                  className={styles.searchInput}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  suffix={<SearchOutlined />}
                  placeholder={t('ontologyBaseDetail.searchPlaceholder')}
                  allowClear
                />
              </div>
              <Table
                size="small"
                tableLayout="fixed"
                rowKey={currentConfig.rowKey}
                dataSource={resourceRows.filter((row: any) =>
                  matchKeyword(
                    row.viewName,
                    row.viewCode,
                    row.objectName,
                    row.objectCode,
                    row.propertyName,
                    row.propertyCode,
                    row.termName,
                    row.termCode
                  )
                )}
                columns={currentConfig.columns as any}
                pagination={false}
                scroll={{ x: activeResourceTab === 'term' ? 720 : 920 }}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              />
            </main>
          </div>
        </div>
      </ResourceSection>
    );
  };

  const openDistributionDrill = (distribution: any, bucket: any) => {
    setDistributionDrill({
      key: `${distribution.key}:${bucket.name}`,
      title: distribution.title,
      bucketName: bucket.name,
      rows: bucket.rows || [],
      columns: distribution.columns || [],
      rowKey: distribution.rowKey,
      referenceType: distribution.referenceType,
      referenceContext: distribution.referenceContext || {},
    });
  };

  const renderDistributionDrill = () => {
    if (!distributionDrill) return null;
    const rows = distributionDrill.rows || [];
    const selectedCount = distributionDrillSelection.rows?.length || 0;
    return (
      <ResourceSection
        title={
          <span>
            {t('ontologyBaseDetail.section.distributionDrill')}：{distributionDrill.title} /{' '}
            {distributionDrill.bucketName}
          </span>
        }
        extra={
          <div className={styles.drillHeaderActions}>
            <Button
              size="small"
              disabled={!selectedCount || !distributionDrillSelection.type}
              onClick={() =>
                quoteRowsToChat(
                  distributionDrillSelection.rows,
                  distributionDrillSelection.type,
                  distributionDrillSelection.context
                )
              }
            >
              {t('ontologyBaseDetail.batchReference', { count: selectedCount })}
            </Button>
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setDistributionDrill(null)} />
          </div>
        }
      >
        <div className={styles.drillPanel}>
          <div className={styles.drillSummary}>
            {t('ontologyBaseDetail.distributionDrillCount', { count: rows.length })}
          </div>
          <ReferenceDetailTable
            size="small"
            rowKey={distributionDrill.rowKey || ((row: any, index: number) => row.code || row.id || index)}
            dataSource={rows}
            pagination={false}
            columns={distributionDrill.columns}
            onReferenceSelectionChange={handleDistributionDrillSelectionChange}
            referenceType={distributionDrill.referenceType}
            referenceContext={distributionDrill.referenceContext}
            selectionResetKey={distributionDrill.key}
          />
        </div>
      </ResourceSection>
    );
  };

  const renderHeader = () => {
    return (
      <>
        <div className={styles.back} onClick={() => navigate(backPath)}>
          <LeftOutlined /> {t('layout.back')}
        </div>
        {!resourceDetailHidden && (
          <ResourceSection title={t('ontologyBaseDetail.section.resource')}>
            <div className={styles.header}>
              <div className={styles.headerIcon}>
                <DatabaseOutlined style={{ fontSize: 26 }} />
              </div>
              <div className={styles.headerMain}>
                <div className={styles.headerNameRow}>
                  <span className={styles.headerName}>{resourceName || baseId}</span>
                  <Tag color="blue">{t('ontologyNode.title.base')}</Tag>
                </div>
                <div className={styles.headerCode}>{resourceCode || baseId}</div>
              </div>
            </div>
          </ResourceSection>
        )}
      </>
    );
  };

  const renderKeywordInput = () => {
    const selectedCount = detailSelection.rows?.length || 0;
    return (
      <div className={styles.detailTabTools}>
        <Button
          size="small"
          disabled={!selectedCount || !detailSelection.type}
          onClick={() => quoteRowsToChat(detailSelection.rows, detailSelection.type, detailSelection.context)}
        >
          {t('ontologyBaseDetail.batchReference', { count: selectedCount })}
        </Button>
        <Input
          className={styles.searchInput}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          suffix={<SearchOutlined />}
          placeholder={t('ontologyBaseDetail.searchPlaceholder')}
          allowClear
        />
      </div>
    );
  };

  const renderResourceContentTabs = (detailItems: any[], distributionItems: any[]) => (
    <section className={classnames(styles.resourceSection, styles.resourceContentSection)}>
      <Tabs
        className={styles.resourceContentTabs}
        activeKey={activeResourceContentTab}
        onChange={setActiveResourceContentTab}
        items={[
          {
            key: 'detail',
            label: t('ontologyBaseDetail.section.detail'),
            children: (
              <Tabs
                className={classnames(styles.detailTabs, styles.detailTabsEmbedded)}
                activeKey={activeDetailTab}
                onChange={setActiveDetailTab}
                tabBarExtraContent={renderKeywordInput()}
                items={detailItems}
              />
            ),
          },
          {
            key: 'distribution',
            label: t('ontologyBaseDetail.section.distribution'),
            children: (
              <>
                <DistributionContent
                  items={distributionItems}
                  expanded={showAllDistributions}
                  onToggle={() => setShowAllDistributions((v) => !v)}
                  onDrill={openDistributionDrill}
                  t={t}
                />
                {renderDistributionDrill()}
              </>
            ),
          },
        ]}
      />
    </section>
  );

  const renderBaseDetail = () => {
    const filteredObjects = uniqueObjects.filter((object: any) =>
      matchKeyword(object.objectName, object.objectCode, object.sceneName)
    );
    const filteredViews = allViews.filter((view: any) => matchKeyword(view.viewName, view.viewCode, view.sceneName));
    const filteredRelations = allRelations.filter((relation: any) =>
      matchKeyword(relation.relationName, relation.relationCode, relation.sourceObjectName, relation.targetObjectName)
    );
    const filteredActions = allActions.filter((action: any) =>
      matchKeyword(
        action.actionName,
        action.actionCode,
        action.belongObjectName,
        action.belongObjectCode,
        action.sceneName
      )
    );
    const filteredDatasources = allDatasources.filter((datasource: any) =>
      matchKeyword(
        datasource.dbName,
        datasource.datasourceName,
        datasource.dbId,
        datasource.datasourceCode,
        datasource.host,
        datasource.url,
        datasource.sceneName
      )
    );
    const objectSourceDistribution = groupRowsBy(
      uniqueObjects,
      (object) => object.objectSource || t('ontologyBaseDetail.unknown'),
      (source, rows) =>
        getDistributionValueLabel({
          raw: source,
          rows,
          labelFields: [
            'objectSourceName',
            'objectSourceLabel',
            'objectSourceDesc',
            'sourceName',
            'sourceLabel',
            'sourceDesc',
          ],
          fallbackLabel: getBilingualLabel(t, OBJECT_SOURCE_LABEL_KEYS, source, '').replace(` ${source}`, ''),
        })
    );
    const sceneScaleDistribution = sceneRows.map((scene: any) => ({
      name: scene.sceneName || scene.sceneId,
      value: scene.totalCount,
      rows: [scene],
    }));
    const viewObjectCountDistribution = allViews.map((view: any) => ({
      name: view.viewName || view.viewCode,
      value: toArray(view.objectCodes).length,
      rows: [view],
    }));
    const relationSourceDistribution = groupRowsBy(
      allRelations,
      (relation) => relation.sourceObjectName || relation.sourceObjectCode || t('ontologyBaseDetail.unknown')
    );
    const actionObjectDistribution = groupRowsBy(
      allActions,
      (action) =>
        action.belongObjectName ||
        action.belongObjectCode ||
        action.objectName ||
        action.objectCode ||
        t('ontologyBaseDetail.unknown')
    );
    const sceneRelationDensityDistribution = sceneRows.map((scene: any) => ({
      name: scene.sceneName || scene.sceneId,
      value: scene.objectCount ? scene.relationCount / scene.objectCount : 0,
      rows: [scene],
    }));
    const datasourceTypeDistribution = groupRowsBy(
      allDatasources,
      (datasource) =>
        datasource.dbType || datasource.datasourceType || datasource.type || t('ontologyBaseDetail.unknown'),
      (type, rows) =>
        getDistributionValueLabel({
          raw: type,
          rows,
          labelFields: [
            'dbTypeName',
            'dbTypeLabel',
            'datasourceTypeName',
            'datasourceTypeLabel',
            'typeName',
            'typeLabel',
          ],
          fallbackLabel: getBilingualLabel(t, DATASOURCE_TYPE_LABEL_KEYS, type, '').replace(` ${type}`, ''),
        })
    );
    const baseDistributionItems = [
      {
        key: 'scene-scale',
        title: t('ontologyBaseDetail.sceneDistribution'),
        tooltip: t('ontologyBaseDetail.sceneDistributionTip'),
        data: sceneScaleDistribution,
        columns: sceneColumns,
        rowKey: 'sceneId',
        referenceType: 'scene',
      },
      {
        key: 'object-source',
        title: t('ontologyBaseDetail.objectSourceDistribution'),
        tooltip: t('ontologyBaseDetail.objectSourceDistributionTip'),
        data: objectSourceDistribution,
        columns: objectColumns,
        rowKey: 'objectCode',
        referenceType: 'object',
      },
      {
        key: 'view-object-count',
        title: t('ontologyBaseDetail.viewObjectCountDistribution'),
        tooltip: t('ontologyBaseDetail.viewObjectCountDistributionTip'),
        data: viewObjectCountDistribution,
        columns: viewColumns,
        rowKey: (row: any) => `${row.sceneId || ''}:${row.viewCode}`,
        referenceType: 'view',
      },
      {
        key: 'relation-source',
        title: t('ontologyBaseDetail.relationSourceDistribution'),
        tooltip: t('ontologyBaseDetail.relationSourceDistributionTip'),
        data: relationSourceDistribution,
        columns: relationColumns,
        rowKey: (row: any, index: number) => `${row.sceneId || ''}:${row.relationCode || index}`,
        referenceType: 'relation',
      },
      {
        key: 'action-object',
        title: t('ontologyBaseDetail.actionObjectDistribution'),
        tooltip: t('ontologyBaseDetail.actionObjectDistributionTip'),
        data: actionObjectDistribution,
        columns: actionColumns,
        rowKey: (row: any, index: number) => `${row.sceneId || ''}:${row.actionCode || row.code || index}`,
        referenceType: 'action',
      },
      {
        key: 'scene-relation-density',
        title: t('ontologyBaseDetail.sceneRelationDensityDistribution'),
        tooltip: t('ontologyBaseDetail.sceneRelationDensityDistributionTip'),
        data: sceneRelationDensityDistribution,
        columns: sceneColumns,
        rowKey: 'sceneId',
        referenceType: 'scene',
      },
      {
        key: 'datasource-type',
        title: t('ontologyBaseDetail.datasourceTypeDistribution'),
        tooltip: t('ontologyBaseDetail.datasourceTypeDistributionTip'),
        data: datasourceTypeDistribution,
        columns: datasourceColumns,
        rowKey: (row: any, index: number) =>
          `${row.sceneId || ''}:${row.dbId || row.datasourceCode || row.code || index}`,
        referenceType: 'datasource',
      },
    ];
    return (
      <>
        {renderResourceContentTabs(
          [
            {
              key: 'scene',
              label: `${t('common.resourceType.scene')} (${sceneRows.length})`,
              children: (
                <ReferenceDetailTable
                  size="small"
                  rowKey="sceneId"
                  dataSource={sceneRows.filter((scene: any) => matchKeyword(scene.sceneName, scene.sceneId))}
                  pagination={false}
                  columns={sceneColumns}
                  onReference={(rows: any[]) => quoteRowsToChat(rows, 'scene')}
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceType="scene"
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
            {
              key: 'object',
              label: `${t('common.resourceType.object')} (${uniqueObjects.length})`,
              children: (
                <ReferenceDetailTable
                  size="small"
                  rowKey={(row: any) => row.objectCode}
                  dataSource={filteredObjects}
                  pagination={false}
                  columns={objectColumns}
                  onReference={(rows: any[]) => quoteRowsToChat(rows, 'object')}
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceType="object"
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
            {
              key: 'view',
              label: `${t('common.resourceType.view')} (${allViews.length})`,
              children: (
                <ReferenceDetailTable
                  size="small"
                  rowKey={(row: any) => `${row.sceneId}:${row.viewCode}`}
                  dataSource={filteredViews}
                  pagination={false}
                  columns={viewColumns}
                  onReference={(rows: any[]) => quoteRowsToChat(rows, 'view')}
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceType="view"
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
            {
              key: 'relation',
              label: `${t('employeeDetail.ontology.relation')} (${allRelations.length})`,
              children: (
                <RelationPanel
                  relations={filteredRelations}
                  objects={uniqueObjects}
                  columns={relationColumns}
                  t={t}
                  onReference={(rows: any[]) => quoteRowsToChat(rows, 'relation')}
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
            {
              key: 'action',
              label: `${t('ontologyCenter.detail.actions')} (${allActions.length})`,
              children: (
                <ReferenceDetailTable
                  size="small"
                  rowKey={(row: any, index) => `${row.sceneId}:${row.actionCode || row.code || index}`}
                  dataSource={filteredActions}
                  pagination={false}
                  columns={actionColumns}
                  onReference={(rows: any[]) => quoteRowsToChat(rows, 'action')}
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceType="action"
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
            {
              key: 'datasource',
              label: `${t('ontologyBaseDetail.datasource')} (${allDatasources.length})`,
              children: (
                <ReferenceDetailTable
                  size="small"
                  rowKey={(row: any, index) => `${row.sceneId}:${row.dbId || row.datasourceCode || row.code || index}`}
                  dataSource={filteredDatasources}
                  pagination={false}
                  columns={datasourceColumns}
                  onReference={(rows: any[]) => quoteRowsToChat(rows, 'datasource')}
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceType="datasource"
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
          ],
          baseDistributionItems
        )}
      </>
    );
  };

  const renderSceneDetail = () => {
    if (!selectedScene) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    const filteredObjects = selectedObjects.filter((object: any) => matchKeyword(object.objectName, object.objectCode));
    const filteredViews = selectedViews.filter((view: any) => matchKeyword(view.viewName, view.viewCode));
    const filteredRelations = selectedRelations.filter((relation: any) =>
      matchKeyword(relation.relationName, relation.relationCode, relation.sourceObjectName, relation.targetObjectName)
    );
    const filteredActions = selectedActions.filter((action: any) =>
      matchKeyword(action.actionName, action.actionCode, action.belongObjectName, action.belongObjectCode)
    );
    const sceneObjectSourceDistribution = groupRowsBy(
      selectedObjects,
      (object) => object.objectSource || t('ontologyBaseDetail.unknown'),
      (source, rows) =>
        getDistributionValueLabel({
          raw: source,
          rows,
          labelFields: [
            'objectSourceName',
            'objectSourceLabel',
            'objectSourceDesc',
            'sourceName',
            'sourceLabel',
            'sourceDesc',
          ],
          fallbackLabel: getBilingualLabel(t, OBJECT_SOURCE_LABEL_KEYS, source, '').replace(` ${source}`, ''),
        })
    );
    const sceneRelationTargetDistribution = groupRowsBy(
      selectedRelations,
      (relation) => relation.targetObjectName || relation.targetObjectCode || t('ontologyBaseDetail.unknown')
    );
    const sceneViewObjectCountDistribution = selectedViews.map((view: any) => ({
      name: view.viewName || view.viewCode,
      value: toArray(view.objectCodes).length,
      rows: [view],
    }));
    const objectPropertyCountDistribution = selectedObjects.map((object: any) => ({
      name: object.objectName || object.objectCode,
      value: toArray(object.properties).length,
      rows: [object],
    }));
    const sceneRelationSourceDistribution = groupRowsBy(
      selectedRelations,
      (relation) => relation.sourceObjectName || relation.sourceObjectCode || t('ontologyBaseDetail.unknown')
    );
    const sceneActionObjectDistribution = groupRowsBy(
      selectedActions,
      (action) =>
        action.belongObjectName ||
        action.belongObjectCode ||
        action.objectName ||
        action.objectCode ||
        t('ontologyBaseDetail.unknown')
    );
    const objectConceptTypeDistribution = groupRowsBy(
      selectedObjects,
      (object) => object.conceptType || t('ontologyBaseDetail.unknown'),
      (conceptType, rows) => {
        let fallbackLabel = '';
        if (conceptType === '1') fallbackLabel = `${t('ontologyCenter.detail.conceptEntity')} BUSINESS_ENTITY`;
        if (conceptType === '2') fallbackLabel = `${t('ontologyCenter.detail.conceptActivity')} ACTIVITY_ENTITY`;
        return getDistributionValueLabel({
          raw: conceptType,
          rows,
          labelFields: ['conceptTypeName', 'conceptTypeLabel', 'typeName', 'typeLabel'],
          fallbackLabel,
          appendRaw: !fallbackLabel,
        });
      }
    );
    const sceneDistributionItems = [
      {
        key: 'object-source',
        title: t('ontologyBaseDetail.objectSourceDistribution'),
        tooltip: t('ontologyBaseDetail.objectSourceDistributionTip'),
        data: sceneObjectSourceDistribution,
        columns: objectColumns,
        rowKey: 'objectCode',
        referenceType: 'object',
        referenceContext: { scene: selectedScene },
      },
      {
        key: 'relation-target',
        title: t('ontologyBaseDetail.relationTargetDistribution'),
        tooltip: t('ontologyBaseDetail.relationTargetDistributionTip'),
        data: sceneRelationTargetDistribution,
        columns: relationColumns,
        rowKey: (row: any, index: number) => row.relationCode || index,
        referenceType: 'relation',
        referenceContext: { scene: selectedScene },
      },
      {
        key: 'view-object-count',
        title: t('ontologyBaseDetail.viewObjectCountDistribution'),
        tooltip: t('ontologyBaseDetail.viewObjectCountDistributionTip'),
        data: sceneViewObjectCountDistribution,
        columns: viewColumns,
        rowKey: 'viewCode',
        referenceType: 'view',
        referenceContext: { scene: selectedScene },
      },
      {
        key: 'object-property-count',
        title: t('ontologyBaseDetail.objectPropertyCountDistribution'),
        tooltip: t('ontologyBaseDetail.objectPropertyCountDistributionTip'),
        data: objectPropertyCountDistribution,
        columns: objectColumns,
        rowKey: 'objectCode',
        referenceType: 'object',
        referenceContext: { scene: selectedScene },
      },
      {
        key: 'relation-source',
        title: t('ontologyBaseDetail.relationSourceDistribution'),
        tooltip: t('ontologyBaseDetail.relationSourceDistributionTip'),
        data: sceneRelationSourceDistribution,
        columns: relationColumns,
        rowKey: (row: any, index: number) => row.relationCode || index,
        referenceType: 'relation',
        referenceContext: { scene: selectedScene },
      },
      {
        key: 'action-object',
        title: t('ontologyBaseDetail.actionObjectDistribution'),
        tooltip: t('ontologyBaseDetail.actionObjectDistributionTip'),
        data: sceneActionObjectDistribution,
        columns: actionColumns,
        rowKey: (row: any, index: number) => row.actionCode || row.code || index,
        referenceType: 'action',
        referenceContext: { scene: selectedScene },
      },
      {
        key: 'concept-type',
        title: t('ontologyBaseDetail.objectConceptTypeDistribution'),
        tooltip: t('ontologyBaseDetail.objectConceptTypeDistributionTip'),
        data: objectConceptTypeDistribution,
        columns: objectColumns,
        rowKey: 'objectCode',
        referenceType: 'object',
        referenceContext: { scene: selectedScene },
      },
    ];
    return (
      <>
        {renderResourceContentTabs(
          [
            {
              key: 'object',
              label: `${t('common.resourceType.object')} (${selectedObjects.length})`,
              children: (
                <ReferenceDetailTable
                  size="small"
                  rowKey="objectCode"
                  dataSource={filteredObjects}
                  pagination={false}
                  columns={objectColumns}
                  onReference={(rows: any[]) => quoteRowsToChat(rows, 'object', { scene: selectedScene })}
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceType="object"
                  referenceContext={{ scene: selectedScene }}
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
            {
              key: 'view',
              label: `${t('common.resourceType.view')} (${selectedViews.length})`,
              children: (
                <ReferenceDetailTable
                  size="small"
                  rowKey="viewCode"
                  dataSource={filteredViews}
                  pagination={false}
                  columns={viewColumns}
                  onReference={(rows: any[]) => quoteRowsToChat(rows, 'view', { scene: selectedScene })}
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceType="view"
                  referenceContext={{ scene: selectedScene }}
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
            {
              key: 'relation',
              label: `${t('employeeDetail.ontology.relation')} (${selectedRelations.length})`,
              children: (
                <RelationPanel
                  relations={filteredRelations}
                  objects={selectedObjects}
                  columns={relationColumns}
                  t={t}
                  onReference={(rows: any[]) => quoteRowsToChat(rows, 'relation', { scene: selectedScene })}
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceContext={{ scene: selectedScene }}
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
            {
              key: 'action',
              label: `${t('ontologyCenter.detail.actions')} (${selectedActions.length})`,
              children: (
                <ReferenceDetailTable
                  size="small"
                  rowKey={(row: any, index) => row.actionCode || row.code || index}
                  dataSource={filteredActions}
                  pagination={false}
                  columns={actionColumns}
                  onReference={(rows: any[]) => quoteRowsToChat(rows, 'action', { scene: selectedScene })}
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceType="action"
                  referenceContext={{ scene: selectedScene }}
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
          ],
          sceneDistributionItems
        )}
      </>
    );
  };

  const renderViewDetail = () => {
    if (!selectedScene) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    if (!selectedView) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    const memberObjects = toArray(selectedView.objectCodes).map(
      (code: string) => objectByCode[code] || { objectCode: code }
    );
    const viewProperties = toArray(selectedView.properties);
    const sourceDistribution = groupRowsBy(
      viewProperties,
      (property) => property.sourceObject || t('ontologyBaseDetail.unknown')
    );
    const dataTypeDistribution = groupRowsBy(
      viewProperties,
      (property) => property.dataType || t('ontologyBaseDetail.unknown'),
      (dataType, rows) =>
        getDistributionValueLabel({
          raw: dataType,
          rows,
          labelFields: ['dataTypeName', 'dataTypeLabel', 'typeName', 'typeLabel'],
          fallbackLabel: getBilingualLabel(t, DATA_TYPE_LABEL_KEYS, dataType, '').replace(` ${dataType}`, ''),
        })
    );
    const viewObjectCodes = toArray(selectedView.objectCodes);
    const viewRelations = selectedRelations.filter(
      (relation: any) =>
        viewObjectCodes.includes(relation.sourceObjectCode) || viewObjectCodes.includes(relation.targetObjectCode)
    );
    const filteredViewRelations = viewRelations.filter((relation: any) =>
      matchKeyword(relation.relationName, relation.relationCode, relation.sourceObjectName, relation.targetObjectName)
    );
    const fieldSourcePropertyDistribution = groupRowsBy(
      viewProperties,
      (property) => property.sourceObjectProperty || t('ontologyBaseDetail.unknown')
    );
    const objectFieldContributionDistribution = memberObjects.map((object: any) => ({
      name: object.objectName || object.objectCode,
      value: viewProperties.filter(
        (property: any) => property.sourceObject === object.objectCode || property.sourceObject === object.objectName
      ).length,
      rows: viewProperties.filter(
        (property: any) => property.sourceObject === object.objectCode || property.sourceObject === object.objectName
      ),
    }));
    const viewRelationObjectDistribution = groupRelationsByEndpoint(viewRelations, t('ontologyBaseDetail.unknown'));
    const viewDistributionItems = [
      {
        key: 'field-source',
        title: t('ontologyBaseDetail.fieldSourceDistribution'),
        tooltip: t('ontologyBaseDetail.fieldSourceDistributionTip'),
        data: sourceDistribution,
        columns: propertyColumns,
        rowKey: (row: any, index: number) => row.propertyCode || index,
        referenceType: 'field',
        referenceContext: { scene: selectedScene, view: selectedView },
      },
      {
        key: 'field-type',
        title: t('ontologyBaseDetail.fieldTypeDistribution'),
        tooltip: t('ontologyBaseDetail.fieldTypeDistributionTip'),
        data: dataTypeDistribution,
        columns: propertyColumns,
        rowKey: (row: any, index: number) => row.propertyCode || index,
        referenceType: 'field',
        referenceContext: { scene: selectedScene, view: selectedView },
      },
      {
        key: 'field-source-property',
        title: t('ontologyBaseDetail.fieldSourcePropertyDistribution'),
        tooltip: t('ontologyBaseDetail.fieldSourcePropertyDistributionTip'),
        data: fieldSourcePropertyDistribution,
        columns: propertyColumns,
        rowKey: (row: any, index: number) => row.propertyCode || index,
        referenceType: 'field',
        referenceContext: { scene: selectedScene, view: selectedView },
      },
      {
        key: 'object-field-contribution',
        title: t('ontologyBaseDetail.objectFieldContributionDistribution'),
        tooltip: t('ontologyBaseDetail.objectFieldContributionDistributionTip'),
        data: objectFieldContributionDistribution,
        columns: propertyColumns,
        rowKey: (row: any, index: number) => row.propertyCode || index,
        referenceType: 'field',
        referenceContext: { scene: selectedScene, view: selectedView },
      },
      {
        key: 'view-relation-object',
        title: t('ontologyBaseDetail.viewRelationObjectDistribution'),
        tooltip: t('ontologyBaseDetail.viewRelationObjectDistributionTip'),
        data: viewRelationObjectDistribution,
        columns: relationColumns,
        rowKey: (row: any, index: number) => row.relationCode || index,
        referenceType: 'relation',
        referenceContext: { scene: selectedScene, view: selectedView },
      },
    ];
    return (
      <>
        {renderResourceContentTabs(
          [
            {
              key: 'field',
              label: `${t('ontologyCenter.detail.viewProperties')} (${viewProperties.length})`,
              children: (
                <ReferenceDetailTable
                  size="small"
                  rowKey={(row: any, index) => row.propertyCode || index}
                  dataSource={viewProperties.filter((property: any) =>
                    matchKeyword(
                      property.propertyName,
                      property.propertyCode,
                      property.sourceObject,
                      property.sourceObjectProperty
                    )
                  )}
                  pagination={false}
                  columns={propertyColumns}
                  onReference={(rows: any[]) =>
                    quoteRowsToChat(rows, 'field', { scene: selectedScene, view: selectedView })
                  }
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceType="field"
                  referenceContext={{ scene: selectedScene, view: selectedView }}
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
            {
              key: 'object',
              label: `${t('common.resourceType.object')} (${memberObjects.length})`,
              children: (
                <ReferenceDetailTable
                  size="small"
                  rowKey="objectCode"
                  dataSource={memberObjects.filter((object: any) => matchKeyword(object.objectName, object.objectCode))}
                  pagination={false}
                  columns={[
                    ...objectColumns.slice(0, 3),
                    operationColumn('object', {
                      getContext: () => ({ scene: selectedScene, view: selectedView }),
                      renderExtra: (row: any) => (
                        <Button
                          type="link"
                          size="small"
                          onClick={() => openObjectDetail(row, selectedScene, selectedView)}
                        >
                          {t('ontologyCenter.detail.detail')}
                        </Button>
                      ),
                    }),
                  ]}
                  onReference={(rows: any[]) =>
                    quoteRowsToChat(rows, 'object', { scene: selectedScene, view: selectedView })
                  }
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceType="object"
                  referenceContext={{ scene: selectedScene, view: selectedView }}
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
            {
              key: 'relation',
              label: `${t('employeeDetail.ontology.relation')} (${viewRelations.length})`,
              children: (
                <RelationPanel
                  relations={filteredViewRelations}
                  objects={memberObjects}
                  columns={relationColumns}
                  t={t}
                  onReference={(rows: any[]) =>
                    quoteRowsToChat(rows, 'relation', { scene: selectedScene, view: selectedView })
                  }
                  onReferenceSelectionChange={handleReferenceSelectionChange}
                  referenceContext={{ scene: selectedScene, view: selectedView }}
                  selectionResetKey={detailSelectionResetKey}
                />
              ),
            },
          ],
          viewDistributionItems
        )}
      </>
    );
  };

  void renderBaseDetail;
  void renderSceneDetail;
  void renderViewDetail;

  return (
    <div className={styles.container}>
      {renderHeader()}
      <Spin spinning={loading} wrapperClassName={styles.spinFill}>
        <div className={classnames(styles.detailBody, { [styles.detailBodyLoading]: loading })}>
          {!baseId ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : renderResourceExplorer()}
        </div>
      </Spin>
      <Modal
        open={Boolean(relationModal)}
        title={relationModal?.title || t('employeeDetail.ontology.relation')}
        footer={null}
        width={880}
        onCancel={() => setRelationModal(null)}
        destroyOnClose
      >
        <BrowseRelationPanel
          relations={relationModal?.relations || []}
          objects={relationModal?.objects || []}
          columns={browseRelationColumns}
          t={t}
        />
      </Modal>
      <Modal
        open={Boolean(actionModal)}
        title={actionModal?.title || t('ontologyCenter.detail.actions')}
        footer={null}
        width={760}
        onCancel={() => setActionModal(null)}
        destroyOnClose
      >
        <Table
          size="small"
          tableLayout="fixed"
          rowKey={(row: any, index) => row.actionCode || row.code || index}
          dataSource={actionModal?.actions || []}
          columns={browseActionColumns}
          pagination={false}
          scroll={{ x: 680 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </Modal>
    </div>
  );
};

export default OntologyBaseDetail;
