import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  actOnRecoveryMessage,
  listRecoveryHistory,
  listRecoveryMessages,
  listRecoveryQueues,
  type RecoveryAction,
  type RecoveryMessage,
  type RecoveryQueue,
} from '@/pages/manager/service/SandboxRecovery';

const kindNames = {
  COMMAND: '员工任务',
  WAKEUP: '沙箱唤醒',
  DELIVERY: '投递记录（状态待核实）',
  DEADLETTER: '投递失败记录',
};
const actionNames = { WAKE: '唤醒沙箱', DISMISS: '移出待确认', CONFIRM_WAKE: '确认已唤醒' };
const actionDescription = (action?: RecoveryAction) => {
  if (action === 'WAKE') return '只请求启动沙箱，不重发任务。启动成功不代表任务已经恢复完成。';
  if (action === 'CONFIRM_WAKE') return '当前目标 Worker 已在线，仅确认这条唤醒请求。不会确认员工任务完成。';
  return '将停止该消费组继续恢复此消息，不删除原消息。不会取消正在运行的任务或结束旧页面 loading；请先核对会话结果。';
};
const canAct = (row: RecoveryMessage, action: RecoveryAction) => {
  if (action === 'WAKE') return row.canWake;
  if (action === 'CONFIRM_WAKE') return row.canConfirmWake;
  return row.canDismiss;
};
const outcomeNames: Record<string, string> = {
  STARTED: '操作开始',
  WAKE_REQUESTED: '已请求唤醒（待核对）',
  WAKE_CONFIRMED: '已确认唤醒',
  DISMISSED: '已移出待确认',
  FAILED: '失败',
};
const operationName = (value: string) =>
  value === 'AUTO_WAKE' ? '自动唤醒' : actionNames[value as RecoveryAction] || value;
const time = (value?: string | number | null) => (value ? new Date(Number(value)).toLocaleString() : '未知');
const duration = (value?: number) =>
  value === undefined || value === null ? '-' : value < 60000 ? '不足 1 分钟' : `${Math.floor(value / 60000)} 分钟`;
const queueId = (queue: RecoveryQueue) => `${queue.stream}\n${queue.group}`;

export default function RecoveryPanel() {
  const [queues, setQueues] = useState<RecoveryQueue[]>([]);
  const [queueCursor, setQueueCursor] = useState('0');
  const [queueLoading, setQueueLoading] = useState(false);
  const [queryError, setQueryError] = useState(false);
  const [selected, setSelected] = useState<RecoveryQueue>();
  const [state, setState] = useState('PENDING');
  const [rows, setRows] = useState<RecoveryMessage[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail] = useState<RecoveryMessage>();
  const [action, setAction] = useState<RecoveryAction>();
  const [acting, setActing] = useState(false);
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [form] = Form.useForm();
  const generation = useRef(0);
  const queueGeneration = useRef(0);

  const loadQueues = useCallback(async (next = '0') => {
    const run = ++queueGeneration.current;
    setQueueLoading(true);
    setQueryError(false);
    try {
      const result = await listRecoveryQueues(next);
      if (run !== queueGeneration.current) return;
      setQueues((previous) => {
        const map = new Map((next === '0' ? [] : previous).map((q) => [queueId(q), q]));
        result.items.forEach((q) => map.set(queueId(q), q));
        return [...map.values()];
      });
      setQueueCursor(result.nextCursor);
    } catch {
      if (run === queueGeneration.current) setQueryError(true);
    } finally {
      if (run === queueGeneration.current) setQueueLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (queue: RecoveryQueue, status: string, next?: string) => {
    const run = ++generation.current;
    setLoading(true);
    try {
      const result = await listRecoveryMessages(queue, status, next);
      if (run !== generation.current) return;
      setRows((previous) => (next ? [...previous, ...result.items] : result.items));
      setCursor(result.nextCursor);
    } catch {
      if (run === generation.current) {
        setRows([]);
        setCursor(undefined);
      }
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueues();
    return () => {
      generation.current += 1;
      queueGeneration.current += 1;
    };
  }, [loadQueues]);

  const selectQueue = (queue: RecoveryQueue, status: string) => {
    setSelected(queue);
    setState(status);
    setRows([]);
    setKeyword('');
    setDetail(undefined);
    void loadMessages(queue, status);
  };

  const runAction = async () => {
    const values = await form.validateFields().catch(() => undefined);
    if (!values) return;
    if (!selected || !detail || !action || acting) return;
    setActing(true);
    try {
      const result = await actOnRecoveryMessage(selected, detail.id, action, values.reason.trim());
      message.success(result.message, 8);
      setAction(undefined);
      setDetail(undefined);
      await Promise.all([loadMessages(selected, state), loadQueues()]);
    } catch {
      // Always reload: a timeout can happen after the server accepted the operation.
      setAction(undefined);
      setDetail(undefined);
      await loadMessages(selected, state);
    } finally {
      setActing(false);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      setHistory(await listRecoveryHistory());
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const visibleRows = rows.filter((row) =>
    [row.userCode, row.userName, row.resourceName, row.sessionId, row.commandId, row.content].some((value) =>
      value?.toLowerCase().includes(keyword.toLowerCase())
    )
  );

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%', overflow: 'auto', paddingBottom: 24 }}>
      <Alert
        type="info"
        showIcon
        message="待确认不等于失败：Worker 在线时，任务可能正在正常执行。"
        description="这里展示当前连接 Redis 的任务与唤醒队列。最后领取时间不是停止时间；Redis 未记录准确退出时间时显示未知。唤醒后仍需核对成员回报和最终结果。"
      />
      <Space>
        <Button icon={<ReloadOutlined />} loading={queueLoading} onClick={() => void loadQueues()}>
          刷新队列
        </Button>
        {queueCursor !== '0' && (
          <Button loading={queueLoading} onClick={() => void loadQueues(queueCursor)}>
            继续扫描队列
          </Button>
        )}
        <Button onClick={() => void openHistory()}>恢复操作记录</Button>
        <Typography.Text type="secondary">
          {queueCursor !== '0' ? '扫描尚未完成，当前结果不是全部队列' : '本次扫描已完成'}
        </Typography.Text>
      </Space>
      {queryError && <Alert type="error" message="队列读取失败，不能将当前列表视为空队列。请重试。" />}
      <Table<RecoveryQueue>
        rowKey={queueId}
        size="small"
        loading={queueLoading}
        dataSource={queues}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        scroll={{ x: 1000 }}
        locale={{
          emptyText: (
            <Empty description={queueCursor === '0' ? '当前 Redis 未发现待处理队列' : '本批次未发现，请继续扫描'} />
          ),
        }}
        columns={[
          { title: '类型', dataIndex: 'kind', width: 150, render: (kind: RecoveryQueue['kind']) => kindNames[kind] },
          { title: '沙箱目标 / 队列', dataIndex: 'stream', ellipsis: true },
          {
            title: '消费组',
            dataIndex: 'group',
            ellipsis: true,
            render: (value: string) => value || '无消费组 / 历史记录',
          },
          {
            title: '已领取待确认',
            dataIndex: 'pending',
            width: 130,
            render: (value: number) => <Tag color={value ? 'orange' : undefined}>{value}</Tag>,
          },
          { title: '未领取 / 记录数', dataIndex: 'waiting', width: 130, render: (value?: number) => value ?? '未知' },
          {
            title: '查看',
            width: 200,
            render: (_, queue) => (
              <Space>
                {queue.group ? (
                  <>
                    <Button type="link" onClick={() => selectQueue(queue, 'PENDING')}>
                      待确认任务
                    </Button>
                    <Button type="link" onClick={() => selectQueue(queue, 'WAITING')}>
                      未领取
                    </Button>
                  </>
                ) : (
                  <Button type="link" onClick={() => selectQueue(queue, 'RECORD')}>
                    记录详情
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      {selected && (
        <>
          <Space wrap>
            <Typography.Text strong>
              {kindNames[selected.kind]} ·{' '}
              {state === 'PENDING' ? '已领取待确认' : state === 'WAITING' ? '未领取' : '历史记录'}
            </Typography.Text>
            <Input.Search
              placeholder="筛选已加载任务：用户、员工、会话、内容"
              allowClear
              style={{ width: 350 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Button loading={loading} onClick={() => void loadMessages(selected, state)}>
              刷新任务
            </Button>
          </Space>
          <Table<RecoveryMessage>
            rowKey="id"
            size="small"
            loading={loading}
            dataSource={visibleRows}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 1500 }}
            columns={[
              {
                title: '所属用户',
                width: 150,
                render: (_, row) => `${row.userName || '姓名未知'} (${row.userCode || '归属未知'})`,
              },
              {
                title: '数字员工 / 员工组',
                width: 180,
                render: (_, row) => row.resourceName || row.resourceId || '未记录',
              },
              { title: '会话', dataIndex: 'sessionId', width: 130 },
              {
                title: '任务内容',
                dataIndex: 'content',
                width: 250,
                ellipsis: true,
                render: (value: string, row) => (row.payloadMissing ? '原消息已被裁剪' : value || '未记录'),
              },
              {
                title: '当前状态',
                width: 180,
                render: (_, row) => (
                  <Space direction="vertical" size={0}>
                    <Tag color={row.workerOnline ? 'blue' : 'orange'}>
                      {row.workerOnline ? 'Worker 在线' : '未发现在线 Worker'}
                    </Tag>
                    {row.executionStatus || '执行结果待核实'}
                  </Space>
                ),
              },
              { title: '最后领取', dataIndex: 'lastDeliveredAt', width: 180, render: time },
              { title: '未确认时长', dataIndex: 'idleMs', width: 120, render: duration },
              { title: '领取次数', dataIndex: 'deliveries', width: 90 },
              {
                title: '操作',
                fixed: 'right',
                width: 110,
                render: (_, row) => (
                  <Button type="link" onClick={() => setDetail(row)}>
                    详情 / 处理
                  </Button>
                ),
              },
            ]}
          />
          {cursor && (
            <Button loading={loading} onClick={() => void loadMessages(selected, state, cursor)}>
              加载更多任务
            </Button>
          )}
        </>
      )}
      <Drawer title="恢复任务详情" width={760} open={!!detail} onClose={() => !acting && setDetail(undefined)}>
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert type="info" showIcon message={detail.actionHint} />
            <Descriptions
              bordered
              column={1}
              size="small"
              items={[
                {
                  key: 'owner',
                  label: '所属用户',
                  children: `${detail.userName || '-'} / ${detail.userCode || '未知'}`,
                },
                {
                  key: 'employee',
                  label: '员工 / 员工组',
                  children: `${detail.resourceName || '未记录'} / ${detail.resourceId || '-'}`,
                },
                {
                  key: 'sandbox',
                  label: '当前运行沙箱',
                  children: detail.sandboxId || '未查询到运行记录（不代表从未存在）',
                },
                {
                  key: 'session',
                  label: '会话 / 命令',
                  children: `${detail.sessionId || '-'} / ${detail.commandId || '-'}`,
                },
                { key: 'target', label: '目标', children: detail.targetAgentType || '-' },
                { key: 'consumer', label: '最后领取者', children: detail.consumer || '-' },
                { key: 'id', label: '队列消息 ID', children: detail.id },
                { key: 'queued', label: '入队时间', children: time(detail.queuedAt) },
                { key: 'last', label: '最后领取时间', children: time(detail.lastDeliveredAt) },
                { key: 'stop', label: '准确停止时间', children: '未知（Redis 不记录进程退出时间）' },
                { key: 'error', label: '队列记录的错误', children: detail.error || '未记录；请结合服务日志排查' },
              ]}
            />
            <Typography.Title level={5}>任务内容（凭证已脱敏，最多展示 12000 字符）</Typography.Title>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {detail.content || '无可用内容'}
            </Typography.Paragraph>
            {detail.lastOperation?.action && (
              <Alert
                type="info"
                message={`最近操作：${detail.lastOperation.operator} · ${operationName(
                  detail.lastOperation.action
                )} · ${outcomeNames[detail.lastOperation.outcome] || detail.lastOperation.outcome}`}
                description={`${time(detail.lastOperation.time)} ${detail.lastOperation.reason} ${
                  detail.lastOperation.error || ''
                }`}
              />
            )}
            <Space wrap>
              {(['WAKE', 'CONFIRM_WAKE', 'DISMISS'] as RecoveryAction[]).map((item) => (
                <Button
                  key={item}
                  danger={item === 'DISMISS'}
                  disabled={!canAct(detail, item)}
                  onClick={() => {
                    form.resetFields();
                    setAction(item);
                  }}
                >
                  {actionNames[item]}
                </Button>
              ))}
            </Space>
          </Space>
        )}
      </Drawer>
      <Modal
        title={action ? actionNames[action] : ''}
        open={!!action}
        confirmLoading={acting}
        cancelButtonProps={{ disabled: acting }}
        closable={!acting}
        maskClosable={!acting}
        onCancel={() => !acting && setAction(undefined)}
        onOk={() => void runAction()}
      >
        <Alert type={action === 'DISMISS' ? 'warning' : 'info'} showIcon message={actionDescription(action)} />
        <Form form={form} layout="vertical">
          <Form.Item
            name="reason"
            label="处理原因（将记录操作者和时间）"
            rules={[{ required: true, whitespace: true, message: '请填写处理原因' }, { max: 500 }]}
          >
            <Input.TextArea maxLength={500} rows={3} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        title="恢复操作记录（最近 100 条，含自动唤醒失败）"
        width={1000}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      >
        <Table
          rowKey="eventId"
          size="small"
          loading={historyLoading}
          dataSource={history}
          pagination={{ pageSize: 20 }}
          columns={[
            { title: '时间', dataIndex: 'time', render: time },
            { title: '管理员', dataIndex: 'operator' },
            { title: '所属用户', dataIndex: 'userCode' },
            { title: '会话', dataIndex: 'sessionId' },
            { title: '操作', dataIndex: 'action', render: operationName },
            { title: '结果', dataIndex: 'outcome', render: (value: string) => outcomeNames[value] || value },
            { title: '原因', dataIndex: 'reason', ellipsis: true },
            { title: '错误', dataIndex: 'error', ellipsis: true },
          ]}
        />
      </Drawer>
    </Space>
  );
}
