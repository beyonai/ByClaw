import React, { useState } from 'react';
import { Drawer, Tag, Empty } from 'antd';
import dayjs from 'dayjs';
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
            const colTasks = tasks.filter((t) => t.status === col.key);
            return (
              <div key={col.key} className={styles.kanbanColumn}>
                <div className={styles.kanbanColHeader}>
                  <span style={{ color: col.color }}>{col.icon}</span>
                  <span className={styles.kanbanColTitle}>{col.key}</span>
                  <span className={styles.kanbanColCount}>{colTasks.length}</span>
                </div>
                {colTasks.length === 0 ? (
                  <Empty description="" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  colTasks.map((task) => (
                    <div key={task.taskId} className={styles.kanbanCard} onClick={() => setDetailTask(task)}>
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
