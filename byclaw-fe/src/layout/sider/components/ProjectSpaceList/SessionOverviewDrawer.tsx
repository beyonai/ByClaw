import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox, DatePicker, Drawer, Empty, Segmented, Spin, Tag, message } from 'antd';
import { useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import { listOperationTasks, listTasks, type DevloopTaskItem } from '@/service/devloop';
import TaskDetailDrawer from './TaskDetailDrawer';
import { getDevloopTaskTypeLabelId, normalizeDevloopTaskType, type DevloopTaskType } from './devloopTaskType';
import { getTaskDateRangePresets, type TaskDateRange } from './taskDatePresets';
import styles from './index.module.less';

interface SessionOverviewDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId?: string | number;
  // 运营任务与研发任务使用不同接口，但共享同一套状态看板交互。
  operationProject?: boolean;
  canEnterSession?: (task: DevloopTaskItem) => boolean;
  onEnterSession?: (task: DevloopTaskItem) => void;
}

// 日期快捷选择：今天 / 本周 / 本月；自定义表示用户手动改动了 RangePicker，快捷段不再高亮。
type DatePreset = 'today' | 'week' | 'month' | 'custom';
type BoardQueryState = {
  dateRange: TaskDateRange;
  onlyMine: boolean;
};
type TaskColumnKey = 'pending' | 'running' | 'paused' | 'done';
type BoardColumnState = {
  tasks: DevloopTaskItem[];
  pageNum: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
};

const COLUMNS = [
  { key: 'pending', icon: '○', classSuffix: 'Pending', labelId: 'projectSpace.taskBoard.status.pending' },
  { key: 'running', icon: '●', classSuffix: 'Running', labelId: 'projectSpace.taskBoard.status.running' },
  { key: 'paused', icon: '◑', classSuffix: 'Paused', labelId: 'projectSpace.taskBoard.status.paused' },
  { key: 'done', icon: '✓', classSuffix: 'Done', labelId: 'projectSpace.taskBoard.status.done' },
] as const;

const TASK_PAGE_SIZE = 30;
const TASK_STATUS_BY_COLUMN: Record<TaskColumnKey, 'pending' | 'in_progress' | 'paused' | 'completed'> = {
  pending: 'pending',
  running: 'in_progress',
  paused: 'paused',
  done: 'completed',
};
const OPERATION_TASK_STATUS_BY_COLUMN: Record<TaskColumnKey, 'todo' | 'doing' | 'pendingReview' | 'done'> = {
  pending: 'todo',
  running: 'doing',
  paused: 'pendingReview',
  done: 'done',
};

// 四角色各配一组标签配色，与项目详情任务卡的类型图标同一套色值，两个入口看同一个任务时颜色一致。
const TASK_TYPE_TAG_CLASSES: Record<DevloopTaskType, string> = {
  architect: styles.kanbanCardTypeTagArchitect,
  requirement: styles.kanbanCardTypeTagRequirement,
  coder: styles.kanbanCardTypeTagCoder,
  tester: styles.kanbanCardTypeTagTester,
  chat: styles.kanbanCardTypeTagChat,
};

// 四个状态列各自保存分页进度，筛选条件变化时统一从第一页重新查询。
const createColumnStates = (loading = false): Record<TaskColumnKey, BoardColumnState> => ({
  pending: { tasks: [], pageNum: 0, total: 0, hasMore: false, loading },
  running: { tasks: [], pageNum: 0, total: 0, hasMore: false, loading },
  paused: { tasks: [], pageNum: 0, total: 0, hasMore: false, loading },
  done: { tasks: [], pageNum: 0, total: 0, hasMore: false, loading },
});

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

// 任务看板按状态分列查询，每列独立分页，避免一个状态的数据挤占其它状态的首屏数量。
const TaskBoardDrawer: React.FC<SessionOverviewDrawerProps> = ({
  open,
  onClose,
  projectId,
  operationProject = false,
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
  const [columnStates, setColumnStates] = useState<Record<TaskColumnKey, BoardColumnState>>(() => createColumnStates());
  const [dateRange, setDateRange] = useState<TaskDateRange>(() => getPresetRange('week'));
  const [datePreset, setDatePreset] = useState<DatePreset>(DEFAULT_PRESET);
  const [onlyMine, setOnlyMine] = useState(true);
  const queryRef = useRef<BoardQueryState>({
    dateRange: getPresetRange('week'),
    onlyMine: true,
  });
  const requestVersionRef = useRef(0);
  const loadingRequestKeysRef = useRef(new Set<string>());
  const loadFailedShownRef = useRef(false);

  const fetchColumnTasks = useCallback(
    async (
      columnKey: TaskColumnKey,
      queryState: BoardQueryState,
      pageNum: number,
      append: boolean,
      requestVersion: number
    ) => {
      const numericProjectId = Number(projectId);
      if (!Number.isFinite(numericProjectId) || (numericProjectId !== -1 && numericProjectId <= 0)) {
        return;
      }
      const requestKey = `${requestVersion}-${columnKey}`;
      if (loadingRequestKeysRef.current.has(requestKey)) return;
      loadingRequestKeysRef.current.add(requestKey);

      setColumnStates((previous) => ({
        ...previous,
        [columnKey]: { ...previous[columnKey], loading: true },
      }));
      try {
        const createTimeStart = queryState.dateRange?.[0]?.startOf('day').format('YYYY-MM-DD HH:mm:ss');
        const createTimeEnd = queryState.dateRange?.[1]?.endOf('day').format('YYYY-MM-DD HH:mm:ss');
        const taskPage = operationProject
          ? await listOperationTasks({
            projectId: numericProjectId,
            createTimeStart,
            createTimeEnd,
            status: OPERATION_TASK_STATUS_BY_COLUMN[columnKey],
            // 运营和研发任务看板共用“只看我的”，运营接口已支持按当前负责人筛选。
            onlyMine: queryState.onlyMine || undefined,
            pageNum,
            pageSize: TASK_PAGE_SIZE,
          })
          : await listTasks({
            projectId: numericProjectId,
            createTimeStart,
            createTimeEnd,
            onlyMine: queryState.onlyMine || undefined,
            status: TASK_STATUS_BY_COLUMN[columnKey],
            pageNum,
            pageSize: TASK_PAGE_SIZE,
          });
        if (requestVersion !== requestVersionRef.current) return;

        const nextTasks = Array.isArray(taskPage?.list) ? taskPage.list : [];
        const total = Number(taskPage?.total) || 0;
        setColumnStates((previous) => {
          const previousColumn = previous[columnKey];
          const tasks = append
            ? [
              ...previousColumn.tasks,
              ...nextTasks.filter((task) => !previousColumn.tasks.some((item) => item.sessionId === task.sessionId)),
            ]
            : nextTasks;
          return {
            ...previous,
            [columnKey]: {
              tasks,
              pageNum,
              total,
              hasMore: tasks.length < total,
              loading: false,
            },
          };
        });
      } catch (error: any) {
        if (requestVersion === requestVersionRef.current && !loadFailedShownRef.current) {
          loadFailedShownRef.current = true;
          message.error(error?.message || t('projectSpace.taskBoard.loadFailed'));
        }
      } finally {
        loadingRequestKeysRef.current.delete(requestKey);
        if (requestVersion === requestVersionRef.current) {
          setColumnStates((previous) => ({
            ...previous,
            [columnKey]: { ...previous[columnKey], loading: false },
          }));
        }
      }
    },
    [operationProject, projectId, t]
  );

  const reloadBoard = useCallback(
    (overrides: Partial<BoardQueryState> = {}) => {
      const queryState = { ...queryRef.current, ...overrides };
      queryRef.current = queryState;
      setDateRange(queryState.dateRange);
      setOnlyMine(queryState.onlyMine);
      loadFailedShownRef.current = false;
      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;
      const numericProjectId = Number(projectId);
      if (!Number.isFinite(numericProjectId) || (numericProjectId !== -1 && numericProjectId <= 0)) {
        setColumnStates(createColumnStates());
        return;
      }
      setColumnStates(createColumnStates(true));
      void Promise.all(COLUMNS.map((column) => fetchColumnTasks(column.key, queryState, 1, false, requestVersion)));
    },
    [fetchColumnTasks, operationProject, projectId]
  );

  useEffect(() => {
    if (!open) return;
    // 每次打开重置为默认视图：运营和研发任务均默认只看当前登录用户负责的任务。
    setDatePreset(DEFAULT_PRESET);
    reloadBoard({ dateRange: getPresetRange('week'), onlyMine: true });
  }, [open, operationProject, reloadBoard]);

  const handlePresetChange = useCallback(
    (preset: DatePreset) => {
      if (preset === 'custom') return;
      setDatePreset(preset);
      reloadBoard({ dateRange: getPresetRange(preset) });
    },
    [reloadBoard]
  );

  const handleColumnScroll = useCallback(
    (columnKey: TaskColumnKey, event: React.UIEvent<HTMLDivElement>) => {
      const columnState = columnStates[columnKey];
      const scrollContainer = event.currentTarget;
      const remainingHeight = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      if (columnState.loading || !columnState.hasMore || remainingHeight > 24) return;

      // 同一状态列的请求 key 会拦截连续滚动触发，避免触底时重复加载下一页。
      void fetchColumnTasks(columnKey, queryRef.current, columnState.pageNum + 1, true, requestVersionRef.current);
    },
    [columnStates, fetchColumnTasks]
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
              reloadBoard({ dateRange: nextDateRange });
            }}
          />
          <Checkbox
            checked={onlyMine}
            onChange={(e) => {
              reloadBoard({ onlyMine: e.target.checked });
            }}
          >
            {t('projectSpace.taskBoard.onlyMine')}
          </Checkbox>
        </div>
        <div className={styles.kanbanBoard}>
          {COLUMNS.map((column) => {
            const columnState = columnStates[column.key];
            return (
              <div key={column.key} className={styles.kanbanColumn}>
                <div className={styles.kanbanColHeader}>
                  <span className={`${styles.kanbanColIcon} ${styles[`kanbanColIcon${column.classSuffix}`]}`}>
                    {column.icon}
                  </span>
                  <span className={styles.kanbanColTitle}>{t(column.labelId)}</span>
                  <span className={styles.kanbanColCount}>{columnState.total}</span>
                </div>
                <div className={styles.kanbanColumnContent} onScroll={(event) => handleColumnScroll(column.key, event)}>
                  <Spin spinning={columnState.loading} wrapperClassName={styles.kanbanColumnSpin}>
                    {columnState.tasks.length === 0 ? (
                      <Empty description="" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      columnState.tasks.map((task) => {
                        // 运营任务接口回的是 operationType，这里只给研发任务的四角色类型打标签。
                        const taskType = operationProject ? undefined : normalizeDevloopTaskType(task);
                        return (
                          <div
                            key={task.sessionId || task.taskId}
                            className={styles.kanbanCard}
                            onClick={() => setDetailTask(task)}
                          >
                            <div className={styles.kanbanCardHeader}>
                              <h4 className={styles.kanbanCardTitle}>
                                {task.title || t('projectSpace.taskBoard.unnamedTask')}
                              </h4>
                              {taskType && (
                                // 类型标签固定在右上角不参与压缩，标题在左侧自行两行截断。
                                <span className={`${styles.kanbanCardTypeTag} ${TASK_TYPE_TAG_CLASSES[taskType]}`}>
                                  {t(getDevloopTaskTypeLabelId(taskType))}
                                </span>
                              )}
                            </div>
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
                        );
                      })
                    )}
                    {columnState.loading && columnState.tasks.length > 0 && (
                      <div className={styles.kanbanColumnLoadingMore}>
                        <Spin size="small" />
                      </div>
                    )}
                  </Spin>
                </div>
              </div>
            );
          })}
        </div>
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
