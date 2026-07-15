import React, { useState } from 'react';
import { Drawer, Tag, Descriptions, Select, message } from 'antd';
import { updateTask } from '@/service/devloop';

interface TaskDetailDrawerProps {
  task: any;
  onClose: () => void;
  onRefresh: () => void;
}

const STATUS_OPTIONS = ['待开始', '进行中', '暂停', '完成'];
const PHASE_OPTIONS = ['分诊', '设计', '编码', '测试', '审批', '发布'];

const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({ task, onClose, onRefresh }) => {
  const [updating, setUpdating] = useState(false);

  const handleStatusChange = async (status: string) => {
    if (!task) return;
    setUpdating(true);
    try {
      await updateTask({ taskId: task.taskId, status });
      message.success('状态已更新');
      onRefresh();
    } catch {
      message.error('更新失败');
    } finally {
      setUpdating(false);
    }
  };

  const handlePhaseChange = async (phase: string) => {
    if (!task) return;
    setUpdating(true);
    try {
      await updateTask({ taskId: task.taskId, phase });
      message.success('阶段已更新');
      onRefresh();
    } catch {
      message.error('更新失败');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Drawer title={task?.title || '任务详情'} open={!!task} onClose={onClose} width={640}>
      {task && (
        <>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="状态">
              <Select
                size="small"
                value={task.status}
                onChange={handleStatusChange}
                loading={updating}
                style={{ width: 120 }}
              >
                {STATUS_OPTIONS.map((s) => (
                  <Select.Option key={s} value={s}>
                    {s}
                  </Select.Option>
                ))}
              </Select>
            </Descriptions.Item>
            <Descriptions.Item label="阶段">
              <Select
                size="small"
                value={task.phase}
                onChange={handlePhaseChange}
                loading={updating}
                style={{ width: 120 }}
              >
                {PHASE_OPTIONS.map((p) => (
                  <Select.Option key={p} value={p}>
                    {p}
                  </Select.Option>
                ))}
              </Select>
            </Descriptions.Item>
            <Descriptions.Item label="轮次">
              {task.currentRound}/{task.totalRounds}
            </Descriptions.Item>
            <Descriptions.Item label="分数">{task.score}</Descriptions.Item>
            <Descriptions.Item label="Agent">{task.agentName}</Descriptions.Item>
            <Descriptions.Item label="分支">{task.branchName || '-'}</Descriptions.Item>
            <Descriptions.Item label="负责人">{task.assignee || '我'}</Descriptions.Item>
            {task.warningTag && (
              <Descriptions.Item label="告警">
                <Tag color="warning">{task.warningTag}</Tag>
              </Descriptions.Item>
            )}
          </Descriptions>
        </>
      )}
    </Drawer>
  );
};

export default TaskDetailDrawer;
