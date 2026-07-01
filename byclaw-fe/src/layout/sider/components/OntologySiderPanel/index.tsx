// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Breadcrumb, Empty, Input, List, Spin, Tag, Tooltip, Tree, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import { trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { queryDigEmployeeRelResourceAuth } from '@/pages/manager/service/resources';
import { getOntologyBaseTree } from '@/service/ontology';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import styles from '@/layout/sider/components/ResourceSiderPanel/index.module.less';

const ONTOLOGY_BIZ_TYPES = ['ONTOLOGY_BASE', 'SCENE', 'OBJECT', 'VIEW'];

const getArrayData = (response: any) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.list)) return response.list;
  if (Array.isArray(response?.data)) return response.data;
  return [];
};

const getResponseData = (res: any) => res?.data ?? res ?? [];

const bizLabelKey: Record<string, string> = {
  SCENE: 'employeeDetail.ontology.scene',
  OBJECT: 'common.resourceType.object',
  VIEW: 'common.resourceType.view',
};

/**
 * 本体 sider 面板：浏览当前激活数字员工绑定了内容的本体库；进入库后展示「整库」树
 * （库 → 场景 → 对象/视图），并把该员工实际安装（绑定）的实体高亮标记。
 */
const OntologySiderPanel: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeSiderAgent = useActiveSiderAgent();
  const isOntologyCenterPage = pathname.startsWith('/ontologyCenter');

  const [level, setLevel] = useState<'base' | 'tree'>('base');
  const [boundRows, setBoundRows] = useState<any[]>([]);
  const [selectedBase, setSelectedBase] = useState<any>(null);
  const [treeRows, setTreeRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const keywordRef = useRef('');

  // 当前员工已绑定的本体资源（四级），用于 L1 取本体库 + 树高亮。
  const loadBound = useCallback(async () => {
    if (!activeSiderAgent.resourceId) {
      setBoundRows([]);
      return;
    }
    setLoading(true);
    try {
      const response = await queryDigEmployeeRelResourceAuth({
        pageNum: 1,
        pageSize: 999,
        keyword: '',
        resourceId: activeSiderAgent.resourceId,
        resourceBizTypeList: ONTOLOGY_BIZ_TYPES,
      });
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
    keywordRef.current = '';
    loadBound();
  }, [loadBound]);

  // L1 本体库列表：取已绑定的 ONTOLOGY_BASE 行。
  const bases = useMemo(() => boundRows.filter((r) => r.resourceBizType === 'ONTOLOGY_BASE'), [boundRows]);

  // 高亮集合：所有已绑定实体的 resourceId。
  const boundIdSet = useMemo(() => new Set(boundRows.map((r) => `${r.resourceId}`)), [boundRows]);

  const filteredBases = useMemo(() => {
    const kw = trim(searchValue).toLowerCase();
    if (!kw) return bases;
    return bases.filter((b) =>
      [b.resourceName, b.resourceCode, b.resourceDesc].some((t) => `${t || ''}`.toLowerCase().includes(kw))
    );
  }, [bases, searchValue]);

  const enterBase = useCallback(async (base: any) => {
    setSelectedBase(base);
    setLevel('tree');
    setLoading(true);
    try {
      const baseId = base.pid || base.ontologyBaseCode || base.resourceCode;
      const res = await getOntologyBaseTree({ baseId });
      const data = getResponseData(res);
      setTreeRows(Array.isArray(data) ? data : []);
    } catch {
      setTreeRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleReset = () => {
    setLevel('base');
    setSelectedBase(null);
  };

  // 整库树（库→场景→对象/视图），绑定实体高亮。
  const treeData = useMemo(() => {
    const byId: Record<string, any> = {};
    treeRows.forEach((r) => {
      const bound = boundIdSet.has(`${r.resourceId}`);
      byId[`${r.resourceId}`] = {
        key: `${r.resourceId}`,
        title: (
          <span style={bound ? { fontWeight: 500 } : undefined}>
            {bound && (
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#58D764',
                  marginRight: 6,
                }}
              />
            )}
            {r.resourceName || r.resourceCode}
            {r.resourceBizType !== 'ONTOLOGY_BASE' && bizLabelKey[r.resourceBizType] && (
              <Tag style={{ marginLeft: 6, transform: 'scale(0.85)' }}>
                {intl.formatMessage({ id: bizLabelKey[r.resourceBizType] })}
              </Tag>
            )}
            {bound && (
              <Tag color="green" style={{ marginLeft: 2, transform: 'scale(0.85)' }}>
                {intl.formatMessage({ id: 'ontologyCenter.sider.installed' })}
              </Tag>
            )}
          </span>
        ),
        children: [],
      };
    });
    const roots: any[] = [];
    treeRows.forEach((r) => {
      const node = byId[`${r.resourceId}`];
      const parent = byId[`${r.parentResourceId}`];
      if (parent) parent.children.push(node);
      else roots.push(node);
    });
    return roots;
  }, [treeRows, boundIdSet, intl]);

  return (
    <div className={styles.container}>
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
        <Breadcrumb className={styles.breadcrumb}>
          <Breadcrumb.Item>
            <span onClick={handleReset}>
              <AntdIcon type="icon-a-Leftzuo" className={styles.breadcrumbBackIcon} />
              {intl.formatMessage({ id: 'dialogueRecord.all' })}
            </span>
          </Breadcrumb.Item>
          <Breadcrumb.Item>
            <span className={styles.breadcrumbUnclickable}>{selectedBase?.resourceName}</span>
          </Breadcrumb.Item>
        </Breadcrumb>
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

      <Spin spinning={loading}>
        <div className={styles.listContainer}>
          {level === 'base' ? (
            <List
              className={employeeStyles.employeesList}
              dataSource={filteredBases}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              renderItem={(item: any) => (
                <List.Item className={styles.resourceItem} onClick={() => enterBase(item)}>
                  <List.Item.Meta
                    avatar={
                      <span className={styles.resourceAvatar}>
                        <AntdIcon type="icon-a-xiangyou" className={styles.drillIcon} />
                        <AntdIcon type="icon-a-Boxhezioutline" />
                      </span>
                    }
                    title={
                      <Typography.Title className={employeeStyles.name}>
                        <Tooltip title={item.resourceName}>
                          <span className={employeeStyles.nameText}>{item.resourceName}</span>
                        </Tooltip>
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
            <Tree treeData={treeData} defaultExpandAll selectable={false} blockNode style={{ padding: '4px 8px' }} />
          ) : (
            !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>
      </Spin>
    </div>
  );
};

export default OntologySiderPanel;
