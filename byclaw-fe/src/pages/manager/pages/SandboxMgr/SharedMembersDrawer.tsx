import {
  listSharedMembers,
  releaseSharedMember,
  type SharedMember,
  type SharedRecord,
} from '@/pages/manager/service/SharedSandbox';
import { ReloadOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Alert, Button, Drawer, Input, Popconfirm, Select, Space, Table, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatReleaseReason } from './releaseReasonUtils';

export default function SharedMembersDrawer({
  record,
  canManage,
  onClose,
  onReleased,
}: {
  record: SharedRecord;
  canManage: boolean;
  onClose: () => void;
  onReleased: () => Promise<void>;
}) {
  const intl = useIntl();
  const [members, setMembers] = useState<SharedMember[]>([]);
  const [page, setPage] = useState({ pageIndex: 1, pageSize: 20, total: 0 });
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [releasing, setReleasing] = useState<string>();
  const requestGeneration = useRef(0);
  const releaseInFlight = useRef(false);
  const mounted = useRef(false);
  const time = (value?: string | number) => (value ? new Date(value).toLocaleString(intl.locale) : '-');
  const formatStatus = (value: string) =>
    intl.formatMessage({
      id: ['ACTIVE', 'ALLOCATING'].includes(value)
        ? `sandboxMgr.shared.member.${value.toLowerCase()}`
        : `sandboxMgr.status.${value.toLowerCase()}`,
      defaultMessage: value,
    });

  const formatStorageMode = (value?: string) => {
    switch (value) {
      case 'USER_AGENTICFS':
        return intl.formatMessage({ id: 'sandboxMgr.shared.storage.userAgenticFs' });
      case 'USER_NAS_QUOTA':
        return intl.formatMessage({ id: 'sandboxMgr.shared.storage.userQuota' });
      case 'LOGICAL':
        return intl.formatMessage({ id: 'sandboxMgr.shared.storage.logical' });
      default:
        return intl.formatMessage({ id: 'sandboxMgr.status.unknown' });
    }
  };

  const load = useCallback(
    async (pageIndex = 1, pageSize = 20) => {
      const run = ++requestGeneration.current;
      setLoading(true);
      setError('');
      setMembers([]);
      try {
        const result = await listSharedMembers({ sandboxRecordId: record.id, pageIndex, pageSize, keyword, status });
        if (run !== requestGeneration.current) return;
        setMembers(result.records);
        setPage({ pageIndex, pageSize, total: result.total });
      } catch (failure) {
        if (run === requestGeneration.current) {
          setError(
            failure instanceof Error && failure.message
              ? failure.message
              : intl.formatMessage({ id: 'sandboxMgr.shared.loadFailed' })
          );
        }
      } finally {
        if (run === requestGeneration.current) setLoading(false);
      }
    },
    [record.id, keyword, status, intl]
  );

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current++;
    };
  }, [load]);

  const currentQuery = useRef({ load, page });
  currentQuery.current = { load, page };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const release = async (member: SharedMember) => {
    if (releaseInFlight.current) return;
    releaseInFlight.current = true;
    setReleasing(member.id);
    setError('');
    try {
      const released = await releaseSharedMember(member);
      if (!released) throw new Error(intl.formatMessage({ id: 'sandboxMgr.shared.member.releaseFailed' }));
      message.success(intl.formatMessage({ id: 'sandboxMgr.shared.member.releaseSuccess' }));
      const query = currentQuery.current;
      await Promise.all([
        onReleased(),
        mounted.current ? query.load(query.page.pageIndex, query.page.pageSize) : Promise.resolve(),
      ]);
    } catch (failure) {
      if (mounted.current) {
        setError(
          failure instanceof Error && failure.message
            ? failure.message
            : intl.formatMessage({ id: 'sandboxMgr.shared.operationFailed' })
        );
      }
    } finally {
      releaseInFlight.current = false;
      if (mounted.current) setReleasing(undefined);
    }
  };

  return (
    <Drawer
      title={intl.formatMessage({ id: 'sandboxMgr.shared.membersTitle' }, { sandboxId: record.sandboxId || record.id })}
      width={1200}
      open
      onClose={onClose}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space wrap>
          <Input.Search
            placeholder={intl.formatMessage({ id: 'sandboxMgr.shared.member.search' })}
            allowClear
            onSearch={(value) => setKeyword(value.trim())}
            style={{ width: 260 }}
          />
          <Select
            aria-label={intl.formatMessage({ id: 'sandboxMgr.shared.member.status' })}
            value={status}
            onChange={setStatus}
            style={{ width: 160 }}
            options={[
              { value: '', label: intl.formatMessage({ id: 'sandboxMgr.shared.allStatuses' }) },
              ...['ACTIVE', 'ALLOCATING', 'RELEASING', 'RELEASED', 'FAILED'].map((value) => ({
                value,
                label: formatStatus(value),
              })),
            ]}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => load(page.pageIndex, page.pageSize)}>
            {intl.formatMessage({ id: 'sandboxMgr.action.refresh' })}
          </Button>
        </Space>
        {error && <Alert type="error" message={error} showIcon />}
        <Table<SharedMember>
          rowKey="id"
          dataSource={members}
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{ current: page.pageIndex, pageSize: page.pageSize, total: page.total, onChange: load }}
          columns={[
            { title: intl.formatMessage({ id: 'sandboxMgr.table.userCode' }), dataIndex: 'userCode' },
            {
              title: intl.formatMessage({ id: 'sandboxMgr.table.userName' }),
              dataIndex: 'userName',
              render: (value) => value || '-',
            },
            { title: intl.formatMessage({ id: 'sandboxMgr.shared.tenant' }), dataIndex: 'enterpriseId' },
            { title: intl.formatMessage({ id: 'sandboxMgr.table.status' }), dataIndex: 'status', render: formatStatus },
            {
              title: intl.formatMessage({ id: 'sandboxMgr.shared.storageMode' }),
              dataIndex: 'storageMode',
              render: formatStorageMode,
            },
            {
              title: intl.formatMessage({ id: 'sandboxMgr.shared.assignedAt' }),
              dataIndex: 'assignedAt',
              render: time,
            },
            {
              title: intl.formatMessage({ id: 'sandboxMgr.shared.lastHeartbeatAt' }),
              dataIndex: 'lastHeartbeatAt',
              render: time,
            },
            {
              title: intl.formatMessage({ id: 'sandboxMgr.shared.releasedAt' }),
              dataIndex: 'releasedAt',
              render: time,
            },
            {
              title: intl.formatMessage({ id: 'sandboxMgr.shared.exitReason' }),
              dataIndex: 'releaseReason',
              render: (value) => formatReleaseReason(intl, value),
            },
            {
              title: intl.formatMessage({ id: 'sandboxMgr.table.action' }),
              fixed: 'right',
              render: (_, member) =>
                canManage && member.status === 'ACTIVE' ? (
                  <Popconfirm
                    title={intl.formatMessage(
                      { id: 'sandboxMgr.shared.member.releaseConfirm' },
                      { user: member.userName || member.userCode }
                    )}
                    description={intl.formatMessage({ id: 'sandboxMgr.shared.member.releaseDescription' })}
                    okText={intl.formatMessage({ id: 'sandboxMgr.shared.member.release' })}
                    cancelText={intl.formatMessage({ id: 'sandboxMgr.shared.cancel' })}
                    onConfirm={() => release(member)}
                  >
                    <Button type="link" danger loading={releasing === member.id} disabled={!!releasing}>
                      {intl.formatMessage({ id: 'sandboxMgr.shared.member.release' })}
                    </Button>
                  </Popconfirm>
                ) : null,
            },
          ]}
        />
      </Space>
    </Drawer>
  );
}
