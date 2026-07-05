// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Empty, Input, List, Space, Spin, Tag, Tree } from 'antd';
import { useIntl } from '@umijs/max';
import { getBoundOntologyBases, listBindableOntologyBases } from '@/service/ontology';
import { useOntologyBindTree } from '@/pages/ontologyCenter/useOntologyBindTree';
import styles from '@/pages/ontologyCenter/BindOntologyDrawer.module.less';

const getData = (res: any) => res?.data ?? res ?? [];

const toArray = (value: any) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const next = value.records || value.rows || value.list || value.items || value.data || [];
  return Array.isArray(next) ? next : [];
};

const getBaseId = (base: any) => base?.pid || base?.ontologyBaseCode || base?.resourceCode || base?.baseId;
const getBaseName = (base: any) => base?.resourceName || base?.displayName || base?.baseName || getBaseId(base);
const getBaseDesc = (base: any) => base?.resourceDesc || base?.description || base?.remark;
const baseKeyOf = (base: any) => `${base?.ownerType || 'personal'}:${getBaseId(base)}`;

const normalizeBases = (res: any, ownerType: string) =>
  toArray(getData(res))
    .map((item: any) => ({
      ...item,
      ownerType: item?.ownerType || ownerType,
    }))
    .filter((item: any) => getBaseId(item));

const EmployeeOntologyDrawer = ({
  open,
  digitalEmployeeId,
  pendingBindings = {},
  onClose,
  onConfirm,
}: {
  open: boolean;
  digitalEmployeeId?: string | number;
  pendingBindings?: Record<string, any>;
  onClose: () => void;
  onConfirm: (binding: any) => void;
}) => {
  const intl = useIntl();
  const t = (id: string, values?: any) => intl.formatMessage({ id }, values);

  const [loadingBases, setLoadingBases] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [bases, setBases] = useState<any[]>([]);
  const [boundBaseKeys, setBoundBaseKeys] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string>();

  useEffect(() => {
    if (!open) return;

    let mounted = true;
    setLoadingBases(true);
    Promise.all([
      listBindableOntologyBases({
        ownerType: 'personal',
      }).catch(() => []),
      listBindableOntologyBases({
        ownerType: 'enterprise',
      }).catch(() => []),
      digitalEmployeeId ? getBoundOntologyBases({ digitalEmployeeId }).catch(() => []) : Promise.resolve([]),
    ])
      .then(([personalRes, enterpriseRes, boundRes]) => {
        if (!mounted) return;
        const merged = [...normalizeBases(personalRes, 'personal'), ...normalizeBases(enterpriseRes, 'enterprise')];
        const map = new Map<string, any>();
        merged.forEach((base) => {
          map.set(baseKeyOf(base), base);
        });

        const boundBases = normalizeBases(boundRes, 'personal');
        const nextBases = Array.from(map.values());
        const nextBoundKeys = boundBases.map(baseKeyOf);
        setBases(nextBases);
        setBoundBaseKeys(nextBoundKeys);
        setActiveKey((prev) => {
          if (prev && nextBases.some((base) => baseKeyOf(base) === prev)) return prev;
          return (
            nextBoundKeys.find((key) => nextBases.some((base) => baseKeyOf(base) === key)) || baseKeyOf(nextBases[0])
          );
        });
      })
      .finally(() => {
        if (mounted) setLoadingBases(false);
      });

    return () => {
      mounted = false;
    };
  }, [open, digitalEmployeeId]);

  const activeBase = useMemo(() => bases.find((base) => baseKeyOf(base) === activeKey), [bases, activeKey]);
  const activeBinding = activeKey ? pendingBindings[activeKey] : undefined;
  const baseId = getBaseId(activeBase);
  const baseName = getBaseName(activeBase);
  const ownerType = activeBase?.ownerType || 'personal';

  const { loading, treeData, checkedKeys, selectedNodes, onCheck, expandedKeys, setExpandedKeys, dirty, isClearing } =
    useOntologyBindTree({
      enabled: open && !!activeBase,
      baseId,
      ownerType,
      baseName,
      digitalEmployeeId,
      initialCheckedKeys: activeBinding?.checkedKeys,
    });

  const filteredBases = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return bases;
    return bases.filter((base) =>
      [getBaseId(base), getBaseName(base), getBaseDesc(base)].some((value) =>
        `${value || ''}`.toLowerCase().includes(kw)
      )
    );
  }, [bases, keyword]);

  const handleConfirm = () => {
    if (!activeBase) {
      onClose();
      return;
    }
    onConfirm({
      key: activeKey,
      baseId,
      baseName,
      ownerType,
      checkedKeys,
      nodes: selectedNodes,
      dirty,
      isClearing,
    });
    onClose();
  };

  return (
    <Drawer
      width={760}
      open={open}
      onClose={onClose}
      title={t('employeeDetail.ontology.selectTitle')}
      footer={
        <div className={styles.footer}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" onClick={handleConfirm}>
            {t('common.confirm')}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 16, height: '100%' }}>
        <div style={{ width: 238, borderRight: '1px solid #eef1f5', paddingRight: 12 }}>
          <Input
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('employeeDetail.ontology.searchBase')}
            style={{ marginBottom: 12 }}
          />
          <Spin spinning={loadingBases}>
            {filteredBases.length ? (
              <List
                dataSource={filteredBases}
                renderItem={(base) => {
                  const key = baseKeyOf(base);
                  const isActive = key === activeKey;
                  return (
                    <List.Item
                      onClick={() => setActiveKey(key)}
                      style={{
                        cursor: 'pointer',
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: isActive ? '#eef5ff' : 'transparent',
                        border: isActive ? '1px solid #c8dcff' : '1px solid transparent',
                        marginBottom: 8,
                      }}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={6}>
                            <span>{getBaseName(base)}</span>
                            {boundBaseKeys.includes(key) && (
                              <Tag color="blue">{t('employeeDetail.ontology.bound')}</Tag>
                            )}
                          </Space>
                        }
                        description={getBaseId(base)}
                      />
                    </List.Item>
                  );
                }}
              />
            ) : (
              !loadingBases && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Spin>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {activeBase ? (
            <>
              <div className={styles.detailBlock}>
                <div className={styles.detailName}>{baseName}</div>
                <div className={styles.detailCode}>{baseId}</div>
                {getBaseDesc(activeBase) && <div className={styles.detailDesc}>{getBaseDesc(activeBase)}</div>}
              </div>
              <Spin spinning={loading}>
                {treeData.length ? (
                  <Tree
                    className={styles.bindTree}
                    checkable
                    checkStrictly
                    blockNode
                    selectable={false}
                    treeData={treeData}
                    checkedKeys={checkedKeys}
                    onCheck={onCheck}
                    expandedKeys={expandedKeys}
                    onExpand={(k) => setExpandedKeys(k)}
                  />
                ) : (
                  !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Spin>
            </>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>
      </div>
    </Drawer>
  );
};

export default EmployeeOntologyDrawer;
