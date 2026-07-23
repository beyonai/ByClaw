import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox, DatePicker, Drawer, Empty, Pagination, Segmented, Spin, Tag, message } from 'antd';
import { useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import { listTasks, type DevloopTaskItem } from '@/service/devloop';
import TaskDetailDrawer from './TaskDetailDrawer';
import { getTaskDateRangePresets, type TaskDateRange } from './taskDatePresets';
import styles from './index.module.less';

interface SessionOverviewDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId?: string | number;
  canEnterSession?: (task: DevloopTaskItem) => boolean;
  onEnterSession?: (task: DevloopTaskItem) => void;
}

// 日期快捷选择：今天 / 本周 / 本月；自定义表示用户手动改动了 RangePicker，快捷段不再高亮。
type DatePreset = 'today' | 'week' | 'month' | 'custom';
type BoardQueryState = {
  pageNum: number;
  pageSize: number;
  dateRange: TaskDateRange;
  onlyMine: boolean;
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

// 快捷日期页签始终按周一到周日计算，和日期组件“本周”预设保持一致。
const getPresetRange = (preset: Exclude<DatePreset, 'custom'>): TaskDateRange => {
  const now = dayjs();
  if (preset === 'today') return [now.startOf('day'), now.endOf('day')];
  if (preset === 'week') {
    const weekStart = now.subtract((now.day() + 6) % 7, 'day').startOf('day');
    return [weekStart, weekStart.add(6, 'day').endOf('day')];
  }
  return [now.startOf('month'), now.endOf('month')];
};

// 日期组件选择预设后按自然日边界反向识别对应页签，避免“本周”已生效但页面页签未高亮。
const getDatePresetByRange = (dateRange: TaskDateRange): DatePreset => {
  const startDate = dateRange?.[0];
  const endDate = dateRange?.[1];
  if (!startDate || !endDate) return 'custom';

  for (const preset of ['today', 'week', 'month'] as const) {
    const presetRange = getPresetRange(preset);
    if (presetRange?.[0]?.isSame(startDate, 'day') && presetRange?.[1]?.isSame(endDate, 'day')) {
      return preset;
    }
  }
  return 'custom';
};

// 默认查本自然周，而非仅今天，避免刚进看板只看到当天任务。
const DEFAULT_PRESET: DatePreset = 'week';

// 任务看板按时间范围和分页从服务端读取，避免项目任务较多时一次性加载全部会话。
const TaskBoardDrawer: React.FC<SessionOverviewDrawerProps> = ({
  open,
  onClose,
  projectId,
  canEnterSession,
  onEnterSession,
}) => {
  const intl = useIntl();
  // 保持翻译函数引用稳定，避免请求失败后的状态更新重新触发任务看板的初始查询 effect。
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values),
    [intl]
  );
  // 看板与任务 Tab 使用同一快捷日期范围，避免用户在两个入口得到不同的筛选结果。
  const taskDatePresets = useMemo(() => getTaskDateRangePresets((id) => intl.formatMessage({ id })), [intl]);
  const [detailTask, setDetailTask] = useState<DevloopTaskItem | null>(null);
  const [tasks, setTasks] = useState<DevloopTaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dateRange, setDateRange] = useState<TaskDateRange>(() => getPresetRange('week'));
  const [datePreset, setDatePreset] = useState<DatePreset>(DEFAULT_PRESET);
  const [onlyMine, setOnlyMine] = useState(true);
  const queryRef = useRef<BoardQueryState>({
    pageNum: 1,
    pageSize: 20,
    dateRange: getPresetRange('week'),
    onlyMine: true,
  });

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
      setOnlyMine(queryState.onlyMine);
      setLoading(true);
      try {
        const taskPage = await listTasks({
          projectId: numericProjectId,
          createTimeStart: queryState.dateRange?.[0]?.startOf('day').format('YYYY-MM-DD HH:mm:ss'),
          createTimeEnd: queryState.dateRange?.[1]?.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
          onlyMine: queryState.onlyMine || undefined,
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
    // 每次打开重置为默认视图：本周 + 只看我的，不携带上次的自定义筛选。
    setDatePreset(DEFAULT_PRESET);
    void fetchBoardTasks({ pageNum: 1, pageSize: 20, dateRange: getPresetRange('week'), onlyMine: true });
  }, [fetchBoardTasks, open]);

  const handlePresetChange = useCallback(
    (preset: DatePreset) => {
      if (preset === 'custom') return;
      setDatePreset(preset);
      void fetchBoardTasks({ pageNum: 1, dateRange: getPresetRange(preset) });
    },
    [fetchBoardTasks]
  );

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
          {/* 快速选择今天/本周/本月；中等尺寸页签与 32px 日期筛选高度对齐。 */}
          <Segmented
            size="middle"
            value={datePreset === 'custom' ? '' : datePreset}
            options={[
              { label: t('projectSpace.taskBoard.preset.today'), value: 'today' },
              { label: t('projectSpace.taskBoard.preset.week'), value: 'week' },
              { label: t('projectSpace.taskBoard.preset.month'), value: 'month' },
            ]}
            onChange={(value) => handlePresetChange(value as DatePreset)}
          />
          <DatePicker.RangePicker
            size="small"
            allowClear
            value={dateRange}
            placeholder={[
              t('projectSpace.taskBoard.dateStartPlaceholder'),
              t('projectSpace.taskBoard.dateEndPlaceholder'),
            ]}
            presets={taskDatePresets}
            onChange={(dates) => {
              const nextDateRange = dates as TaskDateRange;
              setDatePreset(getDatePresetByRange(nextDateRange));
              void fetchBoardTasks({ pageNum: 1, dateRange: nextDateRange });
            }}
          />
          <Checkbox
            checked={onlyMine}
            onChange={(e) => {
              void fetchBoardTasks({ pageNum: 1, onlyMine: e.target.checked });
            }}
          >
            {t('projectSpace.taskBoard.onlyMine')}
          </Checkbox>
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
              const columnTasks = tasks.filter(
                (task) => getTaskStatusKey(task.status || task.statusLabel) === column.key
              );
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
                        <h4 className={styles.kanbanCardTitle}>
                          {task.title || t('projectSpace.taskBoard.unnamedTask')}
                        </h4>
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
      <TaskDetailDrawer
        task={detailTask}
        onClose={() => setDetailTask(null)}
        // 看板详情复用外部传入的处理人权限，避免不同入口出现不一致的会话操作。
        canEnterSession={!!detailTask && !!onEnterSession && !!canEnterSession?.(detailTask)}
        onEnterSession={(task) => {
          onEnterSession?.(task);
          setDetailTask(null);
        }}
      />
    </>
  );
};

export default TaskBoardDrawer;
