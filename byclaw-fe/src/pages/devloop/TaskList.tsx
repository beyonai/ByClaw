import React, { useState } from 'react';
import { Button, Tag, Empty, Avatar } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';
import styles from './index.module.less';
import TaskDetailDrawer from './TaskDetailDrawer';
import TaskKanban from './TaskKanban';

interface TaskListProps {
  tasks: any[];
  onRefresh: () => void;
  projectId?: number;
}

const PHASE_COLORS: Record<string, string> = {
  分诊: 'orange',
  设计: 'blue',
  编码: 'green',
  测试: 'purple',
  审批: 'cyan',
  发布: 'gold',
};

const TaskList: React.FC<TaskListProps> = ({ tasks, onRefresh, projectId }) => {
  const [detailTask, setDetailTask] = useState<any>(null);
  const [showKanban, setShowKanban] = useState(false);

  return (
    <div>
      <div className={styles.taskHeader}>
        <span>{tasks.length} 个研发任务 · 0 个与我关联</span>
        <Button icon={<AppstoreOutlined />} onClick={() => setShowKanban(true)}>
          整体任务视图
        </Button>
      </div>

      {tasks.length === 0 ? (
        <Empty description="暂无任务，在需求 Tab 点击「启动任务」创建" />
      ) : (
        <div className={styles.taskList}>
          {tasks.map((task) => {
            const progress = task.totalRounds > 0 ? Math.round((task.currentRound / task.totalRounds) * 100) : 0;
            return (
              <div key={task.taskId} className={styles.taskCard} onClick={() => setDetailTask(task)}>
                <div className={styles.taskCardMain}>
                  <h4 className={styles.taskTitle}>{task.title}</h4>
                  <div className={styles.taskMeta}>
                    <Tag color={PHASE_COLORS[task.phase] || 'default'}>{task.phase}</Tag>
                    <span className={styles.taskAgent}>{task.agentName}</span>
                    {task.branchName && <span className={styles.taskBranch}>{task.branchName}</span>}
                  </div>
                  {task.warningTag && (
                    <Tag color="warning" className={styles.taskWarning}>
                      {task.warningTag}
                    </Tag>
                  )}
                </div>
                <div className={styles.taskCardRight}>
                  <Avatar size="small" style={{ background: '#f56a00' }}>
                    {(task.assignee || '我')[0]}
                  </Avatar>
                  <span className={styles.taskAssigneeName}>{task.assignee || '我'}</span>
                  <span className={styles.taskProgress}>{progress}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskDetailDrawer task={detailTask} onClose={() => setDetailTask(null)} onRefresh={onRefresh} />
      <TaskKanban
        open={showKanban}
        onClose={() => setShowKanban(false)}
        tasks={tasks}
        onRefresh={onRefresh}
        projectId={projectId}
      />
    </div>
  );
};

export default TaskList;
