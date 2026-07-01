// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { Empty, Modal, Spin, Tag, Tree, message } from 'antd';
import { useIntl } from '@umijs/max';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { installDigitalEmployeeRelResources } from '@/pages/manager/service/DigitalEmployeeMgr';
import { getOntologyBaseTree } from '@/service/ontology';

const getResponseData = (res: any) => res?.data ?? res ?? [];

const bizLabelKey: Record<string, string> = {
  ONTOLOGY_BASE: 'employeeDetail.ontology.base',
  SCENE: 'employeeDetail.ontology.scene',
  OBJECT: 'common.resourceType.object',
  VIEW: 'common.resourceType.view',
};

/**
 * 按粒度安装本体：勾选 库/场景/对象/视图，把选中的 ss_resource 安装（绑定）到当前数字员工。
 * 勾选父级会级联选中子级 = 安装整库/整场景；只勾子级 = 仅装该子项。
 */
const InstallOntologyModal = ({
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
  const activeAgent = useActiveSiderAgent();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);

  const baseId = base?.pid || base?.ontologyBaseCode || base?.resourceCode || base?.baseId;

  useEffect(() => {
    if (!open || !baseId) return;
    setCheckedKeys([]);
    setLoading(true);
    getOntologyBaseTree({ baseId })
      .then((res) => {
        const data = getResponseData(res);
        setRows(Array.isArray(data) ? data : []);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open, baseId]);

  const treeData = useMemo(() => {
    const byId: Record<string, any> = {};
    rows.forEach((r) => {
      byId[`${r.resourceId}`] = {
        key: `${r.resourceId}`,
        title: (
          <span>
            {r.resourceName || r.resourceCode}{' '}
            <Tag>{intl.formatMessage({ id: bizLabelKey[r.resourceBizType] || 'resource.default' })}</Tag>
          </span>
        ),
        children: [],
      };
    });
    const roots: any[] = [];
    rows.forEach((r) => {
      const node = byId[`${r.resourceId}`];
      const parent = byId[`${r.parentResourceId}`];
      if (parent) parent.children.push(node);
      else roots.push(node);
    });
    return roots;
  }, [rows, intl]);

  const handleOk = async () => {
    if (!activeAgent.resourceId) {
      message.error(intl.formatMessage({ id: 'resource.noDefaultDigitalEmployee' }));
      return;
    }
    if (!checkedKeys.length) {
      message.warning(intl.formatMessage({ id: 'ontologyCenter.install.selectTip' }));
      return;
    }
    setSubmitting(true);
    try {
      const res: any = await installDigitalEmployeeRelResources({
        digitalEmployeeId: `${activeAgent.resourceId}`,
        relIds: checkedKeys.map((k) => `${k}`),
      });
      if (res && res.code !== undefined && res.code !== 0) {
        message.error(res.msg || res.message || intl.formatMessage({ id: 'common.operationFailed' }));
        return;
      }
      message.success(intl.formatMessage({ id: 'resource.installSuccess' }));
      window.dispatchEvent(new CustomEvent('digitalEmployeeResourceInstalled', { detail: { resourceId: baseId } }));
      onSuccess?.();
      onClose();
    } catch (e: any) {
      message.error(e?.message || e || intl.formatMessage({ id: 'common.operationFailed' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={intl.formatMessage({ id: 'ontologyCenter.install.title' })}
      okText={intl.formatMessage({ id: 'ontologyCenter.install.ok' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      confirmLoading={submitting}
      onOk={handleOk}
      onCancel={onClose}
      destroyOnClose
    >
      <div style={{ marginBottom: 8, color: 'var(--text-3, #888)', fontSize: 12 }}>
        {intl.formatMessage(
          { id: 'ontologyCenter.install.agentTip' },
          { agent: activeAgent.name || intl.formatMessage({ id: 'resource.currentDigitalEmployee' }) }
        )}
      </div>
      <Spin spinning={loading}>
        {treeData.length ? (
          <Tree
            checkable
            defaultExpandAll
            checkedKeys={checkedKeys}
            onCheck={(keys: any) => setCheckedKeys(Array.isArray(keys) ? keys : keys?.checked || [])}
            treeData={treeData}
            height={360}
          />
        ) : (
          !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Spin>
    </Modal>
  );
};

export default InstallOntologyModal;
