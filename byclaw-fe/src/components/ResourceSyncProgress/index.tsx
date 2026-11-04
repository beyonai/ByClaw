import { useState } from 'react';
import { Alert, Button, Popover, Progress, Space, Tag, Typography } from 'antd';
import { SyncProgress, retrySync } from './service';
import useSyncProgress from './useSyncProgress';

const reasons: Record<string, string> = {
  INACTIVE_USER: '人员已停用',
  NO_PERSONAL_ASSISTANT: '尚未创建个人助手',
  AMBIGUOUS_PERSONAL_ASSISTANT: '个人助手不唯一',
  INELIGIBLE_PERSONAL_ASSISTANT_OR_RESOURCE: '个人助手或资源不满足使用条件',
};

export function SyncProgressContent({ task, refresh }: { task: SyncProgress; refresh: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const result = task.result || {};
  const configuring = result.phase === 'CONFIGURING' || result.phase === 'PARTIAL';
  const total = configuring ? result.employeeCount : result.totalUsers;
  const done = configuring ? result.completedEmployeeCount : result.completedUsers;
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const response = await retrySync(task.jobId);
      if (response?.code !== 0) throw new Error(response?.msg || '重试未受理，请刷新进度后再试');
      setError('');
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '暂时无法重试，请刷新进度后再试');
    } finally {
      setRetrying(false);
    }
  };
  return (
    <Space direction="vertical" style={{ width: '100%', maxWidth: 420 }}>
      <Typography.Text>{result.message || '正在同步授权，请稍后刷新进度'}</Typography.Text>
      {total !== undefined && total !== null && total > 0 && (
        <>
          <Typography.Text>
            {configuring ? '员工配置' : '授权生效'}：{done ?? 0} / {total}
          </Typography.Text>
          <Progress percent={Math.min(100, Math.floor((100 * (done ?? 0)) / total))} size="small" />
        </>
      )}
      {!!result.skippedUserCount && <Typography.Text type="warning">跳过 {result.skippedUserCount} 人</Typography.Text>}
      {Object.entries(result.skipReasons || {}).map(([reason, count]) => (
        <Typography.Text key={reason} type="secondary">
          {reasons[reason] || '其他原因'}：{count}
        </Typography.Text>
      ))}
      {!!result.failedEmployeeCount && (
        <Typography.Text type="warning">员工配置未完成：{result.failedEmployeeCount}</Typography.Text>
      )}
      <Typography.Text type="secondary">任务编号：{task.jobId}</Typography.Text>
      {error && <Alert type="warning" message={error} />}
      <Space>
        <Button size="small" onClick={refresh}>
          刷新进度
        </Button>
        {task.canRetry && (
          <Button size="small" loading={retrying} onClick={retry}>
            重试未完成部分
          </Button>
        )}
      </Space>
    </Space>
  );
}

export function SyncProgressBadge({ task, refresh }: { task?: SyncProgress; refresh: () => void }) {
  if (!task || task.status === 'SUPERSEDED') return null;
  const done = task.status === 'COMPLETED';
  const warning = ['FAILED', 'PARTIAL'].includes(task.status) || (done && !task.effective);
  const label = warning ? '同步部分未完成' : done ? '同步已完成' : '授权 / 配置更新中';
  return (
    <span onClick={(event) => event.stopPropagation()}>
      <Popover trigger="click" title="资源同步进度" content={<SyncProgressContent task={task} refresh={refresh} />}>
        <Button type="text" size="small" aria-label={`查看资源同步进度：${label}`}>
          <Tag color={warning ? 'warning' : done ? 'success' : 'processing'}>{label}</Tag>
        </Button>
      </Popover>
    </span>
  );
}

export default function ResourceSyncProgress({
  resourceId,
  enabled = true,
}: {
  resourceId?: string | number;
  enabled?: boolean;
}) {
  const { tasks, error, refresh } = useSyncProgress(enabled ? [resourceId] : []);
  const task = tasks[String(resourceId)];
  if (!task && !error) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      {error && (
        <Alert
          type="warning"
          message={error}
          action={
            <Button size="small" onClick={refresh}>
              刷新进度
            </Button>
          }
        />
      )}
      {task && <SyncProgressContent task={task} refresh={refresh} />}
    </div>
  );
}
