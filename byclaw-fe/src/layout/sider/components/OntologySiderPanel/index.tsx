// @ts-nocheck
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Breadcrumb, Button, Checkbox, Dropdown, Empty, Input, List, message, Spin, Tooltip, Typography } from 'antd';
import { MoreOutlined, SearchOutlined, SaveOutlined } from '@ant-design/icons';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import { trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { DragType } from '@/components/QueryInput/withDrag';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import { getBoundOntologyBases } from '@/service/ontology';
import { useOntologyBindTree } from '@/pages/ontologyCenter/useOntologyBindTree';
import OntologyNodeDrawer from '@/pages/ontologyCenter/OntologyNodeDrawer';
import useGlobal from '@/hooks/useGlobal';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import styles from '@/layout/sider/components/ResourceSiderPanel/index.module.less';

const getArrayData = (response: any) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.list)) return response.list;
  return [];
};

/**
 * 本体 sider 面板：展示当前激活数字员工已绑定的本体库；进入某库后显示「整库」可勾选树
 * （已绑定节点默认勾选）。修改后本体名后出现保存按钮，保存即覆盖式重写该库的 relOntology。
 */
const OntologySiderPanel: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);
  const activeSiderAgent = useActiveSiderAgent();
  const isOntologyCenterPage = pathname.startsWith('/ontologyCenter');
  const nodeClickTimerRef = useRef<number | null>(null);

  const [level, setLevel] = useState<'base' | 'tree'>('base');
  const [boundRows, setBoundRows] = useState<any[]>([]);
  const [selectedBase, setSelectedBase] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [currentNodeKey, setCurrentNodeKey] = useState('base');

  const loadBound = useCallback(async () => {
    if (!activeSiderAgent.resourceId) {
      setBoundRows([]);
      return;
    }
    setLoading(true);
    try {
      // 已绑定的本体库：由后端从已绑定叶子的 ontologyBaseCode 反查库返回
      const response = await getBoundOntologyBases({ digitalEmployeeId: activeSiderAgent.resourceId });
      setBoundRows(getArrayData(response));
    } catch {
      setBoundRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeSiderAgent.resourceId]);

  useEffect(() => {
    setLevel('base');
    setSelectedBase(null);
    setSearchValue('');
    loadBound();
  }, [loadBound]);

  // 绑定抽屉 / 其它处保存本体绑定后，刷新左侧已绑定本体列表
  useEffect(() => {
    const onBindSaved = () => {
      setLevel('base');
      setSelectedBase(null);
      loadBound();
    };
    window.addEventListener('ontologyBindSaved', onBindSaved);
    return () => window.removeEventListener('ontologyBindSaved', onBindSaved);
  }, [loadBound]);

  const bases = useMemo(() => boundRows.filter((r) => r.resourceBizType === 'ONTOLOGY_BASE'), [boundRows]);

  const filteredBases = useMemo(() => {
    const kw = trim(searchValue).toLowerCase();
    if (!kw) return bases;
    return bases.filter((b) =>
      [b.resourceName, b.resourceCode, b.resourceDesc].some((t) => `${t || ''}`.toLowerCase().includes(kw))
    );
  }, [bases, searchValue]);

  const selectedBaseId = selectedBase
    ? selectedBase.pid || selectedBase.ontologyBaseCode || selectedBase.resourceCode
    : undefined;

  const {
    loading: treeLoading,
    saving,
    treeData,
    checkedKeys,
    onCheck,
    dirty,
    save,
    nodeMap,
  } = useOntologyBindTree({
    enabled: level === 'tree',
    baseId: selectedBaseId,
    ownerType: selectedBase?.ownerType || 'personal',
    baseName: selectedBase?.resourceName,
    digitalEmployeeId: activeSiderAgent?.resourceId,
  });

  const enterBase = useCallback((base: any) => {
    setSelectedBase(base);
    setCurrentNodeKey('base');
    setLevel('tree');
  }, []);

  const handleReset = () => {
    setLevel('base');
    setSelectedBase(null);
    setCurrentNodeKey('base');
    clearDetailPanel?.();
  };

  const handleSave = async () => {
    const ok = await save();
    if (ok) loadBound();
  };

  const clearNodeClickTimer = useCallback(() => {
    if (nodeClickTimerRef.current !== null) {
      window.clearTimeout(nodeClickTimerRef.current);
      nodeClickTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearNodeClickTimer(), [clearNodeClickTimer]);

  const getNodeName = useCallback(
    (node: any) => {
      if (!node) return '';
      if (node.level === 'BASE') return node.baseName || selectedBase?.resourceName || selectedBaseId;
      if (node.level === 'SCENE') return node.sceneName || node.sceneId;
      if (node.level === 'VIEW') return node.viewName || node.viewCode;
      return node.objectName || node.objectCode;
    },
    [selectedBase?.resourceName, selectedBaseId]
  );

  const getNodeCode = useCallback(
    (node: any) => {
      if (!node) return '';
      if (node.level === 'BASE') return node.baseId || selectedBaseId;
      if (node.level === 'SCENE') return node.sceneId;
      if (node.level === 'VIEW') return node.viewCode;
      return node.objectCode;
    },
    [selectedBaseId]
  );

  const getNodeBizType = (node: any) => {
    if (node?.level === 'BASE') return 'ONTOLOGY_BASE';
    if (node?.level === 'SCENE') return 'SCENE';
    if (node?.level === 'VIEW') return 'VIEW';
    return 'OBJECT';
  };

  const getNodeTypeLabel = (node: any) => {
    if (node?.level === 'BASE') return intl.formatMessage({ id: 'common.resourceType.ontology' });
    if (node?.level === 'SCENE') return intl.formatMessage({ id: 'common.resourceType.scene' });
    if (node?.level === 'VIEW') return intl.formatMessage({ id: 'common.resourceType.view' });
    return intl.formatMessage({ id: 'common.resourceType.object' });
  };

  const getNodeIcon = (node: any) => {
    if (node?.level === 'BASE') return 'icon-a-Boxhezioutline';
    if (node?.level === 'SCENE') return 'icon-a-Boxhezioutline';
    if (node?.level === 'VIEW') return 'icon-a-yemian-line';
    return 'icon-tongxun';
  };

  const quoteNodeToChat = useCallback(
    (node: any) => {
      if (!node) return;
      const resourceName = getNodeName(node);
      const resourceCode = getNodeCode(node);
      const nodeBaseId = node.baseId || selectedBaseId;
      const quotePayload = {
        item: {
          ...node,
          isFromResourceModule: true,
          showQuotePrefix: true,
          ontologyBaseCode: nodeBaseId,
          resourceId: `${nodeBaseId || ''}:${node.key}`,
          resourceName,
          resourceCode,
          resourceBizType: getNodeBizType(node),
        },
        type: DragType.OBJECT,
      };
      const emitQuote = (waitForListeners = false) => {
        EventEmitter?.emit(
          'queryInput-insert-item',
          {
            ...quotePayload,
          },
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
    [EventEmitter, getNodeCode, getNodeName, intl, navigate, pathname, selectedBaseId, setAgentId, setSessionId]
  );

  const openNodeDetail = useCallback(
    (node: any) => {
      if (!node) return;
      const nodeBaseId = node.baseId || selectedBaseId;
      if (node.level !== 'OBJECT_IN_SCENE' && node.level !== 'OBJECT_IN_VIEW') {
        const query = new URLSearchParams();
        query.set('baseId', nodeBaseId || '');
        query.set('ownerType', node.ownerType || selectedBase?.ownerType || 'personal');
        query.set('resourceName', node.baseName || selectedBase?.resourceName || nodeBaseId || '');
        query.set('resourceCode', selectedBase?.resourceCode || nodeBaseId || '');
        if (node.level === 'BASE') {
          query.set('focusType', 'base');
        }
        if (node.level === 'SCENE') {
          query.set('focusType', 'scene');
          query.set('sceneId', node.sceneId || '');
          query.set('sceneName', node.sceneName || '');
        }
        if (node.level === 'VIEW') {
          query.set('focusType', 'view');
          query.set('sceneId', node.sceneId || '');
          query.set('sceneName', node.sceneName || '');
          query.set('viewCode', node.viewCode || '');
          query.set('viewName', node.viewName || '');
        }
        clearDetailPanel?.();
        navigate(`/ontologyBaseDetail?${query.toString()}`);
        return;
      }
      setDetailPanel?.(
        <OntologyNodeDrawer
          open
          panel
          node={node}
          baseId={nodeBaseId}
          ownerType={node.ownerType || selectedBase?.ownerType || 'personal'}
          onReference={() => quoteNodeToChat(node)}
          onClose={() => clearDetailPanel?.()}
        />,
        { width: 350 }
      );
    },
    [
      clearDetailPanel,
      navigate,
      quoteNodeToChat,
      selectedBase?.ownerType,
      selectedBase?.resourceCode,
      selectedBase?.resourceName,
      selectedBaseId,
      setDetailPanel,
    ]
  );

  const toBaseNode = useCallback((base: any) => {
    const baseId = base?.pid || base?.ontologyBaseCode || base?.resourceCode || base?.baseId;
    return {
      ...base,
      key: `base:${baseId}`,
      level: 'BASE',
      childKeys: [],
      baseId,
      baseName: base?.resourceName || baseId,
      ownerType: base?.ownerType || 'personal',
    };
  }, []);

  const handleBaseClick = useCallback(
    (base: any) => {
      clearNodeClickTimer();
      nodeClickTimerRef.current = window.setTimeout(() => {
        nodeClickTimerRef.current = null;
        enterBase(base);
      }, 220);
    },
    [clearNodeClickTimer, enterBase]
  );

  const handleBaseDoubleClick = useCallback(
    (base: any) => {
      clearNodeClickTimer();
      quoteNodeToChat(toBaseNode(base));
    },
    [clearNodeClickTimer, quoteNodeToChat, toBaseNode]
  );

  const handleNodeClick = useCallback(
    (node: any) => {
      clearNodeClickTimer();
      nodeClickTimerRef.current = window.setTimeout(() => {
        nodeClickTimerRef.current = null;
        if ((node?.childKeys || []).length > 0) {
          setCurrentNodeKey(node.key);
          return;
        }
        openNodeDetail(node);
      }, 220);
    },
    [clearNodeClickTimer, openNodeDetail]
  );

  const handleNodeDoubleClick = useCallback(
    (node: any) => {
      clearNodeClickTimer();
      quoteNodeToChat(node);
    },
    [clearNodeClickTimer, quoteNodeToChat]
  );

  const currentNode = nodeMap?.[currentNodeKey] || nodeMap?.base;
  const currentChildren = useMemo(
    () => (currentNode?.childKeys || []).map((key: string) => nodeMap?.[key]).filter(Boolean),
    [currentNode?.childKeys, nodeMap]
  );
  const drillPath = useMemo(() => {
    if (!currentNode) return [];
    const path: any[] = [];
    let cursor = currentNode;
    while (cursor) {
      path.unshift(cursor);
      cursor = cursor.parentKey ? nodeMap?.[cursor.parentKey] : null;
    }
    return path;
  }, [currentNode, nodeMap]);

  const renderNodeMenu = (node: any) => (
    <Dropdown
      trigger={['hover']}
      overlayClassName={employeeStyles.mydropdown}
      menu={{
        items: [
          {
            key: 'detail',
            label: <div className={employeeStyles.dropdownMenuItem}>{intl.formatMessage({ id: 'common.detail' })}</div>,
          },
        ],
        onClick: ({ domEvent }) => {
          domEvent.preventDefault();
          domEvent.stopPropagation();
          openNodeDetail(node);
        },
      }}
    >
      <Button
        type="text"
        size="small"
        className={styles.ontologyNodeMore}
        icon={<MoreOutlined />}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      />
    </Dropdown>
  );

  const renderOntologyNode = (node: any) => {
    const hasChildren = (node.childKeys || []).length > 0;
    const checked = checkedKeys.includes(node.key);
    const name = getNodeName(node);
    const code = getNodeCode(node);
    return (
      <div
        key={node.key}
        className={styles.ontologyNodeRow}
        onClick={() => handleNodeClick(node)}
        onDoubleClick={() => handleNodeDoubleClick(node)}
      >
        <div
          className={styles.ontologyNodeCheck}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Checkbox
            checked={checked}
            onChange={(event) => onCheck(null, { node: { key: node.key }, checked: event.target.checked })}
          />
        </div>
        <div className={styles.ontologyNodeMain}>
          <span className={styles.ontologyNodeIcon}>
            {hasChildren && <AntdIcon type="icon-a-xiangyou" className={styles.drillIcon} />}
            <AntdIcon type={getNodeIcon(node)} />
          </span>
          <div className={styles.ontologyNodeText}>
            <div className={styles.ontologyNodeNameRow}>
              <Tooltip title={name}>
                <span className={styles.ontologyNodeName}>{name}</span>
              </Tooltip>
              <span className={styles.ontologyTypeTag}>
                <span className={styles.ontologyTypeTagText}>{getNodeTypeLabel(node)}</span>
              </span>
            </div>
            {code && <span className={styles.ontologyNodeCode}>{code}</span>}
          </div>
        </div>
        {renderNodeMenu(node)}
      </div>
    );
  };

  return (
    <div className={`${styles.container} ${styles.ontologySiderContainer}`}>
      <ActiveSiderAgentBar agent={activeSiderAgent} />
      <div
        className={styles.router}
        onClick={() =>
          navigate(
            isOntologyCenterPage ? { pathname: '/chat' } : '/ontologyCenter',
            isOntologyCenterPage ? { state: { keepSiderActiveKey: 'ontology' } } : undefined
          )
        }
      >
        <AntdIcon type="icon-a-Boxhezioutline" />
        <span className={styles.middle}>{intl.formatMessage({ id: 'sider.ontologyCenter' })}</span>
        <AntdIcon type={isOntologyCenterPage ? 'icon-a-Leftzuo' : 'icon-a-Rightyou'} className={styles.routerIcon} />
      </div>

      {level === 'tree' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Breadcrumb className={styles.breadcrumb}>
            <Breadcrumb.Item>
              <span onClick={handleReset}>
                <AntdIcon type="icon-a-Leftzuo" className={styles.breadcrumbBackIcon} />
                {intl.formatMessage({ id: 'dialogueRecord.all' })}
              </span>
            </Breadcrumb.Item>
            {drillPath.map((node, index) => {
              const isLast = index === drillPath.length - 1;
              return (
                <Breadcrumb.Item key={node.key}>
                  <span
                    className={isLast ? styles.breadcrumbUnclickable : styles.breadcrumbClickable}
                    onClick={isLast ? undefined : () => setCurrentNodeKey(node.key)}
                  >
                    {getNodeName(node)}
                  </span>
                </Breadcrumb.Item>
              );
            })}
          </Breadcrumb>
          {dirty && (
            <Tooltip title={intl.formatMessage({ id: 'common.save' })}>
              <Button
                type="link"
                size="small"
                loading={saving}
                onClick={handleSave}
                style={{ padding: 0 }}
                icon={<SaveOutlined />}
                aria-label={intl.formatMessage({ id: 'common.save' })}
              />
            </Tooltip>
          )}
        </div>
      )}

      {level === 'base' && (
        <div className={styles.searchActionRow}>
          <Input
            className={styles.searchInput}
            value={searchValue}
            suffix={<SearchOutlined />}
            placeholder={intl.formatMessage({ id: 'employeeDetail.ontology.searchBase' })}
            onChange={(e) => setSearchValue(e.target.value)}
          />
        </div>
      )}

      <div className={styles.ontologyScrollRegion}>
        <Spin className={styles.ontologyScrollSpin} spinning={level === 'base' ? loading : treeLoading}>
          <div className={styles.ontologyScrollContent}>
            {level === 'base' ? (
              <List
                className={employeeStyles.employeesList}
                dataSource={filteredBases}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                renderItem={(item: any) => (
                  <List.Item
                    className={styles.resourceItem}
                    onClick={() => handleBaseClick(item)}
                    onDoubleClick={() => handleBaseDoubleClick(item)}
                    actions={[renderNodeMenu(toBaseNode(item))]}
                  >
                    <List.Item.Meta
                      avatar={
                        <span className={styles.resourceAvatar}>
                          <AntdIcon type="icon-a-xiangyou" className={styles.drillIcon} />
                          <AntdIcon type="icon-a-Boxhezioutline" />
                        </span>
                      }
                      title={
                        <Typography.Title className={employeeStyles.name}>
                          <div className={styles.ontologyNodeNameRow}>
                            <Tooltip title={item.resourceName}>
                              <span className={styles.ontologyNodeName}>{item.resourceName}</span>
                            </Tooltip>
                            <span className={styles.ontologyTypeTag}>
                              <span className={styles.ontologyTypeTagText}>{getNodeTypeLabel(toBaseNode(item))}</span>
                            </span>
                          </div>
                        </Typography.Title>
                      }
                      description={
                        item.resourceDesc && (
                          <Typography.Paragraph
                            className={employeeStyles.description}
                            ellipsis={{ tooltip: item.resourceDesc }}
                          >
                            {item.resourceDesc}
                          </Typography.Paragraph>
                        )
                      }
                    />
                  </List.Item>
                )}
              />
            ) : treeData.length ? (
              <div className={styles.ontologyNodeList}>
                {currentChildren.length ? (
                  currentChildren.map(renderOntologyNode)
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </div>
            ) : (
              !treeLoading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </div>
        </Spin>
      </div>
    </div>
  );
};

export default OntologySiderPanel;
