import { Button, Empty, Pagination, Select, Spin, Table, Tag, Tooltip, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import dayjs from 'dayjs';

import { listMyAutomationRuns } from '@/service/devloop';

const PAGE_SIZE = 20;

// 与后端 ScanLog.status 取值一致：success 已下发会话，failed 未执行或下发失败。
type RunStatus = 'success' | 'failed';

interface AutomationRun {
  logId: number;
  sourceId?: number;
  sourceName?: string;
  scanTime?: string;
  status?: string;
  errorMsg?: string;
}

const formatRunTime = (value?: string) =>
  value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-';

const AutomationRunPanel: React.FC = () => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  // 空串表示不筛选状态；Select 的 value 需要一个确定值，用 undefined 会退回 placeholder 态。
  const [status, setStatus] = useState<RunStatus | ''>('');
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [runs, setRuns] = useState<AutomationRun[]>([]);

  const loadRuns = useCallback(
    async (targetPage: number, targetStatus: RunStatus | '') => {
      setLoading(true);
      try {
        const response: any = await listMyAutomationRuns({
          status: targetStatus || undefined,
          pageNum: targetPage,
          pageSize: PAGE_SIZE,
        });
        const data = response?.data ?? response;
        setRuns(data?.list || []);
        setTotal(Number(data?.total) || 0);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'automation.run.loadFailed' }));
        setRuns([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [intl]
  );

  useEffect(() => {
    void loadRuns(pageNum, status);
  }, [loadRuns, pageNum, status]);

  const columns = [
    {
      title: intl.formatMessage({ id: 'automation.run.column.name' }),
      dataIndex: 'sourceName',
      render: (value?: string) => value || '-',
    },
    {
      title: intl.formatMessage({ id: 'automation.run.column.time' }),
      dataIndex: 'scanTime',
      width: 200,
      render: (value?: string) => formatRunTime(value),
    },
    {
      title: intl.formatMessage({ id: 'automation.run.column.status' }),
      dataIndex: 'status',
      width: 120,
      render: (value?: string) => (
        <Tag color={value === 'success' ? 'success' : 'error'}>
          {intl.formatMessage({
            id: value === 'success' ? 'automation.run.status.success' : 'automation.run.status.failed',
          })}
        </Tag>
      ),
    },
    {
      title: intl.formatMessage({ id: 'automation.run.column.reason' }),
      dataIndex: 'errorMsg',
      // 失败原因可能很长（异常 message 截断到 1000 字），单元格里省略、悬浮看全文。
      render: (value?: string) =>
        value ? (
          <Tooltip title={value}>
            <span
              style={{
                display: 'inline-block',
                maxWidth: 420,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'bottom',
              }}
            >
              {value}
            </span>
          </Tooltip>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <Spin spinning={loading}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Select
          style={{ width: 160 }}
          value={status}
          onChange={(value) => {
            // 换筛选条件要回到第一页，否则停在旧页码上可能直接落到空页。
            setStatus(value);
            setPageNum(1);
          }}
          options={[
            { label: intl.formatMessage({ id: 'automation.run.status.all' }), value: '' },
            { label: intl.formatMessage({ id: 'automation.run.status.success' }), value: 'success' },
            { label: intl.formatMessage({ id: 'automation.run.status.failed' }), value: 'failed' },
          ]}
        />
        <div style={{ marginLeft: 'auto' }}>
          <Button icon={<ReloadOutlined />} onClick={() => void loadRuns(pageNum, status)}>
            {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
          </Button>
        </div>
      </div>
      <Table<AutomationRun>
        rowKey="logId"
        size="small"
        columns={columns}
        dataSource={runs}
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={intl.formatMessage({ id: 'automation.run.empty' })}
            />
          ),
        }}
      />
      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <Pagination
            current={pageNum}
            pageSize={PAGE_SIZE}
            total={total}
            showSizeChanger={false}
            onChange={(page) => setPageNum(page)}
          />
        </div>
      )}
    </Spin>
  );
};

export default AutomationRunPanel;
