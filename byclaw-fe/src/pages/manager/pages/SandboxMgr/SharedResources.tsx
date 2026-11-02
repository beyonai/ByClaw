import { listSharedRecords, releaseSharedInstance, type SharedRecord } from '@/pages/manager/service/SharedSandbox';
import { ReloadOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Alert, Button, Input, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import SharedLaunch from './SharedLaunch';
import SharedMembersDrawer from './SharedMembersDrawer';
import { formatReleaseReason } from './releaseReasonUtils';

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export default function SharedResources({ canManage }: { canManage: boolean }) {
  const intl = useIntl();
  const time = (value?: string | number) => (value ? new Date(value).toLocaleString(intl.locale) : '-');
  const formatStatus = (value: string) =>
    intl.formatMessage({
      id: value === 'ACTIVE' ? 'sandboxMgr.shared.member.active' : `sandboxMgr.status.${value.toLowerCase()}`,
      defaultMessage: value,
    });
  const [launchOpen, setLaunchOpen] = useState(false);
  const [records, setRecords] = useState<SharedRecord[]>([]);
  const [page, setPage] = useState({ pageIndex: 1, pageSize: 20, total: 0 });
  const [serviceKey, setServiceKey] = useState('');
  const [status, setStatus] = useState<string | undefined>('RUNNING');
  const [poolScope, setPoolScope] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SharedRecord>();
  const [releasing, setReleasing] = useState<string>();
  const generation = useRef(0);

  const load = useCallback(
    async (pageIndex = 1, pageSize = 20) => {
      const run = ++generation.current;
      setLoading(true);
      setError('');
      try {
        const result = await listSharedRecords({
          pageIndex,
          pageSize,
          serviceKey: serviceKey || undefined,
          status,
          poolScope,
        });
        if (run !== generation.current) return;
        setRecords(result.records);
        setPage({ pageIndex, pageSize, total: result.total });
      } catch (failure) {
        if (run === generation.current) {
          setError(errorMessage(failure, intl.formatMessage({ id: 'sandboxMgr.shared.loadFailed' })));
        }
      } finally {
        if (run === generation.current) setLoading(false);
      }
    },
    [serviceKey, status, poolScope, intl]
  );

  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);

  const currentQuery = useRef({ load, page });
  currentQuery.current = { load, page };
  const refresh = () => {
    const query = currentQuery.current;
    return query.load(query.page.pageIndex, query.page.pageSize);
  };

  const release = async (record: SharedRecord) => {
    setReleasing(record.id);
    try {
      await releaseSharedInstance(record.id);
      message.success(intl.formatMessage({ id: 'sandboxMgr.shared.releaseSubmitted' }));
      await load(page.pageIndex, page.pageSize);
    } catch (failure) {
      message.error(errorMessage(failure, intl.formatMessage({ id: 'sandboxMgr.shared.operationFailed' })));
    } finally {
      setReleasing(undefined);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Input.Search
          placeholder={intl.formatMessage({ id: 'sandboxMgr.shared.search' })}
          allowClear
          onSearch={setServiceKey}
          style={{ width: 240 }}
        />
        <Select
          placeholder={intl.formatMessage({ id: 'sandboxMgr.shared.allStatuses' })}
          allowClear
          value={status}
          onChange={setStatus}
          style={{ width: 150 }}
          options={['STARTING', 'RUNNING', 'UNKNOWN', 'RELEASING', 'RELEASED', 'FAILED'].map((value) => ({
            value,
            label: formatStatus(value),
          }))}
        />
        <Select
          placeholder={intl.formatMessage({ id: 'sandboxMgr.shared.allPoolScopes' })}
          allowClear
          value={poolScope}
          onChange={setPoolScope}
          style={{ width: 170 }}
          options={[
            { value: 'GLOBAL', label: intl.formatMessage({ id: 'sandboxMgr.shared.pool.global' }) },
            { value: 'TENANT', label: intl.formatMessage({ id: 'sandboxMgr.shared.pool.tenant' }) },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={() => load(page.pageIndex, page.pageSize)} loading={loading}>
          {intl.formatMessage({ id: 'sandboxMgr.action.refresh' })}
        </Button>
        {canManage && (
          <Button type="primary" onClick={() => setLaunchOpen(true)}>
            {intl.formatMessage({ id: 'sandboxMgr.shared.launch.title' })}
          </Button>
        )}
      </Space>
      {launchOpen && <SharedLaunch onClose={() => setLaunchOpen(false)} onLaunched={() => void refresh()} />}
      {error && <Alert type="error" message={error} showIcon />}
      <Table<SharedRecord>
        rowKey="id"
        loading={loading}
        dataSource={records}
        scroll={{ x: 1400 }}
        pagination={{ current: page.pageIndex, pageSize: page.pageSize, total: page.total, onChange: load }}
        columns={[
          {
            title: intl.formatMessage({ id: 'sandboxMgr.table.sandboxId' }),
            dataIndex: 'sandboxId',
            render: (value, row) => value || row.id,
          },
          { title: intl.formatMessage({ id: 'sandboxMgr.shared.serviceKey' }), dataIndex: 'serviceKey' },
          { title: intl.formatMessage({ id: 'sandboxMgr.shared.profileKey' }), dataIndex: 'profileKey' },
          {
            title: intl.formatMessage({ id: 'sandboxMgr.shared.poolScope' }),
            dataIndex: 'poolScope',
            render: (value) =>
              intl.formatMessage({
                id: value === 'TENANT' ? 'sandboxMgr.shared.pool.tenant' : 'sandboxMgr.shared.pool.global',
              }),
          },
          {
            title: intl.formatMessage({ id: 'sandboxMgr.shared.tenant' }),
            dataIndex: 'enterpriseId',
            render: (value) => value || '-',
          },
          { title: intl.formatMessage({ id: 'sandboxMgr.shared.onlineUsers' }), dataIndex: 'onlineUsers' },
          {
            title: intl.formatMessage({ id: 'sandboxMgr.shared.capacity' }),
            render: (_, row) => `${row.occupiedSlots} / ${row.capacity}`,
          },
          {
            title: intl.formatMessage({ id: 'sandboxMgr.table.status' }),
            dataIndex: 'status',
            render: (value) => <Tag>{formatStatus(value)}</Tag>,
          },
          {
            title: intl.formatMessage({ id: 'sandboxMgr.shared.launch.policy' }),
            dataIndex: 'releasePolicy',
            render: (value) => intl.formatMessage({ id: `sandboxMgr.shared.launch.${value || 'HEARTBEAT'}` }),
          },
          {
            title: intl.formatMessage({ id: 'sandboxMgr.shared.launch.releaseAt' }),
            dataIndex: 'releaseAt',
            render: time,
          },
          { title: intl.formatMessage({ id: 'sandboxMgr.table.createTime' }), dataIndex: 'createTime', render: time },
          { title: intl.formatMessage({ id: 'sandboxMgr.table.releaseTime' }), dataIndex: 'releaseTime', render: time },
          {
            title: intl.formatMessage({ id: 'sandboxMgr.table.releaseReason' }),
            dataIndex: 'releaseReason',
            render: (value) => formatReleaseReason(intl, value),
          },
          {
            title: intl.formatMessage({ id: 'sandboxMgr.table.action' }),
            fixed: 'right',
            render: (_, row) => (
              <Space>
                <Button type="link" onClick={() => setSelected(row)}>
                  {intl.formatMessage({ id: 'sandboxMgr.shared.viewUsers' })}
                </Button>
                {canManage && ['STARTING', 'RUNNING'].includes(row.status) && (
                  <Popconfirm
                    title={intl.formatMessage({ id: 'sandboxMgr.shared.releaseConfirm' })}
                    description={intl.formatMessage({ id: 'sandboxMgr.shared.releaseDescription' })}
                    okText={intl.formatMessage({ id: 'sandboxMgr.shared.release' })}
                    cancelText={intl.formatMessage({ id: 'sandboxMgr.shared.cancel' })}
                    onConfirm={() => release(row)}
                  >
                    <Button type="link" danger loading={releasing === row.id}>
                      {intl.formatMessage({ id: 'sandboxMgr.shared.release' })}
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      {selected && (
        <SharedMembersDrawer
          key={selected.id}
          record={selected}
          canManage={canManage}
          onClose={() => setSelected(undefined)}
          onReleased={refresh}
        />
      )}
    </Space>
  );
}
