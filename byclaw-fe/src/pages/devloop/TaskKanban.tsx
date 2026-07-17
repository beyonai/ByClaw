import React, { useEffect, useRef, useState } from 'react';
import { Drawer, Tag, Empty, message } from 'antd';
import dayjs from 'dayjs';
import { updateTask } from '@/service/devloop';
import styles from './index.module.less';
import TaskDetailDrawer from './TaskDetailDrawer';

interface TaskKanbanProps {
  open: boolean;
  onClose: () => void;
  tasks: any[];
  onRefresh: () => void;
  projectId?: number;
}

const COLUMNS = [
  { key: '待开始', icon: '○', color: '#8c8c8c' },
  { key: '进行中', icon: '●', color: '#1677ff' },
  { key: '暂停', icon: '◑', color: '#faad14' },
  { key: '完成', icon: '✓', color: '#52c41a' },
];

const PHASE_COLORS: Record<string, string> = {
  分诊: 'orange',
  设计: 'blue',
  编码: 'green',
  测试: 'purple',
  审批: 'cyan',
  发布: 'gold',
};

const TaskKanban: React.FC<TaskKanbanProps> = ({ open, onClose, tasks, onRefresh }) => {
  const [detailTask, setDetailTask] = useState<any>(null);
  const [localTasks, setLocalTasks] = useState<any[]>([]);
  const [draggingTaskId, setDraggingTaskId] = useState<string>();
  const [dragOverColumn, setDragOverColumn] = useState<string>();
  const suppressClickRef = useRef(false);

  useEffect(() => {
    setLocalTasks(tasks || []);
  }, [tasks]);

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, task: any) => {
    const taskId = `${task.taskId || ''}`;
    setDraggingTaskId(taskId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', taskId);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>, status: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>, status: string) => {
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) return;
    setDragOverColumn((prev) => (prev === status ? undefined : prev));
  };

  const handleDragEnd = () => {
    setDraggingTaskId(undefined);
    setDragOverColumn(undefined);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>, status: string) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain') || draggingTaskId;
    const targetTask = localTasks.find((task) => `${task.taskId || ''}` === taskId);
    setDragOverColumn(undefined);
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    if (!targetTask || targetTask.status === status) {
      return;
    }

    const previousTasks = localTasks;
    setLocalTasks((prev) => prev.map((task) => (`${task.taskId || ''}` === taskId ? { ...task, status } : task)));

    try {
      await updateTask({ taskId: Number(targetTask.taskId), status });
      message.success('任务状态已更新');
      onRefresh();
    } catch {
      setLocalTasks(previousTasks);
      message.error('任务状态更新失败');
    } finally {
      setDraggingTaskId(undefined);
    }
  };

  return (
    <>
      <Drawer
        title="整体任务视图"
        open={open}
        onClose={onClose}
        width="90vw"
        bodyStyle={{ padding: 0, overflow: 'auto' }}
      >
        <div className={styles.kanbanBoard}>
          {COLUMNS.map((col) => {
            const colTasks = localTasks.filter((t) => t.status === col.key);
            return (
              <div
                key={col.key}
                className={`${styles.kanbanColumn} ${dragOverColumn === col.key ? styles.kanbanColumnDragOver : ''}`}
                onDragOver={(event) => handleDragOver(event, col.key)}
                onDragLeave={(event) => handleDragLeave(event, col.key)}
                onDrop={(event) => handleDrop(event, col.key)}
              >
                <div className={styles.kanbanColHeader}>
                  <span style={{ color: col.color }}>{col.icon}</span>
                  <span className={styles.kanbanColTitle}>{col.key}</span>
                  <span className={styles.kanbanColCount}>{colTasks.length}</span>
                </div>
                {colTasks.length === 0 ? (
                  <Empty description="" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  colTasks.map((task) => (
                    <div
                      key={task.taskId}
                      className={`${styles.kanbanCard} ${
                        `${task.taskId || ''}` === draggingTaskId ? styles.kanbanCardDragging : ''
                      }`}
                      draggable
                      onDragStart={(event) => handleDragStart(event, task)}
                      onDragEnd={handleDragEnd}
                      onClick={() => {
                        if (suppressClickRef.current) return;
                        setDetailTask(task);
                      }}
                    >
                      <h4 className={styles.kanbanCardTitle}>{task.title}</h4>
                      <div className={styles.kanbanCardMeta}>
                        <Tag color={PHASE_COLORS[task.phase] || 'default'} style={{ marginRight: 4 }}>
                          {task.phase} R{task.currentRound}/{task.totalRounds}
                        </Tag>
                        {task.score > 0 && <span>{task.score}分</span>}
                      </div>
                      {task.warningTag && (
                        <Tag color="warning" bordered={false} style={{ marginTop: 4 }}>
                          {task.warningTag}
                        </Tag>
                      )}
                      <div className={styles.kanbanCardFooter}>
                        <span>{task.agentName}</span>
                        <span>{task.createTime ? dayjs(task.createTime).format('M/D') : ''}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      </Drawer>
      <TaskDetailDrawer task={detailTask} onClose={() => setDetailTask(null)} onRefresh={onRefresh} />
    </>
  );
};

export default TaskKanban;
