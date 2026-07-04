// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Breadcrumb, Button, Empty, Input, List, Spin, Tooltip, Tree, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import { trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { getBoundOntologyBases } from '@/service/ontology';
import { useOntologyBindTree } from '@/pages/ontologyCenter/useOntologyBindTree';
import OntologyNodeDrawer from '@/pages/ontologyCenter/OntologyNodeDrawer';
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
  const activeSiderAgent = useActiveSiderAgent();
  const isOntologyCenterPage = pathname.startsWith('/ontologyCenter');

  const [level, setLevel] = useState<'base' | 'tree'>('base');
  const [boundRows, setBoundRows] = useState<any[]>([]);
  const [selectedBase, setSelectedBase] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [detailNode, setDetailNode] = useState<any>(null);

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
    expandedKeys,
    setExpandedKeys,
    dirty,
    save,
  } = useOntologyBindTree({
    enabled: level === 'tree',
    baseId: selectedBaseId,
    ownerType: selectedBase?.ownerType || 'personal',
    baseName: selectedBase?.resourceName,
    digitalEmployeeId: activeSiderAgent?.resourceId,
    onTitleClick: (meta: any) => setDetailNode(meta),
  });

  const enterBase = (base: any) => {
    setSelectedBase(base);
    setLevel('tree');
  };

  const handleReset = () => {
    setLevel('base');
    setSelectedBase(null);
  };

  const handleSave = async () => {
    const ok = await save();
    if (ok) loadBound();
  };

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
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
          {dirty && (
            <Button type="link" size="small" loading={saving} onClick={handleSave} style={{ padding: 0 }}>
              {intl.formatMessage({ id: 'common.save' })}
            </Button>
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

      <Spin spinning={level === 'base' ? loading : treeLoading}>
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
            <Tree
              checkable
              checkStrictly
              blockNode
              selectable={false}
              treeData={treeData}
              checkedKeys={checkedKeys}
              onCheck={onCheck}
              expandedKeys={expandedKeys}
              onExpand={(k) => setExpandedKeys(k)}
              style={{ padding: '4px 8px' }}
            />
          ) : (
            !treeLoading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>
      </Spin>

      <OntologyNodeDrawer
        open={!!detailNode}
        node={detailNode}
        baseId={selectedBaseId}
        ownerType={selectedBase?.ownerType || 'personal'}
        onClose={() => setDetailNode(null)}
      />
    </div>
  );
};

export default OntologySiderPanel;
