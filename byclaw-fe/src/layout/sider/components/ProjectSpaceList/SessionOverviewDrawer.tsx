import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DatePicker, Drawer, Empty, Pagination, Spin, Tag, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { listTasks, type DevloopTaskItem } from '@/service/devloop';
import TaskDetailDrawer from './TaskDetailDrawer';
import styles from './index.module.less';

interface SessionOverviewDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId?: string | number;
  projectName?: string;
}

type TaskDateRange = [Dayjs | null, Dayjs | null] | null;

type BoardQueryState = {
  pageNum: number;
  pageSize: number;
  dateRange: TaskDateRange;
};

const COLUMNS = [
  { key: 'pending', label: '待开始', icon: '○', color: '#8c8c8c' },
  { key: 'in_progress', label: '进行中', icon: '●', color: '#1677ff' },
  { key: 'paused', label: '暂停', icon: '◑', color: '#faad14' },
  { key: 'completed', label: '完成', icon: '✓', color: '#52c41a' },
] as const;

const normalizeTaskStatus = (status?: string) => {
  const normalizedStatus = `${status || ''}`.trim().toLowerCase();
  if (['完成', '已完成', 'done', 'completed'].includes(normalizedStatus)) return 'completed';
  if (['进行中', 'doing', 'running', 'in_progress'].includes(normalizedStatus)) return 'in_progress';
  if (['暂停', 'paused', 'pause'].includes(normalizedStatus)) return 'paused';
  return 'pending';
};

const getCurrentDayRange = (): TaskDateRange => [dayjs().startOf('day'), dayjs().endOf('day')];

/** 整体任务视图：使用服务端时间范围与分页查询，当前页任务按状态分列展示。 */
const TaskBoardDrawer: React.FC<SessionOverviewDrawerProps> = ({ open, onClose, projectId, projectName }) => {
  const [detailTask, setDetailTask] = useState<DevloopTaskItem | null>(null);
  const [tasks, setTasks] = useState<DevloopTaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dateRange, setDateRange] = useState<TaskDateRange>(getCurrentDayRange);
  const queryRef = useRef<BoardQueryState>({ pageNum: 1, pageSize: 20, dateRange: getCurrentDayRange() });

  const fetchBoardTasks = useCallback(
    async (overrides: Partial<BoardQueryState> = {}) => {
      const numericProjectId = Number(projectId);
      if (!numericProjectId) return;
      const queryState = { ...queryRef.current, ...overrides };
      queryRef.current = queryState;
      setPageNum(queryState.pageNum);
      setPageSize(queryState.pageSize);
      setDateRange(queryState.dateRange);
      setLoading(true);
      try {
        const taskPage = await listTasks({
          projectId: numericProjectId,
          createTimeStart: queryState.dateRange?.[0]?.startOf('day').format('YYYY-MM-DD HH:mm:ss'),
          createTimeEnd: queryState.dateRange?.[1]?.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
          pageNum: queryState.pageNum,
          pageSize: queryState.pageSize,
        });
        setTasks(Array.isArray(taskPage?.list) ? taskPage.list : []);
        setTotal(taskPage?.total || 0);
      } catch (error: any) {
        setTasks([]);
        setTotal(0);
        message.error(error?.message || '整体任务视图查询失败');
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    if (!open) return;
    const currentDayRange = getCurrentDayRange();
    void fetchBoardTasks({ pageNum: 1, pageSize: 20, dateRange: currentDayRange });
  }, [fetchBoardTasks, open]);

  return (
    <>
      <Drawer
        title="整体任务视图"
        open={open}
        onClose={onClose}
        width="90vw"
        styles={{ body: { padding: 0, overflow: 'auto' } }}
      >
        <div className={styles.kanbanToolbar}>
          <div className={styles.kanbanToolbarSummary}>共 {total} 个任务</div>
          <DatePicker.RangePicker
            size="small"
            allowClear
            value={dateRange}
            placeholder={['创建开始日期', '创建结束日期']}
            onChange={(dates) => {
              void fetchBoardTasks({ pageNum: 1, dateRange: dates as TaskDateRange });
            }}
          />
          {total > 0 && (
            <Pagination
              size="small"
              current={pageNum}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              pageSizeOptions={[10, 20, 50, 100]}
              showTotal={(taskTotal) => `共 ${taskTotal} 条`}
              onChange={(nextPageNum, nextPageSize) => {
                void fetchBoardTasks({ pageNum: nextPageNum, pageSize: nextPageSize });
              }}
            />
          )}
        </div>
        <Spin spinning={loading}>
          <div className={styles.kanbanBoard}>
            {COLUMNS.map((col) => {
              const colTasks = tasks.filter((task) => normalizeTaskStatus(task.status || task.statusLabel) === col.key);
              return (
                <div key={col.key} className={styles.kanbanColumn}>
                  <div className={styles.kanbanColHeader}>
                    <span style={{ color: col.color }}>{col.icon}</span>
                    <span className={styles.kanbanColTitle}>{col.label}</span>
                    <span className={styles.kanbanColCount}>{colTasks.length}</span>
                  </div>
                  {colTasks.length === 0 ? (
                    <Empty description="" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    colTasks.map((task) => (
                      <div
                        key={task.sessionId || task.taskId}
                        className={styles.kanbanCard}
                        onClick={() => setDetailTask(task)}
                      >
                        <h4 className={styles.kanbanCardTitle}>{task.title || '未命名任务'}</h4>
                        {task.currentStage?.stageName && (
                          <div className={styles.kanbanCardMeta}>
                            <Tag color="blue" bordered={false}>
                              {task.currentStage.stageName}
                            </Tag>
                            <span>{task.progress || 0}%</span>
                          </div>
                        )}
                        <div className={styles.kanbanCardFooter}>
                          <span>{task.assignee || task.agentName || '-'}</span>
                          <span>{task.createTime ? dayjs(task.createTime).format('M/D HH:mm') : ''}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </Spin>
      </Drawer>
      <TaskDetailDrawer
        task={detailTask}
        onClose={() => setDetailTask(null)}
        onRefresh={fetchBoardTasks}
        projectId={projectId}
        projectName={projectName}
      />
    </>
  );
};

export default TaskBoardDrawer;
