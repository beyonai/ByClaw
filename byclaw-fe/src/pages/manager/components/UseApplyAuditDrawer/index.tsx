import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Space, Spin, Table, Tag, message } from 'antd';
import { useIntl } from '@umijs/max';
import ModalDrawer from '@/pages/manager/components/ModalDrawer';
import {
  approveUseApply,
  queryUseApplyList,
  rejectUseApply,
  type ResourceUseApplyAuditItem,
} from '@/pages/manager/service/resources';
import styles from './index.module.less';

type UseApplyAuditDrawerProps = {
  open: boolean;
  record?: {
    resourceId?: string | number;
    resourceName?: string;
    resourceDesc?: string;
    resourceBizType?: string;
    ownerType?: string;
    name?: string;
  } | null;
  onCancel: () => void;
  onSuccess?: () => void;
};

const UseApplyAuditDrawer: React.FC<UseApplyAuditDrawerProps> = ({ open, record, onCancel, onSuccess }) => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [approveLoadingUserId, setApproveLoadingUserId] = useState<string>('');
  const [rejectLoadingUserId, setRejectLoadingUserId] = useState<string>('');
  const [dataSource, setDataSource] = useState<ResourceUseApplyAuditItem[]>([]);

  const resourceTypeName = (() => {
    const resourceBizType = record?.resourceBizType;
    if (resourceBizType === 'DIG_EMPLOYEE') {
      return record?.ownerType === 'personal' || record?.ownerType === 'personal_default'
        ? intl.formatMessage({ id: 'digitalEmployees.myCreations' })
        : intl.formatMessage({ id: 'digitalEmployees.title' });
    }
    if (['KG_DOC', 'KG_TERM', 'KG_QA'].includes(resourceBizType || '')) {
      return intl.formatMessage({ id: 'resource.knowledge' });
    }
    if (['TOOL', 'TOOLKIT', 'MCP', 'AGENT'].includes(resourceBizType || '')) {
      return intl.formatMessage({ id: 'resource.tool' });
    }
    if (resourceBizType === 'OBJECT') {
      return intl.formatMessage({ id: 'resource.object' });
    }
    if (resourceBizType === 'VIEW') {
      return intl.formatMessage({ id: 'resource.view' });
    }
    return intl.formatMessage({ id: 'resource.default' });
  })();

  const loadData = useCallback(async () => {
    if (!record?.resourceId || !open) {
      return;
    }
    setLoading(true);
    try {
      const res: any = await queryUseApplyList({ resourceId: record.resourceId });
      setDataSource(res?.data || res || []);
    } finally {
      setLoading(false);
    }
  }, [open, record?.resourceId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApprove = useCallback(
    async (item: ResourceUseApplyAuditItem) => {
      if (!record?.resourceId) {
        return;
      }
      setApproveLoadingUserId(String(item.userId));
      try {
        await approveUseApply({
          resourceId: record.resourceId,
          applyUserId: item.userId,
        });
        message.success(intl.formatMessage({ id: 'resource.useApplyApproveSuccess' }));
        await loadData();
        onSuccess?.();
      } finally {
        setApproveLoadingUserId('');
      }
    },
    [intl, loadData, onSuccess, record?.resourceId]
  );

  const handleReject = useCallback(
    async (item: ResourceUseApplyAuditItem) => {
      if (!record?.resourceId) {
        return;
      }
      setRejectLoadingUserId(String(item.userId));
      try {
        await rejectUseApply({
          resourceId: record.resourceId,
          applyUserId: item.userId,
        });
        message.success(intl.formatMessage({ id: 'resource.useApplyRejectSuccess' }));
        await loadData();
        onSuccess?.();
      } finally {
        setRejectLoadingUserId('');
      }
    },
    [intl, loadData, onSuccess, record?.resourceId]
  );

  return (
    <ModalDrawer
      title={intl.formatMessage({ id: 'resource.auditUse' })}
      open={open}
      onCancel={onCancel}
      showOkButton={false}
      width={860}
    >
      <div className={styles.header}>
        <div className={styles.title}>{record?.resourceName || record?.name || '-'}</div>
        <div className={styles.desc}>{record?.resourceDesc || '-'}</div>
      </div>
      <Spin spinning={loading}>
        {dataSource.length ? (
          <Table<ResourceUseApplyAuditItem>
            rowKey="privilegeGrantId"
            pagination={false}
            dataSource={dataSource}
            columns={[
              {
                title: intl.formatMessage({ id: 'common.userName' }),
                dataIndex: 'userName',
                key: 'userName',
              },
              {
                title: intl.formatMessage({ id: 'common.applyTime' }),
                dataIndex: 'applyTime',
                key: 'applyTime',
                width: 180,
              },
              {
                title: intl.formatMessage({ id: 'common.status' }),
                dataIndex: 'applyStatus',
                key: 'applyStatus',
                width: 120,
                render: (value: string) => <Tag color="processing">{value}</Tag>,
              },
              {
                title: intl.formatMessage({ id: 'common.operation' }),
                key: 'action',
                width: 200,
                render: (_, item) => (
                  <Space>
                    <Button
                      type="primary"
                      size="small"
                      loading={approveLoadingUserId === String(item.userId)}
                      disabled={rejectLoadingUserId === String(item.userId)}
                      onClick={() => handleApprove(item)}
                    >
                      {intl.formatMessage({ id: 'resource.approveUseApply' })}
                    </Button>
                    <Button
                      type="primary"
                      size="small"
                      danger
                      loading={rejectLoadingUserId === String(item.userId)}
                      disabled={approveLoadingUserId === String(item.userId)}
                      onClick={() => handleReject(item)}
                    >
                      {intl.formatMessage({ id: 'resource.rejectUseApply' })}
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        ) : (
          <div className={styles.emptyWrap}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={intl.formatMessage({ id: 'resource.noPendingUseApply' }, { resourceType: resourceTypeName })}
            />
          </div>
        )}
      </Spin>
    </ModalDrawer>
  );
};

export default UseApplyAuditDrawer;
