import { Alert, Button, Progress, Space } from 'antd';
import { AuthorizationTask } from '@/pages/manager/service/authorizationTasks';
import { taskBlocksResource, taskIsActive } from '@/pages/manager/hooks/useAuthorizationTask';

type Props = {
  task?: AuthorizationTask;
  blockingTask?: AuthorizationTask;
  historicalTask?: AuthorizationTask;
  taskError: string;
  taskChecking: boolean;
  taskSubmitting: boolean;
  refreshTask: () => void;
  retryTask: (task: AuthorizationTask) => void;
  cancelTask: (task: AuthorizationTask) => void;
};

const operationName = (task: AuthorizationTask) => (task.operation === 'MANAGE' ? '管理授权' : '使用授权');

export default function AuthorizationTaskProgress({
  task,
  blockingTask,
  historicalTask,
  taskError,
  taskChecking,
  taskSubmitting,
  refreshTask,
  retryTask,
  cancelTask,
}: Props) {
  const renderTask = (value: AuthorizationTask, label: string, history = false) => {
    const failed = value.status === 'FAILED' && taskBlocksResource(value);
    const canRetry = failed && value.canRetry !== false;
    const canCancel = failed && value.dataApplied === 0 && value.canCancel !== false;
    return (
      <Alert
        key={label}
        style={{ marginBottom: 16 }}
        showIcon
        type={value.status === 'FAILED' ? 'warning' : value.status === 'SUCCEEDED' ? 'success' : 'info'}
        message={`${label}（${operationName(value)}）`}
        description={
          <>
            {history && <div>仅供参考，不代表本次提交结果。</div>}
            <div>{value.message}</div>
            <Progress percent={value.progress || 0} status={value.status === 'FAILED' ? 'exception' : undefined} />
            {!!value.totalUsers && (
              <div>
                生效同步：{value.completedUsers} / {value.totalUsers} 人
              </div>
            )}
            {!history && taskBlocksResource(value) && <div>该任务正在占用资源，处理完成前不能再次提交授权。</div>}
            {!history && taskIsActive(value) && <div>可以关闭窗口，后台将继续处理；重新打开可查看进度。</div>}
            {!history && value.submittedByCurrentUser === false && value.status === 'FAILED' && (
              <div>
                {value.dataApplied === 0
                  ? '该任务由其他人员提交，授权尚未保存。可放弃该任务后重新提交你的授权设置。'
                  : '该任务由其他人员提交，授权已保存。可重试生效同步，无需重新授权。'}
              </div>
            )}
            {!history && (
              <Space>
                <Button size="small" loading={taskChecking} onClick={refreshTask}>
                  刷新进度
                </Button>
                {canRetry && (
                  <Button size="small" loading={taskSubmitting} onClick={() => retryTask(value)}>
                    重试任务
                  </Button>
                )}
                {canCancel && (
                  <Button size="small" disabled={taskSubmitting} onClick={() => cancelTask(value)}>
                    放弃本次任务
                  </Button>
                )}
              </Space>
            )}
          </>
        }
      />
    );
  };
  return (
    <>
      {(taskError || (taskChecking && !task && !blockingTask)) && (
        <Alert
          showIcon
          style={{ marginBottom: 16 }}
          type={taskError ? 'warning' : 'info'}
          message={taskError || '正在查询后台授权进度'}
          description={
            <Button size="small" loading={taskChecking} onClick={refreshTask}>
              刷新进度
            </Button>
          }
        />
      )}
      {task && renderTask(task, '本次提交')}
      {blockingTask && blockingTask.taskId !== task?.taskId && renderTask(blockingTask, '资源占用任务')}
      {historicalTask && historicalTask.taskId !== task?.taskId && renderTask(historicalTask, '历史成功记录', true)}
    </>
  );
}
