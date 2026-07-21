import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DatePicker, Drawer, Empty, Pagination, Spin, Tag, message } from 'antd';
import { useIntl } from '@umijs/max';
import dayjs, { type Dayjs } from 'dayjs';
import { listTasks, type DevloopTaskItem } from '@/service/devloop';
import TaskDetailDrawer from './TaskDetailDrawer';
import styles from './index.module.less';

interface SessionOverviewDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId?: string | number;
}

type TaskDateRange = [Dayjs | null, Dayjs | null] | null;

type BoardQueryState = {
  pageNum: number;
  pageSize: number;
  dateRange: TaskDateRange;
};

const COLUMNS = [
  { key: 'pending', icon: '○', classSuffix: 'Pending', labelId: 'projectSpace.taskBoard.status.pending' },
  { key: 'running', icon: '●', classSuffix: 'Running', labelId: 'projectSpace.taskBoard.status.running' },
  { key: 'paused', icon: '◑', classSuffix: 'Paused', labelId: 'projectSpace.taskBoard.status.paused' },
  { key: 'done', icon: '✓', classSuffix: 'Done', labelId: 'projectSpace.taskBoard.status.done' },
];

const getTaskStatusKey = (status?: string) => {
  const normalizedStatus = `${status || ''}`.trim().toLowerCase();
  if (['完成', '已完成', 'done', 'completed'].includes(normalizedStatus)) return 'done';
  if (['进行中', 'doing', 'running', 'in_progress'].includes(normalizedStatus)) return 'running';
  if (['暂停', 'paused', 'pause'].includes(normalizedStatus)) return 'paused';
  return 'pending';
};

const getCurrentDayRange = (): TaskDateRange => [dayjs().startOf('day'), dayjs().endOf('day')];

// 任务看板按时间范围和分页从服务端读取，避免项目任务较多时一次性加载全部会话。
const TaskBoardDrawer: React.FC<SessionOverviewDrawerProps> = ({ open, onClose, projectId }) => {
  const intl = useIntl();
  // 保持翻译函数引用稳定，避免请求失败后的状态更新重新触发任务看板的初始查询 effect。
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values),
    [intl]
  );
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
      if (!Number.isFinite(numericProjectId) || (numericProjectId !== -1 && numericProjectId <= 0)) {
        return;
      }

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
        message.error(error?.message || t('projectSpace.taskBoard.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [projectId, t]
  );

  useEffect(() => {
    if (!open) return;
    const currentDayRange = getCurrentDayRange();
    void fetchBoardTasks({ pageNum: 1, pageSize: 20, dateRange: currentDayRange });
  }, [fetchBoardTasks, open]);

  return (
    <>
      <Drawer
        title={t('projectSpace.taskBoard.title')}
        className={styles.taskBoardDrawer}
        open={open}
        onClose={onClose}
        width="90vw"
      >
        <div className={styles.kanbanToolbar}>
          {/* 不单独展示任务总数，日期筛选从工具栏左侧开始排列。 */}
          <DatePicker.RangePicker
            size="small"
            allowClear
            value={dateRange}
            placeholder={[
              t('projectSpace.taskBoard.dateStartPlaceholder'),
              t('projectSpace.taskBoard.dateEndPlaceholder'),
            ]}
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
              showTotal={(count) => t('projectSpace.taskBoard.paginationTotal', { count })}
              onChange={(nextPageNum, nextPageSize) => {
                void fetchBoardTasks({ pageNum: nextPageNum, pageSize: nextPageSize });
              }}
            />
          )}
        </div>
        <Spin spinning={loading}>
          <div className={styles.kanbanBoard}>
            {COLUMNS.map((column) => {
              const columnTasks = tasks.filter((task) => getTaskStatusKey(task.status || task.statusLabel) === column.key);
              return (
                <div key={column.key} className={styles.kanbanColumn}>
                  <div className={styles.kanbanColHeader}>
                    <span className={`${styles.kanbanColIcon} ${styles[`kanbanColIcon${column.classSuffix}`]}`}>
                      {column.icon}
                    </span>
                    <span className={styles.kanbanColTitle}>{t(column.labelId)}</span>
                    <span className={styles.kanbanColCount}>{columnTasks.length}</span>
                  </div>
                  {columnTasks.length === 0 ? (
                    <Empty description="" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    columnTasks.map((task) => (
                      <div
                        key={task.sessionId || task.taskId}
                        className={styles.kanbanCard}
                        onClick={() => setDetailTask(task)}
                      >
                        <h4 className={styles.kanbanCardTitle}>{task.title || t('projectSpace.taskBoard.unnamedTask')}</h4>
                        {task.currentStage?.stageName && (
                          <div className={styles.kanbanCardMeta}>
                            <Tag className={styles.kanbanPhaseTag} color="blue">
                              {task.currentStage.stageName}
                            </Tag>
                            <span>{t('projectSpace.taskBoard.progress', { progress: task.progress || 0 })}</span>
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
      <TaskDetailDrawer task={detailTask} onClose={() => setDetailTask(null)} />
    </>
  );
};

export default TaskBoardDrawer;
