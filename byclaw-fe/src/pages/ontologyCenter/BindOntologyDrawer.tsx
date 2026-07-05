// @ts-nocheck
import React from 'react';
import { Button, Drawer, Empty, Modal, Spin, Tree } from 'antd';
import { useIntl } from '@umijs/max';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { useOntologyBindTree } from './useOntologyBindTree';
import styles from './BindOntologyDrawer.module.less';

/**
 * 绑定本体资源选择：上=本体详情，下=可勾选本体树（库→场景→视图/对象→视图的对象）。
 * 保存 = 覆盖式绑定到当前激活数字员工。核心树逻辑复用 useOntologyBindTree。
 */
const BindOntologyDrawer = ({
  open,
  base,
  onClose,
  onSuccess,
}: {
  open: boolean;
  base: any;
  onClose: () => void;
  onSuccess?: () => void;
}) => {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const activeAgent = useActiveSiderAgent();

  const baseId = base?.pid || base?.ontologyBaseCode || base?.resourceCode || base?.baseId;
  const ownerType = base?.ownerType || 'personal';
  const baseName = base?.resourceName || base?.displayName || baseId;
  const baseDesc = base?.resourceDesc || base?.description;

  const { loading, saving, treeData, checkedKeys, onCheck, expandedKeys, setExpandedKeys, dirty, isClearing, save } =
    useOntologyBindTree({
      enabled: open,
      baseId,
      ownerType,
      baseName,
      digitalEmployeeId: activeAgent?.resourceId,
    });

  const handleSave = async () => {
    if (isClearing) {
      Modal.confirm({
        title: t('common.confirm'),
        content: `当前本体资源树选中节点数为 0，将清空该本体在当前数字员工【${
          activeAgent?.name || ''
        }】上的绑定，请确认`,
        okText: t('common.confirm'),
        cancelText: t('common.cancel'),
        onOk: async () => {
          const ok = await save({ confirmClear: true });
          if (ok) {
            onSuccess?.();
            onClose();
          }
        },
      });
      return;
    }
    const ok = await save();
    if (ok) {
      onSuccess?.();
      onClose();
    }
  };

  return (
    <Drawer
      width={520}
      open={open}
      onClose={onClose}
      title={t('ontologyCenter.bind.title')}
      footer={
        <div className={styles.footer}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={saving} disabled={!dirty || loading} onClick={handleSave}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className={styles.detailBlock}>
        <div className={styles.detailName}>{baseName}</div>
        <div className={styles.detailCode}>{baseId}</div>
        {baseDesc && <div className={styles.detailDesc}>{baseDesc}</div>}
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
    </Drawer>
  );
};

export default BindOntologyDrawer;
